// The wallet desk: "send 5 NEAR to bob.testnet", read back, confirmed with a spoken 4-digit PIN, then the agent
// calls the caller's phone-wallet contract, which enforces the limits. Over a limit or to a new recipient, the caller
// gets a link to sign in their own wallet instead. Testnet only.
import { parseEther, formatEther } from 'ethers';
import { env } from '../config.ts';
import { log, type Call } from '../store.ts';
import { nearToYocto, yoctoToNear } from '../memecook.ts';
import { bindingOf, checkPin, live, sendEth, sendNear, walletState, ethAddressOf } from '../wallet.ts';
import type { DeskDef } from './types.ts';

export type Asset = 'near' | 'eth:sepolia';
type Transfer = { to: string; amount: string; asset: Asset; base: bigint };
const pending = new Map<string, Transfer>();
const links = new Map<string, { url: string; label: string }>();

/** Spoken recipients: "bob dot testnet" → bob.testnet; "0x12AB…" kept as an address. */
export function parseRecipient(raw: string, asset: Asset): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
  if (asset === 'eth:sepolia') return /^0x[0-9a-f]{40}$/.test(s) ? s : null;
  return /^([a-z0-9_-]+\.)*[a-z0-9_-]+\.testnet$|^[0-9a-f]{64}$/.test(s) ? s : null;
}
export const parseAsset = (a: string): Asset | null => (/^(near)?$/i.test(String(a ?? '').trim()) ? 'near' : /eth|sepolia/i.test(a) ? 'eth:sepolia' : null);
/** "5 NEAR to bob dot testnet": what the agent reads back. */
export const readBack = (t: { to: string; amount: string; asset: Asset }) =>
  `${t.amount} ${t.asset === 'near' ? 'NEAR' : 'Sepolia ETH'} to ${t.to.startsWith('0x') ? `address ${t.to.slice(0, 6)} ending ${t.to.slice(-4)}` : t.to.replace(/\./g, ' dot ')}`;
const selfSign = (t: Transfer) => `${env.publicUrl}/wallet/send?to=${encodeURIComponent(t.to)}&amount=${t.amount}`;
const fmt = (asset: Asset, base: bigint | string) => (asset === 'near' ? `${yoctoToNear(base)} NEAR` : `${formatEther(BigInt(base))} ETH`);

const tools = [
  { type: 'function', function: { name: 'get_balance', description: "The caller's phone-wallet balance and today's limits.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'prepare_transfer', description: 'Get a transfer ready. Read back the returned read_back and ask for their 4-digit PIN.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'NEAR testnet account like bob.testnet, or a 0x address for Sepolia' }, amount: { type: 'string' }, asset: { type: 'string', enum: ['near', 'eth:sepolia'] } }, required: ['to', 'amount', 'asset'] } } },
  { type: 'function', function: { name: 'confirm_transfer', description: 'After the caller says their PIN. Pass exactly what they said.', parameters: { type: 'object', properties: { pin: { type: 'string' } }, required: ['pin'] } } },
];

const system = () => `You are callhand's wallet desk. The caller's WhatsApp number is bound to their own NEAR testnet wallet contract; you can send NEAR or Sepolia ETH from it, within limits the contract enforces.
For a transfer: call prepare_transfer, read back its read_back exactly ("5 NEAR to bob dot testnet") and ask for their 4-digit PIN. When they say it, call confirm_transfer with what they said. Never repeat the PIN aloud.
If a tool refuses, say why in plain words. If a link was sent, say it's on WhatsApp. Testnet only: no real money. Never give financial advice.`;

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const b = bindingOf(call.from);
  const refuse = (reason: string, extra: object = {}) => { log({ kind: 'refused', desk: 'wallet', callId: call.id, detail: `${name}: ${reason}` }); return { ok: false, reason, ...extra }; };
  if (!b) {
    links.set(call.id, { url: `${env.publicUrl}/wallet/bind`, label: 'Bind your NEAR wallet to this number' });
    return refuse('This number is not bound to a wallet yet. Bind it first: the link is on WhatsApp.', { linkSent: true });
  }
  const state = live() ? await walletState(b).catch((e) => e as Error) : null;
  if (state instanceof Error) return refuse(state.message.includes('bound') || state.message.includes('agent') ? state.message : 'Your wallet contract is not set up yet. Finish the binding page and sign it.');

  if (name === 'get_balance') {
    if (!state) return { ok: true, dryRun: true, note: 'DRY RUN: no agent key on this server, so no chain read. Say so.' };
    return { ok: true, balance: fmt('near', state.balance), ethAddress: await ethAddressOf(b).catch(() => null), limits: Object.fromEntries(Object.entries(state.limits).map(([k, l]) => [k, `${fmt(k as Asset, l.per_tx)} per transfer, ${fmt(k as Asset, l.per_day)} per day`])) };
  }
  if (name === 'prepare_transfer') {
    const asset = parseAsset(a.asset);
    if (!asset) return refuse('I can send NEAR or Sepolia ETH.');
    const to = parseRecipient(a.to, asset);
    if (!to) return refuse(asset === 'near' ? 'I need a NEAR testnet account, like bob dot testnet.' : 'I need a 0x address for Sepolia: text it to me.');
    const amount = String(a.amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return refuse('How much? Say a number.');
    const t: Transfer = { to, amount, asset, base: asset === 'near' ? nearToYocto(Number(amount)) : parseEther(amount) };
    // The contract would refuse these anyway; here we say so early and hand over a self-sign link.
    if (state) {
      const l = state.limits[asset], spent = BigInt(state.spent_today[asset] ?? 0);
      const over = !l ? 'no limit is set for that asset' : t.base > BigInt(l.per_tx) ? `that is over your ${fmt(asset, l.per_tx)} per-transfer limit` : spent + t.base > BigInt(l.per_day) ? `that would pass your ${fmt(asset, l.per_day)} daily limit` : '';
      const isNew = !state.allowlist.includes(to);
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
    const r = await (t.asset === 'near' ? sendNear(b, t.to, t.base) : sendEth(b, t.to, t.base)).catch((e) => e as Error);
    if (r instanceof Error) return refuse(`The wallet contract refused: ${r.message.slice(0, 160)}`);
    log({ kind: 'wallet', desk: 'wallet', callId: call.id, detail: `${readBack(t)} from ${b.contract}: ${r.url}${r.queuedId != null ? ` (queued #${r.queuedId})` : ''}` });
    links.set(call.id, { url: r.url, label: r.queuedId != null ? 'Queued transfer' : 'Your transaction' });
    return { ok: true, txHash: r.txHash, linkSent: true, queued: r.queuedId != null };
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
