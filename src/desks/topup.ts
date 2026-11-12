import { callProof } from '../wallet.ts';
import { webDemo } from './wallet.ts';
// Top up from any chain through NEAR Intents 1Click: the caller pays a token on any chain and USDC lands in their
// phone wallet on NEAR. Dry quotes unless TOPUP_LIVE=1 and the caller gives a refund address. On the shared demo
// wallet the agent first says plainly that the funds top up the shared demo wallet, not theirs.
// The caller sends the funds themselves to the 1Click deposit address: this server never holds them.
import type { DeskDef } from './types.ts';
import type { Call } from '../store.ts';
import { env } from '../config.ts';
import { bindingOf } from '../wallet.ts';
import { quoteTopup, topupLive, usdcRegistered } from '../fund.ts';
import { callContract } from '../wallet.ts';
import { setWalletLink } from './wallet.ts';
import { newTopup } from '../topupPage.ts';

const TOOL = { type: 'function', function: { name: 'topup_quote', description: 'Quote a top up of the caller\'s phone wallet: they pay a token on another chain (SOL, ETH, BTC and more) and USDC arrives in their wallet on NEAR through NEAR Intents.', parameters: { type: 'object', properties: {
  usd: { type: 'number', description: 'Dollars to top up' }, token: { type: 'string', description: 'What they pay with, for example SOL, ETH, BTC' },
  confirmed: { type: 'boolean', description: 'true only after the caller said yes to the exact dollar amount you read back. Needed for 100 dollars or more.' },
  chain: { type: 'string', description: 'The chain they pay from if they named one: solana, ethereum, tron, base, arbitrum, bnb, polygon, ton...' },
  use_demo: { type: 'boolean', description: 'true only if a caller with no wallet chose to top up the shared demo wallet instead of binding their own.' },
  refund_address: { type: 'string', description: 'Their own address on the sending chain, for a refund if the swap fails. Only needed for a live top up.' },
}, required: ['usd', 'token'] } } };

/** The wallet a top up lands in, and whether it is the shared demo wallet. */
function target(call: Call, useDemo = false) {
  const demo = webDemo(call) || (useDemo && !!env.demoPhone);
  const b = demo ? bindingOf(env.demoPhone) : bindingOf(call.from);
  return b ? { account: b.contract, demo } : null;
}

/** Did the caller say an amount on this call? A model can invent "10 dollars"; the caller's own words decide. */
const NUM = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|half|quarter|tenth|couple)\b/i;
export const saidAmount = (call: Call) => call.turns.some((x) => x.who === 'caller' && NUM.test(x.text));

/** "USDT" plus the chain they named ("solana"): the chain decides which token and which refund address fits. */
const origin = (a: any) => { const t = String(a?.token ?? '').trim(); const c = String(a?.chain ?? '').trim(); return c && !/\son\s/i.test(t) ? `${t} on ${c}` : t; };

export async function runTopup(call: Call, args: any) {
  // Code checks, not left to the model: no spoken amount means ask; a big amount is read back and confirmed first.
  const tok = String(args?.token ?? '').trim() || 'SOL';
  if (!saidAmount(call)) return { ok: false, ask: true, reason: 'They did not say an amount. Ask how many dollars they want to top up (buttons are on their screen). Do not pick one.', choices: [2, 5, 10].map((n) => `Top up ${n} dollars of ${tok}.`) };
  const usd = Number(args?.usd);
  if (usd >= 100 && args?.confirmed !== true) {
    // "two fifty" often comes back as 250: offer the small reading too.
    const small = Number.isInteger(usd) && usd < 1000 ? usd / 100 : null;
    return { ok: false, ask: true, reason: `Read the amount back before quoting: "${usd} dollars, is that right?" (buttons are on their screen). Call topup_quote again with confirmed true only after they say yes.`,
      choices: [`Yes, ${usd} dollars.`, ...(small ? [`No, I meant ${small.toFixed(2)} dollars.`] : []), 'Cancel.'] };
  }
  // A WhatsApp number with no wallet of its own: bind first (same link-or-live-code path as a launch), unless they
  // choose the shared demo wallet.
  if (call.channel === 'whatsapp' && call.from && !bindingOf(call.from) && args?.use_demo !== true) {
    setWalletLink(call.id, { url: `${env.publicUrl}/wallet/bind${call.from ? `?phone=${call.from}&proof=${callProof(call.from)}` : ''}`, label: 'Bind your own NEAR wallet to this number, then top up' });
    return { ok: false, linkSent: true, reason: 'This number has no wallet yet. The bind page is on its way (or the code you read). Tell them to bind their NEAR wallet there, then ask again. Or, if they just want to try it, offer the shared demo wallet (call again with use_demo true).' };
  }
  const t = target(call, args?.use_demo === true);
  if (!t) return { ok: false, reason: 'This call has no wallet to top up yet.' };
  // USDC lands only in a wallet registered on the USDC contract. Anyone may pay that storage for another account, so
  // the agent pays it once (0.00125 NEAR) instead of sending the caller off to do a contract call.
  let justRegistered = false;
  if (!(await usdcRegistered(t.account).catch(() => true))) {
    try { await callContract(env.usdcToken, 'storage_deposit', { account_id: t.account, registration_only: true }, 1_250_000_000_000_000_000_000n); justRegistered = true; console.log('[topup] registered a wallet on USDC'); }
    catch (e: any) { console.error('usdc register', String(e?.message ?? e).slice(0, 160)); return { ok: false, reason: 'Could not register the wallet for USDC just now. Try again in a minute.' }; }
  }
  const refund = String(args?.refund_address ?? '').trim() || undefined;
  const live = topupLive() && !!refund;
  const q = await quoteTopup({ usd: Number(args?.usd), origin: origin(args), recipient: t.account, refundTo: refund, live, skipStorageCheck: justRegistered }); // a fresh registration is not visible at final finality yet
  if (!q.ok) return q;
  const mins = Math.max(1, Math.round((Date.parse(q.deadline) - Date.now()) / 60_000));
  const whose = t.demo ? 'the shared demo wallet (not yours: anything sent is a gift to the demo)' : 'your wallet';
  if (q.depositAddress) {
    // A 64-character address is useless spoken: it goes on the caller's screen (or WhatsApp), with the 1Click status link.
    setWalletLink(call.id, { url: `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(q.depositAddress)}`, label: `Send exactly ${q.send} ${q.symbol} on ${q.chain} to ${q.depositAddress}${q.depositMemo ? ` memo ${q.depositMemo}` : ''} (tap to check the swap)` });
    return { ...q, linkSent: true, say: `Live quote: send exactly ${q.send} ${q.symbol} on ${q.chain} to the address on your screen, and about ${q.receive} USDC lands in ${whose}. Refunds go to ${q.refund}. It holds for ${mins} minutes. Only send from your own wallet.` };
  }
  if (topupLive()) {
    // A refund address can't be said on a call: the caller pastes it on the top-up page, which shows the deposit address.
    const id = newTopup({ usd: Number(args?.usd), token: `${q.symbol} on ${q.chain}`, recipient: t.account, demo: t.demo });
    setWalletLink(call.id, { url: `${env.publicUrl}/topup/${id}`, label: `Top up ${Number(args?.usd)} dollars of ${q.symbol}: paste your refund address, get the deposit address` });
    return { ...q, dry: undefined, linkSent: true, say: `About ${q.send} ${q.symbol} on ${q.chain} gets you about ${q.receive} USDC in ${whose}. The top-up page is on its way: paste a refund address of yours there and it shows where to send.` };
  }
  return { ...q, say: `Send ${q.send} ${q.symbol} on ${q.chain} and about ${q.receive} USDC lands in ${whose}. This is a dry run, nothing moved. Live top ups are off on this server. The quote holds for ${mins} minutes.` };
}

export const topupDesk: DeskDef = {
  id: 'wallet', // a wallet action; the Desk type has no separate id for it
  greeting: () => '',
  system: () => 'To top up their wallet from another chain ("top up 10 dollars of SOL"), call topup_quote and say its say field, briefly. Without a deposit address it is a dry run: say so, and that nothing moved. When the result has linkSent, the top-up page (link or live panel code) is where they paste a refund address and see the deposit address: never ask them to say an address aloud, never read one aloud. On the shared demo wallet say plainly the funds go to the demo wallet, not theirs. If topup_quote refuses (a minimum amount, an unlisted token), always tell them the exact reason, for example the minimum, and offer a fix: a bigger amount or another chain.',
  tools: [TOOL],
  run: (call, _name, args) => runTopup(call, args),
};
