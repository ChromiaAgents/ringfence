// The wallet desk: "send 0.1 NEAR to liho.testnet", read back, then confirmed by tier: up to SMALL_LIMIT NEAR to a saved
// recipient by spoken 4-digit PIN; more (still within limits) by an Approve tap on WhatsApp to the bound phone; over a
// limit or to a new recipient, a link to sign in their own wallet. The phone-wallet contract enforces the limits either
// way. NETWORK picks testnet or mainnet. UNAUDITED: keep small amounts.
import { randomBytes } from 'node:crypto';
import { parseUnits, formatUnits } from 'ethers';
import { env } from '../config.ts';
import { db, log, type Call } from '../store.ts';
import { nearToYocto, yoctoToNear } from '../memecook.ts';
import { bindingOf, checkPin, normalizePin, live, sendEvm, sendNear, walletState, ethAddressOf, rejectFreeze, NO_WALLET, digits, type Binding, type WalletState } from '../wallet.ts';
import { CHAINS, chainById, findChain, defaultChainIds } from '../chains.ts';
import { GasShortError, prepareTransfer } from '../eth.ts';
import type { DeskDef } from './types.ts';

/** "near", or "evm:<chainId>" for an EVM chain's native coin. */
export type Asset = 'near' | `evm:${number}`;
type Transfer = { to: string; amount: string; asset: Asset; base: bigint; tier?: 'pin' | 'approve' };
const pending = new Map<string, Transfer>();
const links = new Map<string, { url: string; label: string }>();
const chainOf = (a: Asset) => (a === 'near' ? undefined : chainById(Number(a.slice(4))));
const suffix = () => (env.network === 'mainnet' ? 'near' : 'testnet');
const chainList = () => CHAINS.filter((c) => !!c.testnet === (env.network === 'testnet')).map((c) => c.name).join(', ');

/** Spoken recipients: "liho dot near" → liho.near; "0x12AB…" kept as an address. */
export function parseRecipient(raw: string, asset: Asset): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
  if (asset !== 'near') return /^0x[0-9a-f]{40}$/.test(s) ? s : null;
  return new RegExp(`^([a-z0-9_-]+\\.)*[a-z0-9_-]+\\.${suffix()}$|^[0-9a-f]{64}$`).test(s) ? s : null;
}
/** "near" / "" → near; a chain name or alias ("base", "arbitrum", "bnb", "evm:8453") → evm:<id>. Plain "eth" is ambiguous → null. */
export const parseAsset = (a: string): Asset | null => {
  if (/^(near)?$/i.test(String(a ?? '').trim())) return 'near';
  const c = findChain(a);
  return c ? `evm:${c.id}` : null;
};
/** "5 NEAR to liho dot near" / "0.0001 ETH on Base to address 0x1111 ending 1111": what the agent reads back. */
export const readBack = (t: { to: string; amount: string; asset: Asset }) => {
  const c = chainOf(t.asset);
  return `${t.amount} ${c ? `${c.symbol} on ${c.name}` : 'NEAR'} to ${t.to.startsWith('0x') ? `address ${t.to.slice(0, 6)} ending ${t.to.slice(-4)}` : t.to.replace(/\./g, ' dot ')}`;
};
const selfSign = (t: Transfer) => `${env.publicUrl}/wallet/send?to=${encodeURIComponent(t.to)}&amount=${t.amount}`;
const fmt = (asset: string, base: bigint | string) => {
  if (asset === 'near') return `${yoctoToNear(base)} NEAR`;
  const c = chainById(Number(asset.replace(/^evm:/, '')));
  return `${formatUnits(BigInt(base), c?.decimals ?? 18)} ${c?.symbol ?? ''} on ${c?.name ?? asset}`;
};

const tools = [
  { type: 'function', function: { name: 'get_balance', description: "The caller's phone-wallet balance and today's limits.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_spending', description: 'How much did I spend? Today\'s spending against the daily limit, and the last 5 transfers.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'prepare_transfer', description: 'Get a transfer ready. Read back the returned read_back, then follow its next: ask for the 4-digit PIN, or tell them to tap Approve on WhatsApp.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'NEAR account like liho.near (liho.testnet on testnet), or a 0x address for an EVM chain' }, amount: { type: 'string' }, asset: { type: 'string', description: '"near", or the EVM chain name for its native coin: base, ethereum, arbitrum, optimism, polygon, bnb, avalanche (sepolia on testnet)' } }, required: ['to', 'amount', 'asset'] } } },
  { type: 'function', function: { name: 'confirm_transfer', description: 'After the caller says their PIN. Pass exactly what they said.', parameters: { type: 'object', properties: { pin: { type: 'string' } }, required: ['pin'] } } },
];

export const ONLY_NEAR = 'Only NEAR transfers for now, sorry. I can send NEAR, or check your balance.';
const system = () => `You are Ringfence's wallet desk. The caller's WhatsApp number is bound to their own NEAR ${env.network} wallet contract; ${env.evmEnabled ? `you can send NEAR, or the native coin of an EVM chain the owner allowed (${chainList()}),` : 'you can send NEAR (only NEAR for now: politely decline other chains or coins),'} within limits the contract enforces.
For a transfer: call prepare_transfer and read back its read_back exactly ("0.1 NEAR to liho dot ${suffix()}"). Then do what its next says: up to ${env.smallLimitNear} NEAR, ask for their 4-digit PIN and call confirm_transfer with what they said (never repeat the PIN aloud); above that, tell them an Approve button is on their WhatsApp, valid for two minutes, and do not ask for a PIN. For "how much did I spend", call get_spending.${env.evmEnabled ? ' If they say just "ETH", ask which chain.\nTheir EVM address is the same on every EVM chain: they fund gas on whichever chain they want to use.' : ''}
If a tool refuses, say why in plain words. If a link was sent, say it's on WhatsApp. ${env.network === 'mainnet' ? 'This is mainnet, real money, and an unaudited prototype: suggest small amounts.' : 'Testnet only: no real money.'} Never give financial advice.`;

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const b = bindingOf(call.from);
  const refuse = (reason: string, extra: object = {}) => { log({ kind: 'refused', desk: 'wallet', callId: call.id, detail: `${name}: ${reason}` }); return { ok: false, reason, ...extra }; };
  // EVM sends are off unless EVM_ENABLED: anything but NEAR (a chain name, "ETH", an unknown coin) gets the same polite no.
  if (name === 'prepare_transfer' && !env.evmEnabled && parseAsset(a.asset) !== 'near') return refuse(ONLY_NEAR);
  if (!b && call.channel === 'web') return browserDemo(call, name, a);
  if (!b) {
    links.set(call.id, { url: `${env.publicUrl}/wallet/bind`, label: NO_WALLET() });
    return refuse('This number has no wallet yet. Two ways in: text "create a wallet" to this number for a demo custodial wallet, or bind your own NEAR wallet: the link is on WhatsApp.', { linkSent: true });
  }
  const state = live() && !b.dryRun ? await walletState(b).catch((e) => e as Error) : null;
  if (state instanceof Error) return refuse(state.message.includes('bound') || state.message.includes('agent') ? state.message : 'Your wallet contract is not set up yet. Finish the binding page and sign it.');
  const tag = b.custodial ? ' (demo custodial wallet)' : '';

  if (name === 'get_spending') return spending(b, state);
  if (name === 'prepare_transfer' || name === 'confirm_transfer') {
    const stop = frozen(b, state);
    if (stop) return refuse(stop);
  }

  if (name === 'get_balance') {
    if (!state) return { ok: true, dryRun: true, note: 'DRY RUN: no agent key on this server, so no chain read. Say so.' };
    const evm = env.evmEnabled ? await ethAddressOf(b).catch(() => null) : null;
    return { ok: true, balance: fmt('near', state.balance), evmAddress: evm, evmNote: evm ? `Your EVM address is ${evm}, the same on every EVM chain. Fund gas on whichever chain you want to use.` : null,
      enabledChains: !env.evmEnabled ? [] : (state.chains ?? []).map((id) => chainById(id)?.name ?? `chain ${id}`), limits: Object.fromEntries(Object.entries(state.limits).filter(([k]) => env.evmEnabled || k === 'near').map(([k, l]) => [k, `${fmt(k as Asset, l.per_tx)} per transfer, ${fmt(k as Asset, l.per_day)} per day`])) };
  }
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (!asset) return refuse(`Which chain? I can send NEAR, or the native coin on ${chainList()}.`);
    const chain = chainOf(asset);
    const to = parseRecipient(a.to, asset);
    if (!to) return refuse(asset === 'near' ? `I need a NEAR ${env.network} account, like liho dot ${suffix()}.` : `I need a 0x address for ${chain!.name}: text it to me.`);
    const amount = String(a.amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return refuse('How much? Say a number.');
    const t: Transfer = { to, amount, asset, base: asset === 'near' ? nearToYocto(Number(amount)) : parseUnits(amount, chain!.decimals) };
    // The contract would refuse these anyway; here we say so early and hand over a self-sign link.
    if (state) {
      if (chain && !(state.chains ?? []).includes(chain.id)) return refuse(`${chain.name} is not enabled on your wallet. You can allow it on your wallet contract with allow_chain, with its own limits.`);
      const l = state.limits[asset], spent = BigInt(state.spent_today[asset] ?? 0);
      const over = !l ? 'no limit is set for that asset' : t.base > BigInt(l.per_tx) ? `that is over your ${fmt(asset, l.per_tx)} per-transfer limit` : spent + t.base > BigInt(l.per_day) ? `that would pass your ${fmt(asset, l.per_day)} daily limit` : '';
      const isNew = !state.allowlist.includes(to);
      if (!over && !isNew && chain) {
        // No signature request without gas: say how much is missing and where to send it.
        const from = await ethAddressOf(b);
        const short = await prepareTransfer(chain, from, to, t.base).then(() => null, (e) => (e instanceof GasShortError ? e.message : null));
        if (short) return refuse(short, { evmAddress: from });
      }
      if (over || isNew) {
        if (asset !== 'near') return refuse(`I can't: ${over || 'that address is not on your saved list'}. Raise the limit or save the address on your wallet page.`);
        links.set(call.id, { url: selfSign(t), label: `Sign ${readBack(t)} in your own wallet` });
        return refuse(`I can't send that myself: ${over || `${to} is a new recipient`}. A link to sign it in your own wallet is on WhatsApp.`, { linkSent: true });
      }
    }
    // Tier: small NEAR sends (and EVM, off by default) by spoken PIN; larger ones by the WhatsApp Approve tap.
    t.tier = asset === 'near' && t.base > nearToYocto(Number(env.smallLimitNear)) ? 'approve' : 'pin';
    if (t.tier === 'pin') {
      pending.set(call.id, t);
      return { ok: true, read_back: readBack(t) + tag, next: 'Ask for their 4-digit PIN.' };
    }
    pending.delete(call.id);
    const l = state?.limits.near;
    const left = l ? fmt('near', BigInt(l.per_day) - BigInt(state!.spent_today.near ?? 0) - t.base) : 'unknown (dry run)';
    const sent = await askApproval(b, call.id, t, left);
    return { ok: true, read_back: readBack(t) + tag, approvalSent: true, whatsapp: sent, next: 'Tell them: an Approve button is on their WhatsApp, valid for two minutes. Do not ask for a PIN.' };
  }
  if (name === 'confirm_transfer') {
    const t = pending.get(call.id);
    if (!t) return refuse('Nothing to confirm: prepare a transfer first.');
    if (t.tier === 'approve') return refuse('This one needs the Approve tap on WhatsApp, not a PIN.');
    // The PIN is taken from what the caller said, and blanked from the stored transcript.
    const turn = [...call.turns].reverse().find((x) => x.who === 'caller');
    const v = checkPin(b, String(a.pin ?? turn?.text ?? ''));
    if (turn) turn.text = '[PIN]';
    if (!v.ok) return refuse(v.reason);
    pending.delete(call.id);
    const r = await execute(call.id, b, t);
    return r.ok ? r : refuse(r.reason);
  }
  return { error: 'unknown tool' };
}

/** Server-side stops before any spend: a Reject freeze, an on-chain freeze, or a custodial wallet over its balance cap. */
export function frozen(b: Binding, s: WalletState | null, now = Date.now()): string | null {
  if (b.frozenUntil && now < b.frozenUntil) return `Spending is paused for ${Math.ceil((b.frozenUntil - now) / 60_000)} more minutes because a transfer was rejected on WhatsApp.`;
  if (s && BigInt(s.frozen_until_ns ?? 0) > BigInt(now) * 1_000_000n) return 'The owner has frozen this wallet, so I can\'t send anything right now.';
  if (b.custodial && s && BigInt(s.balance) > nearToYocto(Number(env.custodialMaxNear)))
    return `This demo custodial wallet holds more than ${env.custodialMaxNear} NEAR, over its cap, so spends are stopped. Claim it to your own wallet at ${env.publicUrl}/wallet/claim.`;
  return null;
}

async function execute(callId: string, b: Binding, t: Transfer): Promise<{ ok: true; [k: string]: unknown } | { ok: false; reason: string }> {
  if (!live() || b.dryRun) {
    log({ kind: 'wallet', desk: 'wallet', callId, detail: `DRY RUN (${b.dryRun ? 'no CUSTODY_PRIVATE_KEY' : 'no AGENT_PRIVATE_KEY'}): would send ${readBack(t)} from ${b.contract}${b.custodial ? ' (custodial)' : ''}` });
    return { ok: true, dryRun: true, txHash: `dry-run-${callId}`, note: 'DRY RUN: this server has no agent key, so nothing was sent. Say clearly it was a dry run.' };
  }
  const r = await (t.asset === 'near' ? sendNear(b, t.to, t.base) : sendEvm(b, chainOf(t.asset)!.id, t.to, t.base)).catch((e) => e as Error);
  if (r instanceof GasShortError) return { ok: false, reason: r.message };
  if (r instanceof Error) return { ok: false, reason: `The wallet contract refused: ${r.message.slice(0, 160)}` };
  log({ kind: 'wallet', desk: 'wallet', callId, detail: `${readBack(t)} from ${b.contract}: ${r.url}${r.queuedId != null ? ` (queued #${r.queuedId})` : ''}` });
  links.set(callId, { url: r.url, label: r.queuedId != null ? 'Queued transfer' : 'Your transaction' });
  return { ok: true, txHash: r.txHash, url: r.url, linkSent: true, queued: r.queuedId != null };
}

/** "How much did I spend?": today's spend vs the daily limit from the contract, last 5 transfers from the ledger. */
function spending(b: Binding, s: WalletState | null) {
  const last = db.ledger.filter((l) => l.kind === 'wallet' && l.detail.includes(` from ${b.contract}`)).slice(-5).reverse()
    .map((l) => `${new Date(l.at).toISOString().slice(0, 16).replace('T', ' ')} ${l.detail.split(` from ${b.contract}`)[0]}`);
  if (!s) return { ok: true, dryRun: true, last, note: 'DRY RUN: no chain read, so today\'s total is not known. Say so, then list the recent transfers.' };
  const l = s.limits.near;
  return { ok: true, spentToday: fmt('near', s.spent_today.near ?? '0'), dailyLimit: fmt('near', l.per_day), leftToday: fmt('near', BigInt(l.per_day) - BigInt(s.spent_today.near ?? 0)), last };
}

// ---- WhatsApp Approve / Reject (larger sends) ----

type Approval = { phone: string; callId: string; t: Transfer; until: number };
const approvals = new Map<string, Approval>();
const APPROVAL_MS = 120_000;
let buttons: ((to: string, body: string, token: string) => Promise<unknown>) | undefined;
/** Set by src/whatsapp.ts when WhatsApp is configured: sends the interactive [Approve] [Reject] message. */
export const setApprovalSender = (f: typeof buttons) => (buttons = f);
/** Whoever is on the call (browser socket, WhatsApp voice) hears what happened after the tap. */
const news = new Map<string, (s: string) => void>();
export const onCallNews = (callId: string, f: ((s: string) => void) | null) => (f ? news.set(callId, f) : news.delete(callId));

async function askApproval(b: Binding, callId: string, t: Transfer, left: string) {
  const token = randomBytes(16).toString('hex');
  approvals.set(token, { phone: b.phone, callId, t, until: Date.now() + APPROVAL_MS });
  const body = `Approve this transfer?\n${t.amount} NEAR to ${t.to}\nFrom ${b.contract}${b.custodial ? ' (demo custodial)' : ''}\nDaily limit left after it: ${left}\nExpires in 2 minutes. If you didn't ask for this, tap Reject: spending pauses for 15 minutes.`;
  if (!buttons) { console.log(`[wallet] no WhatsApp token: approval for ${b.phone}: approve:${token} / reject:${token}`); return false; }
  await buttons(b.phone, body, token).catch((e) => console.error('approval buttons', e));
  return true;
}

/** A button tap (interactive.button_reply id "approve:<token>" / "reject:<token>"). Single use, 120 s, only from the bound phone. */
export async function onButton(from: string, id: string, now = Date.now()): Promise<string> {
  const [verb, token] = String(id).split(':');
  const a = approvals.get(token ?? '');
  if (!a || digits(from) !== a.phone) return 'That approval is not valid any more.';
  approvals.delete(token);
  if (now > a.until) return 'That approval expired (2 minutes). Ask again on the call.';
  const b = bindingOf(a.phone);
  if (!b) return 'This number has no wallet any more.';
  const call = db.calls.find((c) => c.id === a.callId);
  const say = (s: string) => { call?.turns.push({ at: Date.now(), who: 'agent', text: s }); news.get(a.callId)?.(s); return s; };
  if (verb === 'reject') {
    await rejectFreeze(b, now);
    say('You rejected it on WhatsApp, so nothing was sent. Spending is paused for 15 minutes.');
    return 'Rejected. Nothing was sent, and the agent cannot spend from this wallet for 15 minutes.';
  }
  if (verb !== 'approve') return 'Unknown button.';
  const stop = frozen(b, null, now);
  if (stop) return say(stop);
  const r = await execute(a.callId, b, a.t);
  if (!r.ok) return say(`It didn't go through: ${r.reason}`);
  log({ kind: 'wallet', desk: 'wallet', callId: a.callId, detail: `approved on WhatsApp: ${readBack(a.t)}` });
  if (r.dryRun) return say(`Approved. This was a dry run: no agent key on this server, so nothing was sent.`);
  return say(`Approved and sent: ${readBack(a.t)}. ${r.url}`);
}

// A browser call has no phone number, so no wallet is bound to it. It walks the same steps (read back, spoken PIN,
// the contract's mainnet default limits) and always stops at a labelled dry run: nothing is read from or sent to a chain.
const DEMO_LIMIT = { per_tx: 1, unit: 'NEAR' };
function browserDemo(call: Call, name: string, a: any): unknown {
  const note = 'BROWSER DEMO: a browser call has no phone number, so no wallet is bound and nothing is sent. Say so plainly.';
  if (name === 'get_balance' || name === 'get_spending') return { ok: true, dryRun: true, demo: true, note };
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (asset !== 'near') return { ok: false, reason: 'The browser demo walks a NEAR transfer. Try "send 0.5 NEAR to liho.near".' };
    const to = String(a.to ?? '').trim().toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
    if (!/^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|testnet)$/.test(to)) return { ok: false, reason: 'I need a NEAR account, like liho dot near.' };
    const amount = String(a.amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return { ok: false, reason: 'How much? Say a number.' };
    if (Number(amount) > DEMO_LIMIT.per_tx) return { ok: false, demo: true, reason: `That is over the ${DEMO_LIMIT.per_tx} ${DEMO_LIMIT.unit} per-transfer default, so the contract would refuse it. Try 0.5 NEAR.` };
    const t: Transfer = { to, amount, asset, base: nearToYocto(Number(amount)) };
    if (Number(amount) > Number(env.smallLimitNear)) return { ok: true, demo: true, approvalDemo: true, read_back: readBack(t), note: `${note} Above ${env.smallLimitNear} NEAR, a bound wallet gets an Approve button on WhatsApp instead of a PIN.` };
    pending.set(call.id, t);
    return { ok: true, read_back: readBack(t), next: 'Ask for their 4-digit PIN.', note };
  }
  if (name === 'confirm_transfer') {
    const t = pending.get(call.id);
    if (!t) return { ok: false, reason: 'Nothing to confirm: prepare a transfer first.' };
    const turn = [...call.turns].reverse().find((x) => x.who === 'caller');
    const pin = normalizePin(String(a.pin ?? turn?.text ?? ''));
    if (turn) turn.text = '[PIN]';
    if (!pin) return { ok: false, reason: 'Say four digits.' };
    pending.delete(call.id);
    log({ kind: 'wallet', desk: 'wallet', callId: call.id, detail: `BROWSER DEMO: would ask the contract to send ${readBack(t)}` });
    return { ok: true, dryRun: true, demo: true, txHash: `demo-${call.id}`, note };
  }
  return { error: 'unknown tool' };
}

export const walletDesk: DeskDef = {
  id: 'wallet',
  greeting: () => 'Wallet desk here. Who do you want to pay, and how much?',
  system,
  tools,
  run,
  link: (call) => links.get(call.id) ?? null,
};
