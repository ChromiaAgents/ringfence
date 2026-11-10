// Phone wallet (UNAUDITED PROTOTYPE: keep small amounts): a WhatsApp number bound to a per-user phone-wallet contract (contracts/phone-wallet).
// Here: the binding (code by WhatsApp, PIN as a salted scrypt hash), PIN checks with lockout, and the agent's calls to
// the contract. The contract enforces the limits; nothing here can spend more than it allows.
import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Account, JsonRpcProvider, actions, getTransactionLastResult, type KeyPairString } from 'near-api-js';
import { env } from './config.ts';
import { db, save, log } from './store.ts';
import { net, view } from './near.ts';
import { ETH_PATH, attachSignature, broadcast, deriveEthAddress, prepareTransfer, type MpcSignature } from './eth.ts';
import { chainById, txUrl } from './chains.ts';
import { parseEther } from 'ethers';
import { nearToYocto } from './near.ts';

export type Binding = {
  phone: string; owner: string; contract: string; pinHash: string; salt: string; fails: number; lockedUntil?: number; createdAt: number;
  /** Created from WhatsApp chat with owner = CUSTODY_ACCOUNT_ID until claimed. dryRun: no custody key, nothing on chain. */
  custodial?: boolean; dryRun?: boolean; pendingOwner?: string;
  /** Set when the Reject button is tapped: the server refuses every spend until then. */
  frozenUntil?: number;
};
export type WalletState = {
  owner: string; agent: string | null; phone_hash: string; signer: string; balance: string;
  limits: Record<string, { per_tx: string; per_day: string }>; chains: number[]; allowlist: string[]; spent_today: Record<string, string>; new_recipient_delay_sec: number;
  pending_owner?: string | null; frozen_until_ns?: string; custodial?: boolean;
};

export const digits = (phone: string) => String(phone ?? '').replace(/\D/g, '');
/** A server that can't move anything: testnet, no agent or custody key. Only here may codes and approval tokens go to the log. */
export const devServer = () => env.network !== 'mainnet' && !live() && !custodyLive();
/** WALLET_SECRET: HMAC key for phone hashes (a plain sha256 of a phone number reverses in minutes) and PIN pepper.
 *  Required anywhere real (mainnet or a key set); a fixed dev key otherwise. */
const secret = () => {
  if (env.walletSecret) return env.walletSecret;
  if (!devServer()) throw new Error('WALLET_SECRET is not set: refusing to hash phone numbers without it.');
  return 'ringfence-dev-only';
};
export const phoneHash = (phone: string) => createHmac('sha256', secret()).update(digits(phone)).digest('hex');
/** Placeholder only, never shown as a deposit address: the real account is read from factory.get_wallet (walletState). */
export const walletFor = (phone: string) => `${phoneHash(phone).slice(0, 12)}.${env.factoryAccountId}`;
/** factory.min_deposit(): 0.010 NEAR stays on the wallet for storage, 0.003 pays the factory's records. */
export const CREATE_DEPOSIT = 13n * 10n ** 21n;
export const bindingOf = (phone?: string) => (phone ? db.wallets.find((b) => b.phone === digits(phone)) : undefined);

// ---- PIN ----

const WORDS: Record<string, string> = { zero: '0', oh: '0', o: '0', one: '1', won: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9' };
/** Whisper writes PINs as "1234", "12 34", "one two three four" or "1, 2, 3, 4". Returns 4 digits or null. */
export function normalizePin(said: string): string | null {
  const out = String(said ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .map((w) => (/^\d+$/.test(w) ? w : WORDS[w] ?? '')).join('');
  return /^\d{4}$/.test(out) ? out : null;
}

export function hashPin(pin: string, salt = randomBytes(16).toString('hex')) {
  // Peppered with WALLET_SECRET when set: a leaked DB alone doesn't give up 4-digit PINs.
  const p = env.walletSecret ? createHmac('sha256', env.walletSecret).update(pin).digest('hex') : pin;
  return { salt, pinHash: scryptSync(p, salt, 32).toString('hex') };
}

const MAX_FAILS = 3, LOCK_MS = 15 * 60_000;
/** Checks a spoken PIN. Three wrong tries lock the wallet for 15 minutes. */
export function checkPin(b: Binding, said: string, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (b.lockedUntil && now < b.lockedUntil) return { ok: false, reason: `Too many wrong PINs. Locked for ${Math.ceil((b.lockedUntil - now) / 60_000)} more minutes.` };
  const pin = normalizePin(said);
  const good = !!pin && timingSafeEqual(Buffer.from(hashPin(pin, b.salt).pinHash, 'hex'), Buffer.from(b.pinHash, 'hex'));
  if (good) { b.fails = 0; b.lockedUntil = undefined; save(); return { ok: true }; }
  // The website demo wallet's PIN is public: a lockout would only let one visitor block everyone else.
  if (env.demoPhone && b.phone === env.demoPhone) return { ok: false, reason: `That's not the demo PIN: it's ${env.demoPin}, shown on the page.` };
  b.fails = (b.fails ?? 0) + 1;
  if (b.fails >= MAX_FAILS) { b.fails = 0; b.lockedUntil = now + LOCK_MS; save(); return { ok: false, reason: 'Wrong PIN three times. The wallet is locked for 15 minutes.' }; }
  save();
  return { ok: false, reason: `That PIN didn't match. ${MAX_FAILS - b.fails} tries left.` };
}

// ---- binding: a 6-digit code by WhatsApp, then the PIN ----

/** A code is for one action and one account: "bind to alice.near" or "give ownership to alice.near". */
export type CodePurpose = 'bind' | 'claim';
const codes = new Map<string, { hash: string; until: number; tries: number; purpose: CodePurpose; target: string }>();
export function newCode(phone: string, purpose: CodePurpose, target: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  codes.set(digits(phone), { hash: createHash('sha256').update(code).digest('hex'), until: Date.now() + 10 * 60_000, tries: 0, purpose, target });
  return code;
}
/** The WhatsApp text: names the action and the account, so nobody reads out a code without knowing what it gives away. */
export const codeText = (code: string, purpose: CodePurpose, target: string) => purpose === 'claim'
  ? `Ringfence: code ${code} gives OWNERSHIP of the wallet for this WhatsApp number to ${target}. Whoever has it can take the money. Never read it out or share it. Expires in 10 minutes.`
  : `Ringfence: code ${code} links this WhatsApp number to a wallet owned by ${target}, which can then spend within limits when this number calls. Only share it if you trust ${target}. Expires in 10 minutes.`;
/** Checks a code sent to the phone (expires in 10 minutes, 5 tries). Returns a reason, or null when it matches. */
function codeProblem(phone: string, code: string, purpose: CodePurpose, target: string): string | null {
  const c = codes.get(phone);
  if (!c || Date.now() > c.until || ++c.tries > 5) return 'The code expired. Ask for a new one.';
  if (c.purpose !== purpose || c.target !== target) return 'That code was sent for something else. Ask for a new one.';
  if (createHash('sha256').update(String(code).trim()).digest('hex') !== c.hash) return 'Wrong code.';
  return null;
}
const ownerReason = () => (env.network === 'mainnet' ? 'Mainnet accounts only (name.near or a 64-hex implicit account).' : 'Testnet accounts only (name.testnet or a 64-hex implicit account).');
/** Binds a phone to a wallet the connected account will own. Guardian setup is the same call: owner = the guardian's
 *  account, phone = the family member's (the code went to their phone and they read it out). */
export function bind(p: { phone: string; code: string; pin: string; owner: string }): { ok: true; binding: Binding } | { ok: false; reason: string } {
  const phone = digits(p.phone);
  const bad = codeProblem(phone, p.code, 'bind', p.owner);
  if (bad) return { ok: false, reason: bad };
  const old = bindingOf(phone);
  // Never overwrite a live wallet (custodial or someone else's): the factory refuses a second wallet anyway.
  if (old && !old.dryRun && (old.custodial || old.owner !== p.owner)) return { ok: false, reason: 'This number already has a wallet. Its owner can revoke it; a demo custodial wallet can be claimed at /wallet/claim.' };
  if (!/^\d{4}$/.test(String(p.pin))) return { ok: false, reason: 'The PIN is 4 digits.' };
  if (!ownerOk(p.owner)) return { ok: false, reason: ownerReason() };
  if (p.owner === env.agentAccountId) return { ok: false, reason: "The agent can't be the owner." };
  codes.delete(phone);
  const binding: Binding = { phone, owner: p.owner, contract: old && !old.dryRun ? old.contract : walletFor(phone), ...hashPin(p.pin), fails: 0, createdAt: Date.now(), frozenUntil: old?.frozenUntil };
  db.wallets = db.wallets.filter((b) => b.phone !== phone).concat(binding);
  save();
  return { ok: true, binding };
}

/** Named accounts on NETWORK, or a 64-hex implicit account (e.g. a fresh Meteor wallet). */
export const ownerOk = (a: string) => /^[0-9a-f]{64}$/.test(a) || (env.network === 'mainnet' ? /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.near$/ : /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.testnet$/).test(a);
/** Human-unit limits → the contract's init limits (yoctoNEAR, wei). The bind page lets the user edit them first. */
export function initLimits(l = env.walletDefaults) {
  const lim = (tx: bigint, day: bigint) => ({ per_tx: tx.toString(), per_day: day.toString() });
  return {
    near_limit: lim(nearToYocto(Number(l.nearPerTx)), nearToYocto(Number(l.nearPerDay))),
    evm_limit: lim(parseEther(l.evmPerTx), parseEther(l.evmPerDay)),
    new_recipient_delay_sec: l.delaySec,
  };
}
/** What the user signs on /wallet/bind: one plain function call, factory.create_wallet, so any wallet works
 *  (Meteor, implicit accounts). The page fills in the limits as edited. Nothing runs until they sign. */
export function bindTx(b: Binding) {
  const { near_limit, new_recipient_delay_sec } = initLimits();
  return {
    receiverId: env.factoryAccountId,
    method: 'create_wallet',
    deposit: CREATE_DEPOSIT.toString(),
    args: { phone_hash: phoneHash(b.phone), owner: b.owner, agent: env.agentAccountId || null, near_limit, new_recipient_delay_sec },
  };
}

// ---- chain ----

export const live = () => !!(env.agentAccountId && env.agentKey);
export const custodyLive = () => !!(env.custodyAccountId && env.custodyKey);
export const explorer = { near: (h: string) => net(env.network).explorer(h), evm: (chainId: number, h: string) => txUrl(chainById(chainId)!, h) };

/** The contract's state, checked against this binding: the owner signed this phone's hash and our agent is set. */
export async function walletState(b: Binding): Promise<WalletState> {
  // The address always comes from the factory, never from a guess: a guessed address could be someone else's account.
  const real = await view<string | null>('get_wallet', { phone_hash: phoneHash(b.phone) }, env.network, env.factoryAccountId).catch(() => null);
  if (!real) throw new Error('The factory has no wallet for this phone yet.');
  if (real !== b.contract) { b.contract = real; save(); }
  const s = await view<WalletState>('get_state', {}, env.network, b.contract);
  if (b.pendingOwner && s.owner === b.pendingOwner) finishClaimWith(b, s.owner);
  if (s.owner !== b.owner || s.phone_hash !== phoneHash(b.phone)) throw new Error('This phone is not the one bound to that wallet contract.');
  if (s.agent !== env.agentAccountId) throw new Error('The agent is not (or no longer) allowed on this wallet.');
  if (b.custodial && !s.custodial) throw new Error('This phone is not the one bound to that wallet: it should be in custodial mode.');
  return s;
}

const account = (id: string, key: string) => new Account(id, new JsonRpcProvider({ url: net(env.network).rpc }), key as KeyPairString);
const agent = () => account(env.agentAccountId, env.agentKey);
const custody = () => account(env.custodyAccountId, env.custodyKey);
async function callContract(contract: string, method: string, args: object, deposit = 0n, signer = agent()) {
  const out: any = await signer.signAndSendTransaction({ receiverId: contract, actions: [actions.functionCall(method, args, 300_000_000_000_000n, deposit)] });
  return { hash: out.transaction.hash as string, result: getTransactionLastResult(out) };
}

export async function sendNear(b: Binding, to: string, yocto: bigint) {
  const r = await callContract(b.contract, 'transfer_near', { to, amount: yocto.toString() });
  return { txHash: r.hash, url: explorer.near(r.hash), queuedId: r.result as number | null };
}

/** USDC (any NEP-141): the contract checks the token's limits and registers the recipient with the token first. */
export async function sendFt(b: Binding, token: string, to: string, units: bigint) {
  const r = await callContract(b.contract, 'transfer_ft', { token, to, amount: units.toString() });
  return { txHash: r.hash, url: explorer.near(r.hash), queuedId: r.result as number | null };
}
export const ftBalance = (token: string, account: string) => view<string>('ft_balance_of', { account_id: account }, env.network, token);

export async function ethAddressOf(b: Binding) {
  const root = await view<string>('public_key', {}, env.network, env.mpcSigner);
  return deriveEthAddress(root, b.contract, ETH_PATH).address;
}

/** Any allowed EVM chain. prepareTransfer checks gas first: no signature request without it (GasShortError). */
export async function sendEvm(b: Binding, chainId: number, to: string, wei: bigint) {
  // The default (NEAR-only) wallet wasm has no request_signature: never call it unless EVM_ENABLED.
  if (!env.evmEnabled) throw new Error('Only NEAR transfers for now (EVM_ENABLED is off).');
  const chain = chainById(chainId);
  if (!chain) throw new Error(`unknown chain ${chainId}`);
  const tx = await prepareTransfer(chain, await ethAddressOf(b), to, wei);
  const r = await callContract(b.contract, 'request_signature', { chain: `evm:${chainId}`, tx: tx.unsignedSerialized });
  if (typeof r.result === 'number' || typeof r.result === 'string') return { txHash: r.hash, url: explorer.near(r.hash), queuedId: Number(r.result) };
  const hash = await broadcast(chain, attachSignature(tx, r.result as MpcSignature));
  return { txHash: hash, url: explorer.evm(chainId, hash), nearTx: r.hash, queuedId: null };
}

// ---- custodial wallets (WhatsApp only, claim later). UNAUDITED demo: capped balance and a daily creation cap. ----

const DAY = 24 * 3600_000;
export const NO_WALLET = () => `This number has no wallet yet. Two ways in:\n1. Reply "create a wallet" for a demo wallet right here (custodial, small amounts).\n2. Or bind your own NEAR wallet: ${env.publicUrl}/wallet/bind`;
export const CUSTODIAL_INTRO = () => `I can make you a demo wallet now. It's custodial: Ringfence holds the owner key until you claim it to your own NEAR wallet at ${env.publicUrl}/wallet/claim. The AI can only spend within limits (${env.walletDefaults.nearPerTx} NEAR a send, ${env.walletDefaults.nearPerDay} a day). The contract is unaudited: keep it under ${env.custodialMaxNear} NEAR; above that, spends stop.\nTo go ahead, reply with a 4-digit PIN you'll say on calls (or "cancel").`;

export async function createCustodial(phone: string, pin: string, now = Date.now()): Promise<{ ok: true; binding: Binding; message: string } | { ok: false; reason: string }> {
  phone = digits(phone);
  const old = bindingOf(phone);
  if (old && !old.dryRun) return { ok: false, reason: 'This number already has a wallet.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, reason: 'The PIN is 4 digits.' };
  if (db.wallets.filter((b) => b.custodial && !b.dryRun && now - b.createdAt < DAY).length >= env.custodialDailyCap)
    return { ok: false, reason: `Today's demo wallets are all handed out. Try tomorrow, or bind your own: ${env.publicUrl}/wallet/bind` };
  const b: Binding = { phone, owner: env.custodyAccountId, contract: walletFor(phone), custodial: true, ...hashPin(pin), fails: 0, createdAt: now };
  if (!custodyLive()) {
    b.dryRun = true;
    db.wallets = db.wallets.filter((x) => x.phone !== phone).concat(b);
    log({ kind: 'wallet', desk: 'wallet', detail: `DRY RUN (no CUSTODY_PRIVATE_KEY): would create custodial wallet ${b.contract}` });
    return { ok: true, binding: b, message: `DEMO DRY RUN: this server has no custody key, so nothing was created on chain. Your PIN is saved (hashed), so you can try a call; sends are dry runs too.` };
  }
  const r = await callContract(env.factoryAccountId, 'create_wallet', { phone_hash: phoneHash(phone), owner: env.custodyAccountId, custodial: true }, CREATE_DEPOSIT, custody());
  if (!r.result) return { ok: false, reason: 'The factory refused to create the wallet. Try again later.' };
  b.contract = String(r.result);
  db.wallets = db.wallets.filter((x) => x.phone !== phone).concat(b);
  log({ kind: 'wallet', desk: 'wallet', detail: `custodial wallet ${b.contract} created: ${explorer.near(r.hash)}` });
  return { ok: true, binding: b, message: `Done. Your demo wallet is ${b.contract} (custodial: Ringfence holds the owner key until you claim it at ${env.publicUrl}/wallet/claim). Send NEAR to that address to fund it, keep it under ${env.custodialMaxNear} NEAR, then call this number and say "send 0.1 NEAR to liho.near".` };
}

/** WhatsApp chat onboarding for numbers with no wallet. Returns the reply, or null to hand the message to the agent.
 *  The PIN message is answered here and never reaches the transcript or the logs. */
const onboarding = new Set<string>();
export async function onboard(from: string, text: string): Promise<string | null> {
  const phone = digits(from), t = String(text ?? '').trim();
  const had = bindingOf(phone);
  if (had && !had.dryRun && !onboarding.has(phone)) return null;
  if (onboarding.has(phone)) {
    if (/^(cancel|no|stop)\b/i.test(t)) { onboarding.delete(phone); return 'Cancelled. Nothing was created.'; }
    if (!/^\d{4}$/.test(t.replace(/\s/g, ''))) return 'Send 4 digits for your PIN, or "cancel".';
    onboarding.delete(phone);
    const r = await createCustodial(phone, t.replace(/\s/g, '')).catch((e) => ({ ok: false as const, reason: `Creating the wallet failed: ${String(e?.message ?? e).slice(0, 120)}` }));
    return r.ok ? r.message : r.reason;
  }
  if (/\b(create|make|open|new)\b.*\bwallet\b/i.test(t)) { onboarding.add(phone); return CUSTODIAL_INTRO(); }
  if (had) return null; // a dry-run wallet: everything else goes to the agent
  return null;
}

// ---- claim: custody -> the user's own account (propose_owner by custody, accept_owner signed by them) ----

export async function startClaim(p: { phone: string; code: string; newOwner: string }): Promise<{ ok: true; receiverId: string; method: 'accept_owner'; dryRun: boolean } | { ok: false; reason: string }> {
  const phone = digits(p.phone);
  const b = bindingOf(phone);
  if (!b?.custodial) return { ok: false, reason: 'This number has no custodial wallet to claim.' };
  const bad = codeProblem(phone, p.code, 'claim', p.newOwner);
  if (bad) return { ok: false, reason: bad };
  if (!ownerOk(p.newOwner)) return { ok: false, reason: ownerReason() };
  if (p.newOwner === env.agentAccountId || p.newOwner === env.custodyAccountId) return { ok: false, reason: 'Pick your own account, not the agent or custody account.' };
  codes.delete(phone);
  if (custodyLive() && !b.dryRun) await callContract(b.contract, 'propose_owner', { new_owner: p.newOwner }, 1n, custody());
  else log({ kind: 'wallet', desk: 'wallet', detail: `DRY RUN (no CUSTODY_PRIVATE_KEY): would propose ${p.newOwner} as owner of ${b.contract}` });
  b.pendingOwner = p.newOwner;
  save();
  return { ok: true, receiverId: b.contract, method: 'accept_owner', dryRun: !custodyLive() || !!b.dryRun };
}
function finishClaimWith(b: Binding, owner: string) {
  Object.assign(b, { owner, custodial: false, pendingOwner: undefined });
  save();
  log({ kind: 'wallet', desk: 'wallet', detail: `claimed: ${b.contract} now owned by ${owner}; custody key no longer used for it` });
}
/** After the new owner signed accept_owner: the chain must show them as owner, then custody control is forgotten. */
export async function finishClaim(phone: string): Promise<{ ok: true; owner: string } | { ok: false; reason: string }> {
  const b = bindingOf(phone);
  if (!b?.pendingOwner) return { ok: false, reason: 'No claim in progress for this number.' };
  const s = await view<WalletState>('get_state', {}, env.network, b.contract).catch(() => null);
  if (s?.owner !== b.pendingOwner) return { ok: false, reason: 'The wallet does not show you as owner yet: sign accept_owner first.' };
  finishClaimWith(b, s.owner);
  return { ok: true, owner: s.owner };
}

/** Reject button: owner-only freeze is not available to the server's agent key, so the server itself refuses spends
 *  for 15 minutes; a custodial wallet is also frozen on chain with the custody key. */
export async function rejectFreeze(b: Binding, now = Date.now()) {
  b.frozenUntil = now + 15 * 60_000;
  save();
  let onChain = '';
  if (b.custodial && !b.dryRun && custodyLive())
    onChain = await callContract(b.contract, 'freeze', { until_ts: String(Math.floor(b.frozenUntil / 1000)) }, 1n, custody()).then((r) => ` and on chain (${r.hash})`, (e) => ` (on-chain freeze failed: ${String(e?.message ?? e).slice(0, 80)})`);
  log({ kind: 'refused', desk: 'wallet', detail: `Rejected on WhatsApp: ${b.contract} frozen for 15 minutes on the server${onChain}` });
}
