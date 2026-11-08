// The wallet desk: "send 5 NEAR to bob.testnet", read back, confirmed with a spoken 4-digit PIN, then the agent
// calls the caller's phone-wallet contract, which enforces the limits. Over a limit or to a new recipient, the caller
// gets a link to sign in their own wallet instead. NETWORK picks testnet or mainnet. UNAUDITED: keep small amounts.
import { parseUnits, formatUnits } from 'ethers';
import { env } from '../config.ts';
import { log, type Call } from '../store.ts';
import { nearToYocto, yoctoToNear } from '../memecook.ts';
import { bindingOf, checkPin, normalizePin, live, sendEvm, sendNear, walletState, ethAddressOf } from '../wallet.ts';
import { CHAINS, chainById, findChain, defaultChainIds } from '../chains.ts';
import { GasShortError, prepareTransfer } from '../eth.ts';
import type { DeskDef } from './types.ts';

/** "near", or "evm:<chainId>" for an EVM chain's native coin. */
export type Asset = 'near' | `evm:${number}`;
type Transfer = { to: string; amount: string; asset: Asset; base: bigint };
const pending = new Map<string, Transfer>();
const links = new Map<string, { url: string; label: string }>();
const chainOf = (a: Asset) => (a === 'near' ? undefined : chainById(Number(a.slice(4))));
const suffix = () => (env.network === 'mainnet' ? 'near' : 'testnet');
const chainList = () => CHAINS.filter((c) => !!c.testnet === (env.network === 'testnet')).map((c) => c.name).join(', ');

/** Spoken recipients: "bob dot near" → bob.near; "0x12AB…" kept as an address. */
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
/** "5 NEAR to bob dot near" / "0.0001 ETH on Base to address 0x1111 ending 1111": what the agent reads back. */
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
  { type: 'function', function: { name: 'prepare_transfer', description: 'Get a transfer ready. Read back the returned read_back and ask for their 4-digit PIN.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'NEAR account like bob.near (bob.testnet on testnet), or a 0x address for an EVM chain' }, amount: { type: 'string' }, asset: { type: 'string', description: '"near", or the EVM chain name for its native coin: base, ethereum, arbitrum, optimism, polygon, bnb, avalanche (sepolia on testnet)' } }, required: ['to', 'amount', 'asset'] } } },
  { type: 'function', function: { name: 'confirm_transfer', description: 'After the caller says their PIN. Pass exactly what they said.', parameters: { type: 'object', properties: { pin: { type: 'string' } }, required: ['pin'] } } },
];

const system = () => `You are Ringfence's wallet desk. The caller's WhatsApp number is bound to their own NEAR ${env.network} wallet contract; you can send NEAR, or the native coin of an EVM chain the owner allowed (${chainList()}), within limits the contract enforces.
For a transfer: call prepare_transfer, read back its read_back exactly ("5 NEAR to bob dot ${suffix()}") and ask for their 4-digit PIN. When they say it, call confirm_transfer with what they said. Never repeat the PIN aloud. If they say just "ETH", ask which chain.
Their EVM address is the same on every EVM chain: they fund gas on whichever chain they want to use.
If a tool refuses, say why in plain words. If a link was sent, say it's on WhatsApp. ${env.network === 'mainnet' ? 'This is mainnet, real money, and an unaudited prototype: suggest small amounts.' : 'Testnet only: no real money.'} Never give financial advice.`;

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const b = bindingOf(call.from);
  const refuse = (reason: string, extra: object = {}) => { log({ kind: 'refused', desk: 'wallet', callId: call.id, detail: `${name}: ${reason}` }); return { ok: false, reason, ...extra }; };
  if (!b && call.channel === 'web') return browserDemo(call, name, a);
  if (!b) {
    links.set(call.id, { url: `${env.publicUrl}/wallet/bind`, label: 'Bind your NEAR wallet to this number' });
    return refuse('This number is not bound to a wallet yet. Bind it first: the link is on WhatsApp.', { linkSent: true });
  }
  const state = live() ? await walletState(b).catch((e) => e as Error) : null;
  if (state instanceof Error) return refuse(state.message.includes('bound') || state.message.includes('agent') ? state.message : 'Your wallet contract is not set up yet. Finish the binding page and sign it.');

  if (name === 'get_balance') {
    if (!state) return { ok: true, dryRun: true, note: 'DRY RUN: no agent key on this server, so no chain read. Say so.' };
    const evm = await ethAddressOf(b).catch(() => null);
    return { ok: true, balance: fmt('near', state.balance), evmAddress: evm, evmNote: evm ? `Your EVM address is ${evm}, the same on every EVM chain. Fund gas on whichever chain you want to use.` : null,
      enabledChains: (state.chains ?? []).map((id) => chainById(id)?.name ?? `chain ${id}`), limits: Object.fromEntries(Object.entries(state.limits).map(([k, l]) => [k, `${fmt(k as Asset, l.per_tx)} per transfer, ${fmt(k as Asset, l.per_day)} per day`])) };
  }
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (!asset) return refuse(`Which chain? I can send NEAR, or the native coin on ${chainList()}.`);
    const chain = chainOf(asset);
    const to = parseRecipient(a.to, asset);
    if (!to) return refuse(asset === 'near' ? `I need a NEAR ${env.network} account, like bob dot ${suffix()}.` : `I need a 0x address for ${chain!.name}: text it to me.`);
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
    pending.set(call.id, t);
    return { ok: true, read_back: readBack(t), next: 'Ask for their 4-digit PIN.' };
  }
  if (name === 'confirm_transfer') {
    const t = pending.get(call.id);
    if (!t) return refuse('Nothing to confirm: prepare a transfer first.');
    // The PIN is taken from what the caller said, and blanked from the stored transcript.
    const turn = [...call.turns].reverse().find((x) => x.who === 'caller');
    const v = checkPin(b, String(a.pin ?? turn?.text ?? ''));
    if (turn) turn.text = '[PIN]';
    if (!v.ok) return refuse(v.reason);
    pending.delete(call.id);
    if (!live()) {
      const fake = `dry-run-${call.id}`;
      log({ kind: 'wallet', desk: 'wallet', callId: call.id, detail: `DRY RUN (no AGENT_PRIVATE_KEY): would send ${readBack(t)} from ${b.contract}` });
      return { ok: true, dryRun: true, txHash: fake, note: 'DRY RUN: this server has no agent key, so nothing was sent. Say clearly it was a dry run.' };
    }
    const r = await (t.asset === 'near' ? sendNear(b, t.to, t.base) : sendEvm(b, chainOf(t.asset)!.id, t.to, t.base)).catch((e) => e as Error);
    if (r instanceof GasShortError) return refuse(r.message);
    if (r instanceof Error) return refuse(`The wallet contract refused: ${r.message.slice(0, 160)}`);
    log({ kind: 'wallet', desk: 'wallet', callId: call.id, detail: `${readBack(t)} from ${b.contract}: ${r.url}${r.queuedId != null ? ` (queued #${r.queuedId})` : ''}` });
    links.set(call.id, { url: r.url, label: r.queuedId != null ? 'Queued transfer' : 'Your transaction' });
    return { ok: true, txHash: r.txHash, linkSent: true, queued: r.queuedId != null };
  }
  return { error: 'unknown tool' };
}

// A browser call has no phone number, so no wallet is bound to it. It walks the same steps (read back, spoken PIN,
// the contract's mainnet default limits) and always stops at a labelled dry run: nothing is read from or sent to a chain.
const DEMO_LIMIT = { per_tx: 1, unit: 'NEAR' };
function browserDemo(call: Call, name: string, a: any): unknown {
  const note = 'BROWSER DEMO: a browser call has no phone number, so no wallet is bound and nothing is sent. Say so plainly.';
  if (name === 'get_balance') return { ok: true, dryRun: true, demo: true, note };
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (asset !== 'near') return { ok: false, reason: 'The browser demo walks a NEAR transfer. Try "send 0.5 NEAR to alice.near".' };
    const to = String(a.to ?? '').trim().toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
    if (!/^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|testnet)$/.test(to)) return { ok: false, reason: 'I need a NEAR account, like alice dot near.' };
    const amount = String(a.amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return { ok: false, reason: 'How much? Say a number.' };
    if (Number(amount) > DEMO_LIMIT.per_tx) return { ok: false, demo: true, reason: `That is over the ${DEMO_LIMIT.per_tx} ${DEMO_LIMIT.unit} per-transfer default, so the contract would refuse it. Try 0.5 NEAR.` };
    const t: Transfer = { to, amount, asset, base: nearToYocto(Number(amount)) };
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
