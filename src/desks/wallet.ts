// The wallet desk: "send 0.1 NEAR to liho.testnet", read back, then confirmed by tier: up to SMALL_LIMIT NEAR to a saved
// recipient by spoken 4-digit PIN; more (still within limits) by the PIN and then an Approve tap on WhatsApp; over a
// limit or to a new recipient, a link to sign in their own wallet. The phone-wallet contract enforces the limits either
// way. NETWORK picks testnet or mainnet. UNAUDITED: keep small amounts.
import { randomBytes } from 'node:crypto';
import { parseUnits, formatUnits } from 'ethers';
import { env } from '../config.ts';
import { db, log, type Call } from '../store.ts';
import { yoctoToNear } from '../near.ts';
import { bindingOf, checkPin, normalizePin, live, devServer, custodyLive, sendEvm, sendNear, sendFt, ftBalance, walletState, ethAddressOf, rejectFreeze, digits, type Binding, type WalletState } from '../wallet.ts';
import { CHAINS, chainById, findChain, defaultChainIds } from '../chains.ts';
import { GasShortError, prepareTransfer } from '../eth.ts';
import { createPacket, refundExpired, packetsTo, packetUrl, norm, MIN_SHARE } from '../packets.ts';
import { hold, cancelHeld, minutes } from '../held.ts';
import type { DeskDef } from './types.ts';

/** "near", or "evm:<chainId>" for an EVM chain's native coin. */
export type Asset = 'near' | `evm:${number}` | `ft:${string}`;
/** NEAR and USDC (NEP-141) go to NEAR accounts; EVM chains to 0x addresses. */
const isFt = (a: Asset): a is `ft:${string}` => a.startsWith('ft:');
const USDC_DECIMALS = 6;
type Transfer = { to: string; amount: string; asset: Asset; base: bigint; tier?: 'pin' | 'approve'; until?: number;
  /** A money packet: the transfer goes to the packets contract, and the packet is recorded once it has arrived. */
  packet?: { count: number; lucky: boolean; words: string; expirySec?: number };
  /** A first payment to a new recipient from a phone-only wallet: the contract holds it this many seconds. */
  wait?: number };
const pending = new Map<string, Transfer>();
const PENDING_MS = 120_000;
/** Spoken PINs, taken out of the caller's words before the model sees them (see takePin). */
const spokenPins = new Map<string, string>();
/** Called by the agent before each caller turn: while a transfer waits for its PIN, a 4-digit utterance is kept here
 *  and the model (and transcript, and logs) only ever see "[PIN]". Returns true when the text was a PIN. */
/** The call ended: drop its waiting transfer and any PIN taken for it. */
export function clearPending(callId: string) { pending.delete(callId); spokenPins.delete(callId); }
export function takePin(callId: string, text: string): boolean {
  if (pending.has(callId)) {
    const pin = normalizePin(text);
    if (pin) spokenPins.set(callId, pin);
    return !!pin;
  }
  // Nothing waiting (the model skipped prepare_transfer): a reply that is only a PIN is still masked, never kept.
  // Only digits / number words / "my pin is": "send 0.10 NEAR to user0" has four digits but is not a PIN.
  return /^(\s*(my|pin|is|it's|its|the|um|uh|ok|\d+|zero|oh|one|two|three|four|five|six|seven|eight|nine)\b[\s,.]*)+$/i.test(text) && !!normalizePin(text);
}
/** Exact decimal amounts (no float rounding): what is read back is what is sent. */
const AMOUNT = /^\d+(\.\d{1,18})?$/;
const toYocto = (amount: string) => parseUnits(amount, 24);
const links = new Map<string, { url: string; label: string }>();
const chainOf = (a: Asset) => (a === 'near' ? undefined : chainById(Number(a.slice(4))));
const suffix = () => (env.network === 'mainnet' ? 'near' : 'testnet');
const chainList = () => CHAINS.filter((c) => !!c.testnet === (env.network === 'testnet')).map((c) => c.name).join(', ');

/** Spoken recipients: "liho dot near" → liho.near; "0x12AB…" kept as an address. */
export function parseRecipient(raw: string, asset: Asset): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
  if (asset !== 'near' && !isFt(asset)) return /^0x[0-9a-f]{40}$/.test(s) ? s : null;
  return new RegExp(`^([a-z0-9_-]+\\.)*[a-z0-9_-]+\\.${suffix()}$|^[0-9a-f]{64}$`).test(s) ? s : null;
}
/** "near" / "" → near; a chain name or alias ("base", "arbitrum", "bnb", "evm:8453") → evm:<id>. Plain "eth" is ambiguous → null. */
export const parseAsset = (a: string): Asset | null => {
  if (/^(near)?$/i.test(String(a ?? '').trim())) return 'near';
  if (/^(usdc|usd|dollars?|\$)$/i.test(String(a ?? '').trim())) return `ft:${env.usdcToken}`;
  const c = findChain(a);
  return c ? `evm:${c.id}` : null;
};
/** "5 NEAR to liho dot near" / "0.0001 ETH on Base to address 0x1111 ending 1111": what the agent reads back. */
export const readBack = (t: { to: string; amount: string; asset: Asset; packet?: Transfer['packet'] }) => {
  if (t.packet) return `a money packet of ${t.amount} NEAR for ${t.packet.count} ${t.packet.count === 1 ? 'person' : 'people'}, ${t.packet.lucky ? 'lucky' : 'equal'} split`;
  const c = chainOf(t.asset);
  return `${t.amount} ${c ? `${c.symbol} on ${c.name}` : isFt(t.asset) ? 'USDC' : 'NEAR'} to ${t.to.startsWith('0x') ? `address ${t.to.slice(0, 6)} ending ${t.to.slice(-4)}` : t.to.replace(/\./g, ' dot ')}`;
};
const selfSign = (t: Transfer) => `${env.publicUrl}/wallet/send?to=${encodeURIComponent(t.to)}&amount=${t.amount}`;
const fmt = (asset: string, base: bigint | string) => {
  if (asset === 'near') return `${yoctoToNear(base)} NEAR`;
  if (asset.startsWith('ft:')) return `${formatUnits(BigInt(base), USDC_DECIMALS).replace(/\.0$/, '')} USDC`;
  const c = chainById(Number(asset.replace(/^evm:/, '')));
  return `${formatUnits(BigInt(base), c?.decimals ?? 18)} ${c?.symbol ?? ''} on ${c?.name ?? asset}`;
};

const tools = [
  { type: 'function', function: { name: 'get_balance', description: "The caller's phone-wallet balance and today's limits.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_spending', description: 'How much did I spend? Today\'s spending against the daily limit, and the last 5 transfers.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'prepare_transfer', description: 'Get a transfer ready. Read back the returned read_back, then ask for the 4-digit PIN.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'NEAR account like liho.near (liho.testnet on testnet), or a 0x address for an EVM chain' }, amount: { type: 'string' }, asset: { type: 'string', description: '"near", "usdc" (US dollars: "send 50 dollars" is 50 USDC), or the EVM chain name for its native coin: base, ethereum, arbitrum, optimism, polygon, bnb, avalanche (sepolia on testnet)' } }, required: ['to', 'amount', 'asset'] } } },
  { type: 'function', function: { name: 'prepare_packet', description: 'Get a money packet (also called a red packet, red envelope, hongbao, angpao, 红包) ready: money for a group, opened by saying the words. Read back the returned read_back, then ask for the 4-digit PIN and call confirm_transfer.', parameters: { type: 'object', properties: { amount: { type: 'string', description: 'total NEAR in the packet' }, count: { type: 'integer', description: 'how many people share it' }, split: { type: 'string', description: '"lucky" (random shares, the default) or "equal"' }, words: { type: 'string', description: 'the short phrase people must say to open it, exactly as the caller said it' } }, required: ['amount', 'count', 'words'] } } },
  { type: 'function', function: { name: 'cancel_transfer', description: 'Stop the caller\'s payments that are waiting to go out (a first payment to a new account is held for a few minutes).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'confirm_transfer', description: 'After the caller says their PIN (you see it as [PIN]). Pass "[PIN]".', parameters: { type: 'object', properties: { pin: { type: 'string' } }, required: ['pin'] } } },
];

export const ONLY_NEAR = 'Only NEAR and USDC for now, sorry. I can send NEAR or USDC, or check your balance.';
const system = (call?: Call) => `${webDemo(call) ? `This is a browser call on the shared website demo wallet: real NEAR on ${env.network}, the contract's limits apply and it only pays its saved recipient ${env.demoRecipient} and money packets. A money packet from this wallet holds at most ${env.demoVisitorPacketNear} NEAR and expires after ${minutes(env.demoVisitorPacketExpirySec)}, then what is left goes back. If the wallet is too low for what they ask, the tool says so: tell them plainly. The demo PIN is on their screen. Above ${env.smallLimitNear} NEAR the Approve card appears on their screen (not WhatsApp): say so. Their own WhatsApp number can be bound to their own NEAR wallet contract;` : call?.channel === 'web' ? 'This is a browser call: no wallet is bound to it, so a transfer is a labelled demo and nothing is sent. Their WhatsApp number can be bound to their own NEAR wallet contract;' : `The caller's WhatsApp number can be bound to their own NEAR ${env.network} wallet contract;`} ${env.evmEnabled ? `you can send NEAR, or the native coin of an EVM chain the owner allowed (${chainList()}),` : 'you can send NEAR or USDC (stable US dollars on NEAR; politely decline other chains or coins). Amounts in dollars are USDC one to one ("send 50 dollars to the grocer" is 50 USDC),'} within limits the contract enforces.
For a money packet (a money gift for a group, the Chinese red packet; callers may also say "red packet", "red envelope", "gift", hongbao, angpao, 红包): call prepare_packet with the total in NEAR, how many people, lucky or equal split (lucky unless they ask for equal) and the words people must say to open it; never choose the words yourself: if they gave none, ask (you may suggest "merry christmas", "trick or treat" or "happy new year", and they say it back). Read back its read_back exactly, then the PIN and confirm_transfer as for a transfer. When it is created, tell them to share the link and the words with the family.
For a transfer: as soon as you have an amount and a recipient, your first tool call is prepare_transfer: it checks the limits before anything else. Never look up the account first and never ask "shall I go ahead" before prepare_transfer has answered. If it refuses because of a limit, say the amount, the limit and that nothing was sent, in that same reply. Read back its read_back exactly ("0.1 NEAR to liho dot ${suffix()}"). Then ask for their 4-digit PIN; their answer reaches you as [PIN]: call confirm_transfer with pin "[PIN]". Above ${env.smallLimitNear} NEAR, confirm_transfer then sends an Approve button to their WhatsApp: tell them to tap it within two minutes. For "how much did I spend", call get_spending. A first payment to an account a phone-only wallet has never paid is held by the contract for a few minutes before it goes (the tool says how long): tell them, and that saying "cancel" stops it (cancel_transfer).${env.evmEnabled ? ' If they say just "ETH", ask which chain.\nTheir EVM address is the same on every EVM chain: they fund gas on whichever chain they want to use.' : ''}
If a tool refuses, say why in plain words. ${call?.channel === 'web' ? 'If a link was sent, say it is on their screen.' : 'If a link was sent, say it is on WhatsApp.'} ${env.network === 'mainnet' ? 'Transfers are on mainnet, real money, and an unaudited prototype: suggest small amounts.' : 'Transfers are on testnet: no real money.'} Never give financial advice.`;

/** A browser call has no phone number: it uses the shared website demo wallet when one is configured. */
const webDemo = (call?: Call) => call?.channel === 'web' && !call.from && !!env.demoPhone && !!bindingOf(env.demoPhone);

/** The wallet for DEMO_WALLET_PHONE: its PIN is public, so visitors get tighter rules than a real user's wallet. */
const isDemoWallet = (b?: Pick<Binding, 'phone'> | null) => !!b && !!env.demoPhone && b.phone === env.demoPhone;
const linkPlace = (call: Call) => (call.channel === 'web' ? 'on your screen' : 'on WhatsApp');
const demoLow = (balance?: string) => `The shared demo wallet is too low for that right now${balance != null ? `: it holds ${fmt('near', balance)}` : ''}. Nothing was sent. Try a smaller amount, or come back after it is topped up.`;

/** Why a send of this size cannot go, or '': the per-transfer limit first, then the daily one. Read from the wallet
 *  contract's state; without one (dry run, RPC down), the configured per-transfer default. */
function overWhy(asset: Asset, base: bigint, state: WalletState | null, shared: boolean): string {
  const whose = shared ? 'the' : 'your', where = shared ? ' on this shared demo wallet' : '', what = fmt(asset, base);
  if (state) {
    const l = state.limits[asset];
    if (!l) return 'no limit is set for that asset';
    if (base > BigInt(l.per_tx)) return `${what} is over ${whose} ${fmt(asset, l.per_tx)} per-transfer limit${where}`;
    return BigInt(state.spent_today[asset] ?? 0) + base > BigInt(l.per_day) ? `${what} would pass ${whose} ${fmt(asset, l.per_day)} daily limit${where}` : '';
  }
  if (asset === 'near' && base > toYocto(env.walletDefaults.nearPerTx)) return `${what} is over ${whose} ${env.walletDefaults.nearPerTx} NEAR per-transfer limit${where}`;
  if (isFt(asset) && base > parseUnits(env.walletDefaults.usdcPerTx, USDC_DECIMALS)) return `${what} is over ${whose} ${env.walletDefaults.usdcPerTx} USDC per-transfer limit${where}`;
  return '';
}
/** The refusal for a send over a limit, worded for where the caller is: the shared demo wallet has no owner on the
 *  line (no link), a browser caller's link is on their screen, a WhatsApp caller's is on WhatsApp. */
function overStop(call: Call, t: { to?: string; amount: string; asset: Asset; base: bigint }, why: string, shared: boolean): { reason: string; extra: object } {
  const next = 'Say this now: the amount, the limit, and that nothing was sent. Do not look up the account and do not ask whether to go ahead.';
  if (shared) return { reason: `I can't send that: ${why}. Nothing was sent.`, extra: { next } };
  if (isFt(t.asset)) return { reason: `I can't send that: ${why}. The wallet's owner can raise the USDC limit.`, extra: { next } };
  if (t.asset !== 'near') return { reason: `I can't: ${why}. Raise the limit on your wallet page.`, extra: { next } };
  if (!t.to) return { reason: `I can't send that myself: ${why}. Nothing was sent.`, extra: { next } };
  links.set(call.id, { url: selfSign(t as Transfer), label: `Sign ${readBack(t as Transfer)} in your own wallet` });
  return { reason: `I can't send that myself: ${why}. A link to sign it in your own wallet is ${linkPlace(call)}.`, extra: { linkSent: true, next } };
}

/** A visitor's money packet from the shared demo wallet: why it cannot be made, or null. */
async function demoPacketStop(b: Binding, yocto: bigint, now = Date.now()): Promise<string | null> {
  const cap = env.demoVisitorPacketNear, life = minutes(env.demoVisitorPacketExpirySec);
  if (yocto > toYocto(cap)) return `On this shared demo wallet a money packet can hold at most ${cap} NEAR, and it expires after ${life}, then what is left goes back. Try ${cap} NEAR for 3 people.`;
  await refundExpired(now).catch(() => {}); // expired ones go back first, so they do not count as open
  const mine = db.packets.filter((p) => p.from === b.contract && !p.demo);
  const open = mine.filter((p) => !p.refunded && now < p.expiresAt && p.claims.length < p.count).length;
  if (open >= env.demoVisitorPacketsOpen) return `This shared demo wallet already has ${open} visitor money packets open, and ${env.demoVisitorPacketsOpen} is the most at once. Each one expires after ${life}. Try again later, or open the demo packet on the page.`;
  if (mine.filter((p) => p.createdAt > now - 86_400_000).length >= env.demoVisitorPacketsPerDay) return `Visitors have made ${env.demoVisitorPacketsPerDay} money packets from this shared demo wallet in the last 24 hours, and that is the most allowed. Try again later, or open the demo packet on the page.`;
  return null;
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000 };
const SEND_AMOUNT = new RegExp(`(?:\\b(?:send|pay|transfer|wire|give|move)\\b|[发發转轉付汇匯])[^.?!。？！]*?(\\$\\s*)?(\\d+(?:\\.\\d+)?|\\b(?:${Object.keys(NUM).filter((k) => /^[a-z]/.test(k)).join('|')})\\b|[一二两兩三四五六七八九十百千])\\s*[个個]?\\s*(near|usdc|usd|dollars?|bucks|美元|美金)?`, 'i');
/** Does this reply name the limit ("1 NEAR", "one NEAR", "一")? */
export const namesLimit = (reply: string, limit: string) => {
  const n = limit.split(' ')[0].replace(/\.0+$/, ''), words = Object.entries(NUM).filter(([, v]) => String(v) === n).map(([k]) => k);
  return new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(reply) || words.some((w) => (/^[a-z]/.test(w) ? new RegExp(`\\b${w}\\b`, 'i').test(reply) : reply.includes(w)));
};

/** Run by the agent on what the caller just said, before the model answers: a send over the wallet's limit is refused
 *  here, on that turn, whichever tool the model would have picked (it used to look the account up first and ask "shall
 *  I go ahead?"). Only refusals come from here; a send within the limits takes the normal road through prepare_transfer.
 *  Returns the tool call to record and its result, the limit to name, and a sentence to add if the model leaves it out. */
export async function limitCheck(call: Call, text: string): Promise<{ args: object; out: { ok: false; reason: string }; limit: string; say: string } | null> {
  const m = text.match(SEND_AMOUNT);
  if (!m || (!m[1] && !m[3])) return null; // a number with no coin named is not an amount
  const amount = /^\d/.test(m[2]) ? m[2] : String(NUM[m[2].toLowerCase()]);
  if (!AMOUNT.test(amount)) return null;
  const asset: Asset = m[1] || !/^near$/i.test(m[3] ?? '') ? `ft:${env.usdcToken}` : 'near';
  const base = asset === 'near' ? toYocto(amount) : parseUnits(amount, USDC_DECIMALS);
  const args = { amount, asset: asset === 'near' ? 'near' : 'usdc' };
  const done = (reason: string, limit: string, extra: object = {}) => {
    log({ kind: 'refused', desk: 'wallet', callId: call.id, detail: `limit check on the caller's words: ${reason}` });
    return { args, out: { ok: false as const, reason, ...extra }, limit, say: `That is over the ${limit} per-transfer limit, so nothing was sent.` };
  };
  const b = webDemo(call) ? bindingOf(env.demoPhone) : bindingOf(call.from);
  if (!b) {
    // No wallet: a browser call walks the contract's default limit; an unbound WhatsApp number is told to get a wallet.
    if (call.channel !== 'web' || asset !== 'near' || Number(amount) <= DEMO_LIMIT.per_tx) return null;
    return done(browserOver(), `${DEMO_LIMIT.per_tx} ${DEMO_LIMIT.unit}`, { demo: true });
  }
  const state = live() && !b.dryRun ? await walletState(b).catch(() => null) : null;
  const l = state?.limits[asset]?.per_tx;
  const limit = l != null ? fmt(asset, l) : asset === 'near' ? `${env.walletDefaults.nearPerTx} NEAR` : `${env.walletDefaults.usdcPerTx} USDC`;
  const why = overWhy(asset, base, state, isDemoWallet(b));
  if (!/per-transfer limit/.test(why)) return null; // the daily limit and the rest are prepare_transfer's to say
  const to = parseRecipient(text.match(/\bto\s+([a-z0-9_-]+(?:(?:\.|\s+dot\s+)[a-z0-9_-]+)+)/i)?.[1] ?? '', asset) ?? undefined;
  const s = overStop(call, { to, amount, asset, base }, why, isDemoWallet(b));
  return done(s.reason, limit, s.extra);
}

async function run(call: Call, name: string, a: any): Promise<unknown> {
  // A money packet is a NEAR transfer to the packets contract plus what to record there: it takes the same road as any
  // send (limits, PIN, the Approve tap above the small limit), so nothing about a packet can get past the wallet's rules.
  let packet: Transfer['packet'];
  if (name === 'prepare_packet') {
    const count = Number(a.count), words = String(a.words ?? '').trim(), amt = String(a.amount ?? '').trim();
    const no = (reason: string) => { log({ kind: 'refused', desk: 'wallet', callId: call.id, detail: `prepare_packet: ${reason}` }); return { ok: false, reason }; };
    if (!Number.isInteger(count) || count < 1 || count > 100) return no('How many people is it for? 1 to 100.');
    if (norm(words).length < 2 || words.length > 60) return no('What should people say to open it? A short phrase, like "merry christmas", "trick or treat" or "happy new year".');
    if (!AMOUNT.test(amt) || toYocto(amt) < BigInt(count) * MIN_SHARE) return no('How much in total? At least 0.001 NEAR per person.');
    // The words are the caller's own, as speech-to-text wrote them: that is the form an opener's words will be compared with.
    if (!call.turns.some((t) => t.who === 'caller' && norm(t.text).includes(norm(words)))) return no('They have not said which words open it. Ask them; if they want a suggestion, offer "merry christmas" and have them say it.');
    packet = { count, lucky: !/equal|even|same/i.test(String(a.split ?? '')), words };
    a = { to: packetsTo(), amount: amt, asset: 'near' };
    name = 'prepare_transfer';
  }
  const demo = webDemo(call);
  const b = demo ? bindingOf(env.demoPhone) : bindingOf(call.from);
  const refuse = (reason: string, extra: object = {}) => { log({ kind: 'refused', desk: 'wallet', callId: call.id, detail: `${name}: ${reason}` }); return { ok: false, reason, ...extra }; };
  // EVM sends are off unless EVM_ENABLED: anything but NEAR (a chain name, "ETH", an unknown coin) gets the same polite no.
  if (name === 'prepare_transfer' && !env.evmEnabled && !['near', `ft:${env.usdcToken}`].includes(parseAsset(a.asset) ?? '')) return refuse(ONLY_NEAR);
  if (!b && call.channel === 'web') return browserDemo(call, name, a, packet);
  if (!b) {
    links.set(call.id, { url: `${env.publicUrl}/wallet/bind`, label: 'No wallet yet. Reply "create a wallet" for a demo custodial wallet, or bind your own NEAR wallet' });
    return refuse('This number has no wallet yet. Two ways in: text "create a wallet" to this number for a demo custodial wallet, or bind your own NEAR wallet: the link is on WhatsApp.', { linkSent: true });
  }
  const shared = isDemoWallet(b);
  // The shared demo wallet's PIN is public: a visitor's packet is small, short-lived and one of a few.
  if (packet && shared) {
    const stop = await demoPacketStop(b, toYocto(a.amount));
    if (stop) return refuse(stop);
    packet.expirySec = env.demoVisitorPacketExpirySec;
  }
  const state = live() && !b.dryRun ? await walletState(b).catch((e) => e as Error) : null;
  if (state instanceof Error) return refuse(state.message.includes('bound') || state.message.includes('agent') ? state.message : 'Your wallet contract is not set up yet. Finish the binding page and sign it.');
  const tag = b.custodial ? ' (demo custodial wallet)' : '';

  if (name === 'cancel_transfer') {
    const stopped = await cancelHeld(b.phone);
    return stopped.length ? { ok: true, cancelled: stopped, next: 'Tell them it was stopped and nothing left the wallet.' } : { ok: false, reason: 'Nothing is waiting to go out.' };
  }
  if (name === 'get_spending') return spending(b, state);
  if (name === 'prepare_transfer' || name === 'confirm_transfer') {
    const lockedTill = demo ? demoLocked.get(call.id) ?? 0 : 0;
    if (lockedTill > Date.now()) return refuse('You tapped Not me, so this session is locked for 15 minutes. On a real wallet the whole wallet locks; on this shared demo only your session does, so others can still try it.');
    const stop = frozen(b, state);
    if (stop) return refuse(stop);
  }

  if (name === 'get_balance') {
    if (!state) return { ok: true, dryRun: true, note: 'DRY RUN: no agent key on this server, so no chain read. Say so.' };
    const evm = env.evmEnabled ? await ethAddressOf(b).catch(() => null) : null;
    const usdc = await ftBalance(env.usdcToken, b.contract).catch(() => null);
    return { ok: true, balance: fmt('near', state.balance), usdcBalance: usdc != null ? fmt(`ft:${env.usdcToken}`, usdc) : null, evmAddress: evm, evmNote: evm ? `Your EVM address is ${evm}, the same on every EVM chain. Fund gas on whichever chain you want to use.` : null,
      enabledChains: !env.evmEnabled ? [] : (state.chains ?? []).map((id) => chainById(id)?.name ?? `chain ${id}`), limits: Object.fromEntries(Object.entries(state.limits).filter(([k]) => env.evmEnabled || k === 'near' || k.startsWith('ft:')).map(([k, l]) => [k, `${fmt(k as Asset, l.per_tx)} per transfer, ${fmt(k as Asset, l.per_day)} per day`])) };
  }
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (!asset) return refuse(`Which chain? I can send NEAR, or the native coin on ${chainList()}.`);
    const chain = chainOf(asset);
    const to = parseRecipient(a.to, asset);
    if (!to) return refuse(asset === 'near' || isFt(asset) ? `I need a NEAR ${env.network} account, like liho dot ${suffix()}.` : `I need a 0x address for ${chain!.name}: text it to me.`);
    const amount = String(a.amount ?? '').trim();
    if (!AMOUNT.test(amount) || Number(amount) <= 0) return refuse('How much? Say a number, with at most 18 decimals.');
    if (isFt(asset) && !/^\d+(\.\d{1,6})?$/.test(amount)) return refuse('USDC has at most 6 decimals: say the amount in dollars and cents.');
    const t: Transfer = { to, amount, asset, base: asset === 'near' ? toYocto(amount) : parseUnits(amount, isFt(asset) ? USDC_DECIMALS : chain!.decimals), packet };
    // The contract would refuse these anyway; here we say so early (and hand over a self-sign link where one helps).
    if (state && chain && !(state.chains ?? []).includes(chain.id)) return refuse(`${chain.name} is not enabled on your wallet. You can allow it on your wallet contract with allow_chain, with its own limits.`);
    // ponytail: no contract state (dry run, RPC down): overWhy falls back to the configured per-send limit; the contract still has the final say.
    const over = overWhy(asset, t.base, state, shared);
    if (over) { const s = overStop(call, t, over, shared); return refuse(s.reason, s.extra); }
    if (state) {
      // The shared demo wallet is small: say so before the PIN, not as a failed transaction after it.
      if (shared && asset === 'near' && t.base > BigInt(state.balance)) return refuse(demoLow(state.balance));
      const isNew = !state.allowlist.includes(to);
      if (!isNew && chain) {
        // No signature request without gas: say how much is missing and where to send it.
        const from = await ethAddressOf(b);
        const short = await prepareTransfer(chain, from, to, t.base).then(() => null, (e) => (e instanceof GasShortError ? e.message : null));
        if (short) return refuse(short, { evmAddress: from });
      }
      // A phone-only wallet has no owner who could sign a first payment themselves: the contract holds it instead.
      // Not on the shared website demo wallet (it only ever pays its saved recipient).
      if (isNew && !demo && !packet && !chain && b.custodial && custodyLive()) t.wait = state.new_recipient_delay_sec;
      if (packet && isNew) return refuse(`This wallet was set up before money packets. Its owner saves ${to} as a recipient once, then you can send packets by voice.`);
      if (isNew && t.wait == null) {
        if (shared) return refuse(`I can't send that: this shared demo wallet only pays accounts its owner saved (${env.demoRecipient}) and money packets, and ${to} is not one of them. Nothing was sent.`);
        if (isFt(asset)) return refuse(`I can't send that: ${to} is not on your saved list. The wallet's owner can save the recipient.`);
        if (asset !== 'near') return refuse(`I can't: that address is not on your saved list. Save the address on your wallet page.`);
        links.set(call.id, { url: selfSign(t), label: `Sign ${readBack(t)} in your own wallet` });
        return refuse(`I can't send that myself: ${to} is a new recipient. A link to sign it in your own wallet is ${linkPlace(call)}.`, { linkSent: true });
      }
    }
    // Every send needs the spoken PIN; larger NEAR sends also need the Approve tap on WhatsApp after it.
    t.tier = (asset === 'near' && t.base > toYocto(env.smallLimitNear)) || (isFt(asset) && t.base > parseUnits(env.smallLimitUsdc, USDC_DECIMALS)) ? 'approve' : 'pin';
    t.until = Date.now() + PENDING_MS;
    pending.set(call.id, t);
    spokenPins.delete(call.id);
    const say = packet ? `${readBack(t)}. The words to open it are "${packet.words}"${packet.expirySec ? `. On this shared demo wallet it expires after ${minutes(packet.expirySec)}, then what is left goes back` : ''}` : readBack(t);
    const held = t.wait != null ? ` This is their first payment to that account: say it will go out ${minutes(t.wait)} after the PIN, and that saying "cancel" stops it.` : '';
    return { ok: true, read_back: say + tag, first_payment_wait: t.wait != null ? minutes(t.wait) : undefined, next: (t.tier === 'pin' ? 'Ask for their 4-digit PIN.' : `Ask for their 4-digit PIN; after it, an Approve button goes to ${demo ? 'their screen' : 'their WhatsApp'}.`) + held };
  }
  if (name === 'confirm_transfer') {
    const t = pending.get(call.id);
    if (!t) return refuse('Nothing to confirm: prepare a transfer first.');
    if (Date.now() > t.until!) { pending.delete(call.id); return refuse('That transfer expired (2 minutes). Say it again.'); }
    const v = checkPin(b, spokenPin(call, a));
    if (!v.ok) return refuse(v.reason);
    pending.delete(call.id);
    if (t.tier === 'approve') {
      const l = state?.limits.near;
      const left = l ? fmt(t.asset, BigInt(l.per_day) - BigInt(state!.spent_today[t.asset] ?? 0) - t.base) : 'unknown (dry run)';
      const sent = await askApproval(b, call.id, t, left);
      if (sent === false) return { ok: false, approvalSent: false, read_back: readBack(t) + tag, reason: 'WhatsApp could not deliver the Approve button to this number (on the test number Meta only allows approved recipients). Tell them to sign it in their own wallet at ringfence dot evalengine dot ai slash wallet slash send, or send 0.2 NEAR or less by PIN.' };
      return { ok: true, approvalSent: true, whatsapp: sent, read_back: readBack(t) + tag, next: `PIN accepted. Tell them: an Approve card is on ${demo ? 'their screen (on a real wallet it would be WhatsApp)' : 'their WhatsApp'}, valid for two minutes.` };
    }
    const r = await execute(call.id, b, t);
    return r.ok ? r : refuse(r.reason);
  }
  return { error: 'unknown tool' };
}

/** The PIN taken by takePin, else what the model passed (a typed chat). The caller's turn is blanked either way. */
function spokenPin(call: Call, a: any) {
  const pin = spokenPins.get(call.id) ?? String(a.pin ?? '');
  spokenPins.delete(call.id);
  const turn = [...call.turns].reverse().find((x) => x.who === 'caller');
  if (turn && normalizePin(turn.text)) turn.text = '[PIN]';
  return pin;
}

/** Server-side stops before any spend: a Reject freeze, an on-chain freeze, or a custodial wallet over its balance cap. */
export function frozen(b: Binding, s: WalletState | null, now = Date.now()): string | null {
  if (b.frozenUntil && now < b.frozenUntil) return `Spending is paused for ${Math.ceil((b.frozenUntil - now) / 60_000)} more minutes because someone tapped Not me on WhatsApp.`;
  if (s && BigInt(s.frozen_until_ns ?? 0) > BigInt(now) * 1_000_000n) return 'The owner has frozen this wallet, so I can\'t send anything right now.';
  if (b.custodial && s && BigInt(s.balance) > toYocto(env.custodialMaxNear))
    return `This demo custodial wallet holds more than ${env.custodialMaxNear} NEAR, over its cap, so spends are stopped. Claim it to your own wallet at ${env.publicUrl}/wallet/claim.`;
  return null;
}

async function execute(callId: string, b: Binding, t: Transfer): Promise<{ ok: true; [k: string]: unknown } | { ok: false; reason: string }> {
  if (!live() || b.dryRun) {
    log({ kind: 'wallet', desk: 'wallet', callId, detail: `DRY RUN (${b.dryRun ? 'no CUSTODY_PRIVATE_KEY' : 'no AGENT_PRIVATE_KEY'}): would send ${readBack(t)} from ${b.contract}${b.custodial ? ' (custodial)' : ''}` });
    if (t.packet) return packetOf(callId, b, t, true);
    return { ok: true, dryRun: true, txHash: `dry-run-${callId}`, note: 'DRY RUN: this server has no agent key, so nothing was sent. Say clearly it was a dry run.' };
  }
  const r = await (t.asset === 'near' ? sendNear(b, t.to, t.base) : isFt(t.asset) ? sendFt(b, t.asset.slice(3), t.to, t.base) : sendEvm(b, chainOf(t.asset)!.id, t.to, t.base)).catch((e) => e as Error);
  if (r instanceof GasShortError) return { ok: false, reason: r.message };
  if (r instanceof Error && isDemoWallet(b) && /balance|not enough|insufficient|lack/i.test(r.message)) return { ok: false, reason: demoLow() };
  if (r instanceof Error) return { ok: false, reason: `The wallet contract refused: ${r.message.slice(0, 160)}` };
  log({ kind: 'wallet', desk: 'wallet', callId, detail: `${readBack(t)} from ${b.contract}: ${r.url}${r.queuedId != null ? ` (queued #${r.queuedId})` : ''}` });
  if (t.packet) return packetOf(callId, b, t, false, r.url);
  if (r.queuedId != null && t.wait != null) {
    hold({ id: r.queuedId, phone: b.phone, contract: b.contract, to: t.to, what: readBack(t), readyAt: Date.now() + t.wait * 1000 + 3000, callId });
    links.set(callId, { url: r.url, label: 'Held by your wallet contract, on chain' });
    return { ok: true, waiting: true, goes_out_in: minutes(t.wait), url: r.url, linkSent: true,
      next: `Tell them: it is a first payment to this account, so the contract holds it for ${minutes(t.wait)} and then it goes; saying "cancel" stops it; a message arrives when it is sent.` };
  }
  links.set(callId, { url: r.url, label: r.queuedId != null ? 'Queued transfer' : 'Your transaction' });
  return { ok: true, txHash: r.txHash, url: r.url, linkSent: true, queued: r.queuedId != null };
}

/** The money is in the packets contract (or this is a dry run): record the packet and hand over its link. */
async function packetOf(callId: string, b: Pick<Binding, 'contract' | 'phone'> | null, t: Transfer, dry: boolean, fundUrl?: string): Promise<{ ok: true; [k: string]: unknown } | { ok: false; reason: string }> {
  const from = b?.contract ?? 'a browser demo';
  // The sender hears about each opened share on WhatsApp (not the shared website demo wallet: it has no real phone).
  const fromPhone = b && b.phone !== env.demoPhone ? b.phone : undefined;
  const p = await createPacket({ from, fromPhone, fundUrl, yocto: t.base, ...t.packet!, dry, callId }).catch((e) => e as Error);
  if (p instanceof Error) {
    log({ kind: 'refused', desk: 'wallet', callId, detail: `money packet not recorded after the transfer (${t.amount} NEAR from ${from}): ${p.message.slice(0, 160)}` });
    return { ok: false, reason: 'The money reached the money packet contract but the packet was not recorded. Nothing is lost: it is logged for the team to finish or send back.' };
  }
  links.set(callId, { url: packetUrl(p.id), label: `Your money packet. Share this link; they open it by saying the words${fundUrl ? `. Funded on chain: ${fundUrl}` : ''}` });
  return { ok: true, packet: true, link: packetUrl(p.id), funded_on_chain: fundUrl, dryRun: p.dryRun || undefined, linkSent: true,
    next: `The money packet is ready. Tell them to share the link and the words with the people it is for.${p.dryRun ? ' Say clearly it is a dry run: no real money is in it.' : ''}` };
}

/** "How much did I spend?": today's spend vs the daily limit from the contract, last 5 transfers from the ledger. */
function spending(b: Binding, s: WalletState | null) {
  // Sends only (not "approved on WhatsApp" duplicates); dry runs are marked as such.
  const last = db.ledger.filter((l) => l.kind === 'wallet' && l.detail.includes(` from ${b.contract}`)).slice(-5).reverse()
    .map((l) => `${new Date(l.at).toISOString().slice(0, 16).replace('T', ' ')} ${l.detail.split(` from ${b.contract}`)[0].replace(/^DRY RUN \([^)]*\): would send (.*)$/, '$1 (dry run, not sent)')}`);
  if (!s) return { ok: true, dryRun: true, last, note: 'DRY RUN: no chain read, so today\'s total is not known. Say so, then list the recent transfers.' };
  const l = s.limits.near;
  return { ok: true, spentToday: fmt('near', s.spent_today.near ?? '0'), dailyLimit: fmt('near', l.per_day), leftToday: fmt('near', BigInt(l.per_day) - BigInt(s.spent_today.near ?? 0)), last };
}

// ---- WhatsApp Approve / Reject (larger sends) ----

type Approval = { phone: string; callId: string; t: Transfer; until: number; contract: string };
const approvals = new Map<string, Approval>();
const APPROVAL_MS = 120_000;
let buttons: ((to: string, body: string, token: string) => Promise<unknown>) | undefined;
/** Set by src/whatsapp.ts when WhatsApp is configured: sends the interactive [Approve] [Cancel] [Not me] message. */
export const setApprovalSender = (f: typeof buttons) => (buttons = f);
/** Whoever is on the call (browser socket, WhatsApp voice) hears what happened after the tap. */
const news = new Map<string, (s: string) => void>();
export const onCallNews = (callId: string, f: ((s: string) => void) | null) => (f ? news.set(callId, f) : news.delete(callId));

/** The website demo wallet has no real phone: its Approve card goes to the browser that is on the call. */
/** Calls whose visitor tapped Not me on the demo wallet: only that browser session is locked, not the shared wallet. */
const demoLocked = new Map<string, number>();
const webCards = new Map<string, (body: string, token: string) => void>();
export const onWebApproval = (callId: string, f: ((body: string, token: string) => void) | null) => (f ? webCards.set(callId, f) : webCards.delete(callId));

async function askApproval(b: Binding, callId: string, t: Transfer, left: string) {
  const token = randomBytes(16).toString('hex');
  approvals.set(token, { phone: b.phone, callId, t, until: Date.now() + APPROVAL_MS, contract: b.contract });
  const body = `Approve this transfer?\n${t.amount} ${isFt(t.asset) ? 'USDC' : 'NEAR'} to ${t.to}\nFrom ${b.contract}${b.custodial ? ' (demo custodial)' : ''}\nDaily limit left after it: ${left}\nExpires in 2 minutes. Changed your mind? Cancel. Didn't ask for this? Tap Not me: the AI is locked out for 15 minutes.`;
  const card = env.demoPhone && b.phone === env.demoPhone ? webCards.get(callId) : undefined;
  if (card) { card(body, token); return true; }
  if (!buttons) {
    // Only a dry-run server may print tokens: on a real one, log access would be spend access.
    if (devServer()) console.log(`[wallet] no WhatsApp token: approval for ${b.phone}: approve:${token} / cancel:${token} / reject:${token}`);
    return 'dry' as const;
  }
  try { await buttons(b.phone, body, token); return true; } catch (e) {
    console.error('approval buttons', (e as Error).message.slice(0, 160));
    approvals.delete(token);
    return false;
  }
}

/** A button tap (interactive.button_reply id "approve:<token>" / "reject:<token>"). Single use, 120 s, only from the bound phone. */
export async function onButton(from: string, id: string, now = Date.now()): Promise<string> {
  const [verb, token] = String(id).split(':');
  const a = approvals.get(token ?? '');
  if (!a || digits(from) !== a.phone) return 'That approval is not valid any more.';
  approvals.delete(token);
  const b = bindingOf(a.phone);
  if (!b) return 'This number has no wallet any more.';
  const call = db.calls.find((c) => c.id === a.callId);
  const say = (s: string) => { call?.turns.push({ at: Date.now(), who: 'agent', text: s }); news.get(a.callId)?.(s); return s; };
  // Cancel: changed their mind (wrong amount, not now). Nothing sent, nothing frozen.
  if (verb === 'cancel') return say('Cancelled. Nothing was sent.');
  // Not me (id "reject") is the "I didn't ask for this" alarm: it freezes even after the approval expired.
  if (verb === 'reject' && env.demoPhone && a.phone === env.demoPhone) {
    demoLocked.set(a.callId, now + 15 * 60_000);
    log({ kind: 'refused', desk: 'wallet', callId: a.callId, detail: 'Not me on the website demo wallet: this session locked for 15 minutes' });
    return say('You tapped Not me, so nothing was sent and this session is locked for 15 minutes. On a real wallet, the AI would be locked out of the whole wallet.');
  }
  if (verb === 'reject') {
    await rejectFreeze(b, now);
    await cancelHeld(b.phone).catch(() => []); // anything waiting to go out is stopped too
    say('You tapped Not me on WhatsApp, so nothing was sent. The AI is locked out of your wallet for 15 minutes.');
    return 'Locked. Nothing was sent, and the AI cannot spend from this wallet for 15 minutes. If someone is pressuring you to pay, hang up and call family.';
  }
  if (verb !== 'approve') return 'Unknown button.';
  if (now > a.until) return 'That approval expired (2 minutes). Ask again on the call.';
  // Same checks as at the PIN: the chain's freeze, the custodial cap, owner and agent, and the same contract.
  const state = live() && !b.dryRun ? await walletState(b).catch((e) => e as Error) : null;
  if (state instanceof Error) return say(`It didn't go through: ${state.message}`);
  if (b.contract !== a.contract) return say('It didn\'t go through: this number was bound to another wallet since.');
  const stop = frozen(b, state, now);
  if (stop) return say(stop);
  const r = await execute(a.callId, b, a.t);
  if (!r.ok) return say(`It didn't go through: ${r.reason}`);
  log({ kind: 'wallet', desk: 'wallet', callId: a.callId, detail: `approved on WhatsApp: ${readBack(a.t)}` });
  if (r.packet) return say(`Approved. Your money packet is ready${r.dryRun ? ' (a dry run: no real money is in it)' : ''}: ${r.link}`);
  if (r.dryRun) return say(`Approved. This was a dry run: no agent key on this server, so nothing was sent.`);
  return say(`Approved and sent: ${readBack(a.t)}. ${r.url}`);
}

// A browser call has no phone number, so no wallet is bound to it. It walks the same steps (read back, spoken PIN,
// the contract's mainnet default limits) and always stops at a labelled dry run: nothing is read from or sent to a chain.
const DEMO_LIMIT = { per_tx: 1, unit: 'NEAR' };
const browserOver = () => `That is over the ${DEMO_LIMIT.per_tx} ${DEMO_LIMIT.unit} per-transfer default, so the contract would refuse it. Try 0.5 NEAR.`;
async function browserDemo(call: Call, name: string, a: any, packet?: Transfer['packet']): Promise<unknown> {
  const note = 'BROWSER DEMO: a browser call has no phone number, so no wallet is bound and nothing is sent. Say so plainly.';
  if (name === 'get_balance' || name === 'get_spending') return { ok: true, dryRun: true, demo: true, note };
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (asset !== 'near') return { ok: false, reason: 'The browser demo walks a NEAR transfer. Try "send 0.5 NEAR to liho.near".' };
    const to = String(a.to ?? '').trim().toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
    if (!/^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|testnet)$/.test(to)) return { ok: false, reason: 'I need a NEAR account, like liho dot near.' };
    const amount = String(a.amount ?? '').trim();
    if (!AMOUNT.test(amount) || Number(amount) <= 0) return { ok: false, reason: 'How much? Say a number.' };
    if (Number(amount) > DEMO_LIMIT.per_tx) return { ok: false, demo: true, reason: browserOver() };
    const t: Transfer = { to, amount, asset, base: toYocto(amount), packet };
    if (Number(amount) > Number(env.smallLimitNear)) return { ok: true, demo: true, approvalDemo: true, read_back: readBack(t), note: `${note} Above ${env.smallLimitNear} NEAR, a bound wallet also needs an Approve tap on WhatsApp after the PIN.` };
    pending.set(call.id, t);
    return { ok: true, read_back: packet ? `${readBack(t)}. The words to open it are "${packet.words}"` : readBack(t), next: 'Ask for their 4-digit PIN.', note };
  }
  if (name === 'confirm_transfer') {
    const t = pending.get(call.id);
    if (!t) return { ok: false, reason: 'Nothing to confirm: prepare a transfer first.' };
    const pin = normalizePin(spokenPin(call, a));
    if (!pin) return { ok: false, reason: 'Say four digits.' };
    pending.delete(call.id);
    log({ kind: 'wallet', desk: 'wallet', callId: call.id, detail: `BROWSER DEMO: would ask the contract to send ${readBack(t)}` });
    if (t.packet) return packetOf(call.id, null, t, true);
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
