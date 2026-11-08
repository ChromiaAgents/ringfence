// Phone wallet (UNAUDITED PROTOTYPE: keep small amounts): a WhatsApp number bound to a per-user phone-wallet contract (contracts/phone-wallet).
// Here: the binding (code by WhatsApp, PIN as a salted scrypt hash), PIN checks with lockout, and the agent's calls to
// the contract. The contract enforces the limits; nothing here can spend more than it allows.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Account, JsonRpcProvider, actions, getTransactionLastResult, type KeyPairString } from 'near-api-js';
import { env } from './config.ts';
import { db, save } from './store.ts';
import { net, view } from './memecook.ts';
import { ETH_PATH, attachSignature, broadcast, deriveEthAddress, prepareTransfer, type MpcSignature } from './eth.ts';
import { chainById, defaultChainIds, txUrl } from './chains.ts';
import { parseEther } from 'ethers';
import { nearToYocto } from './memecook.ts';

export type Binding = { phone: string; owner: string; contract: string; pinHash: string; salt: string; fails: number; lockedUntil?: number; createdAt: number };
export type WalletState = {
  owner: string; agent: string | null; phone_hash: string; signer: string; balance: string;
  limits: Record<string, { per_tx: string; per_day: string }>; chains: number[]; allowlist: string[]; spent_today: Record<string, string>; new_recipient_delay_sec: number;
};

export const digits = (phone: string) => String(phone ?? '').replace(/\D/g, '');
export const phoneHash = (phone: string) => createHash('sha256').update(digits(phone)).digest('hex');
/** One contract per user, on their own sub-account (only the parent account can create it). */
export const contractFor = (owner: string) => `phone.${owner}`;
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
  return { salt, pinHash: scryptSync(pin, salt, 32).toString('hex') };
}

const MAX_FAILS = 3, LOCK_MS = 15 * 60_000;
/** Checks a spoken PIN. Three wrong tries lock the wallet for 15 minutes. */
export function checkPin(b: Binding, said: string, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (b.lockedUntil && now < b.lockedUntil) return { ok: false, reason: `Too many wrong PINs. Locked for ${Math.ceil((b.lockedUntil - now) / 60_000)} more minutes.` };
  const pin = normalizePin(said);
  const good = !!pin && timingSafeEqual(Buffer.from(hashPin(pin, b.salt).pinHash, 'hex'), Buffer.from(b.pinHash, 'hex'));
  if (good) { b.fails = 0; b.lockedUntil = undefined; save(); return { ok: true }; }
  b.fails = (b.fails ?? 0) + 1;
  if (b.fails >= MAX_FAILS) { b.fails = 0; b.lockedUntil = now + LOCK_MS; save(); return { ok: false, reason: 'Wrong PIN three times. The wallet is locked for 15 minutes.' }; }
  save();
  return { ok: false, reason: `That PIN didn't match. ${MAX_FAILS - b.fails} tries left.` };
}

// ---- binding: a 6-digit code by WhatsApp, then the PIN ----

const codes = new Map<string, { hash: string; until: number; tries: number }>();
export function newCode(phone: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  codes.set(digits(phone), { hash: createHash('sha256').update(code).digest('hex'), until: Date.now() + 10 * 60_000, tries: 0 });
  return code;
}
export function bind(p: { phone: string; code: string; pin: string; owner: string }): { ok: true; binding: Binding } | { ok: false; reason: string } {
  const phone = digits(p.phone);
  const c = codes.get(phone);
  if (!c || Date.now() > c.until || ++c.tries > 5) return { ok: false, reason: 'The code expired. Ask for a new one.' };
  if (createHash('sha256').update(String(p.code).trim()).digest('hex') !== c.hash) return { ok: false, reason: 'Wrong code.' };
  if (!/^\d{4}$/.test(String(p.pin))) return { ok: false, reason: 'The PIN is 4 digits.' };
  if (!ownerOk(p.owner)) return { ok: false, reason: env.network === 'mainnet' ? 'Mainnet accounts only (name.near).' : 'Testnet accounts only (name.testnet).' };
  codes.delete(phone);
  const binding: Binding = { phone, owner: p.owner, contract: contractFor(p.owner), ...hashPin(p.pin), fails: 0, createdAt: Date.now() };
  db.wallets = db.wallets.filter((b) => b.phone !== phone).concat(binding);
  save();
  return { ok: true, binding };
}

/** The transaction the user signs on /wallet/bind: create phone.<owner>, fund it, deploy, init. Nothing runs until they sign. */
export const ownerOk = (a: string) => (env.network === 'mainnet' ? /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.near$/ : /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.testnet$/).test(a);
/** Mainnet: a small fund (storage for the contract is about 2 NEAR); spend money is added by the owner later. */
export const FUND_NEAR = () => (env.network === 'mainnet' ? '2.5' : '3');
/** Human-unit limits → the contract's init limits (yoctoNEAR, wei). The bind page lets the user edit them first. */
export function initLimits(l = env.walletDefaults) {
  const lim = (tx: bigint, day: bigint) => ({ per_tx: tx.toString(), per_day: day.toString() });
  return {
    near_limit: lim(nearToYocto(Number(l.nearPerTx)), nearToYocto(Number(l.nearPerDay))),
    evm_limit: lim(parseEther(l.evmPerTx), parseEther(l.evmPerDay)),
    new_recipient_delay_sec: l.delaySec,
  };
}
export function bindTx(b: Binding) {
  return {
    receiverId: b.contract,
    deposit: FUND_NEAR(),
    network: env.network,
    defaults: env.walletDefaults,
    chains: defaultChainIds(env.network).map((id) => chainById(id)!.name),
    init: { owner: b.owner, agent: env.agentAccountId, phone_hash: phoneHash(b.phone), signer: env.mpcSigner, evm_chain_ids: defaultChainIds(env.network), ...initLimits() },
  };
}

// ---- chain ----

export const live = () => !!(env.agentAccountId && env.agentKey);
export const explorer = { near: (h: string) => net(env.network).explorer(h), evm: (chainId: number, h: string) => txUrl(chainById(chainId)!, h) };

/** The contract's state, checked against this binding: the owner signed this phone's hash and our agent is set. */
export async function walletState(b: Binding): Promise<WalletState> {
  const s = await view<WalletState>('get_state', {}, env.network, b.contract);
  if (s.owner !== b.owner || s.phone_hash !== phoneHash(b.phone)) throw new Error('This phone is not the one bound to that wallet contract.');
  if (s.agent !== env.agentAccountId) throw new Error('The agent is not (or no longer) allowed on this wallet.');
  return s;
}

const agent = () => new Account(env.agentAccountId, new JsonRpcProvider({ url: net(env.network).rpc }), env.agentKey as KeyPairString);
async function callContract(contract: string, method: string, args: object) {
  const out: any = await agent().signAndSendTransaction({ receiverId: contract, actions: [actions.functionCall(method, args, 300_000_000_000_000n, 0n)] });
  return { hash: out.transaction.hash as string, result: getTransactionLastResult(out) };
}

export async function sendNear(b: Binding, to: string, yocto: bigint) {
  const r = await callContract(b.contract, 'transfer_near', { to, amount: yocto.toString() });
  return { txHash: r.hash, url: explorer.near(r.hash), queuedId: r.result as number | null };
}

export async function ethAddressOf(b: Binding) {
  const root = await view<string>('public_key', {}, env.network, env.mpcSigner);
  return deriveEthAddress(root, b.contract, ETH_PATH).address;
}

/** Any allowed EVM chain. prepareTransfer checks gas first: no signature request without it (GasShortError). */
export async function sendEvm(b: Binding, chainId: number, to: string, wei: bigint) {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`unknown chain ${chainId}`);
  const tx = await prepareTransfer(chain, await ethAddressOf(b), to, wei);
  const r = await callContract(b.contract, 'request_signature', { chain: `evm:${chainId}`, tx: tx.unsignedSerialized });
  if (typeof r.result === 'number' || typeof r.result === 'string') return { txHash: r.hash, url: explorer.near(r.hash), queuedId: Number(r.result) };
  const hash = await broadcast(chain, attachSignature(tx, r.result as MpcSignature));
  return { txHash: hash, url: explorer.evm(chainId, hash), nearTx: r.hash, queuedId: null };
}
