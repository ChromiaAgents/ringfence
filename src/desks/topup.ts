// Top up from any chain through NEAR Intents 1Click: the caller pays a token on any chain and USDC lands in their
// phone wallet on NEAR. Dry quotes unless TOPUP_LIVE=1; the shared demo wallet only ever gets dry quotes.
// The caller sends the funds themselves to the 1Click deposit address: this server never holds them.
import type { DeskDef } from './types.ts';
import type { Call } from '../store.ts';
import { env } from '../config.ts';
import { bindingOf } from '../wallet.ts';
import { quoteTopup, topupLive } from '../fund.ts';

const TOOL = { type: 'function', function: { name: 'topup_quote', description: 'Quote a top up of the caller\'s phone wallet: they pay a token on another chain (SOL, ETH, BTC and more) and USDC arrives in their wallet on NEAR through NEAR Intents.', parameters: { type: 'object', properties: {
  usd: { type: 'number', description: 'Dollars to top up' }, token: { type: 'string', description: 'What they pay with, for example SOL, ETH, BTC' },
  refund_address: { type: 'string', description: 'Their own address on the sending chain, for a refund if the swap fails. Only needed for a live top up.' },
}, required: ['usd', 'token'] } } };

/** The wallet a top up lands in, and whether it is the shared demo wallet. */
function target(call: Call) {
  const demo = call.channel === 'web' && !call.from && !!env.demoPhone;
  const b = demo ? bindingOf(env.demoPhone) : bindingOf(call.from);
  return b ? { account: b.contract, demo } : null;
}

export async function runTopup(call: Call, args: any) {
  const t = target(call);
  if (!t) return { ok: false, reason: 'This call has no wallet to top up yet.' };
  const live = topupLive() && !t.demo;
  const q = await quoteTopup({ usd: Number(args?.usd), origin: String(args?.token ?? ''), recipient: t.account, refundTo: args?.refund_address, live });
  if (!q.ok) return q;
  const mins = Math.max(1, Math.round((Date.parse(q.deadline) - Date.now()) / 60_000));
  const to = q.depositAddress ? `to ${q.depositAddress}${q.depositMemo ? ` with memo ${q.depositMemo}` : ''}` : 'dry run, no address';
  return { ...q, say: `Send ${q.send} ${q.symbol} on ${q.chain}, ${to}. About ${q.receive} USDC lands in your wallet. ${q.dry ? 'A live top up needs a refund address of yours on that chain.' : `Refunds go to ${q.refund}.`} The quote holds for ${mins} minutes.` };
}

export const topupDesk: DeskDef = {
  id: 'wallet', // a wallet action; the Desk type has no separate id for it
  greeting: () => '',
  system: () => 'To top up their wallet from another chain ("top up 10 dollars of SOL"), call topup_quote and say its say field, briefly. Without a deposit address it is a dry run: say so, and that nothing moved.',
  tools: [TOOL],
  run: (call, _name, args) => runTopup(call, args),
};
