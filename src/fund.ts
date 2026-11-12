// Launch funding through NEAR Intents 1Click (mainnet only): the creator pays any supported token on any chain
// and exactly the launch cost lands in their own NEAR account as wNEAR. Nobody in the middle holds the funds.
import { env } from './config.ts';

const API = 'https://1click.chaindefuser.com/v0';

export type Token = { assetId: string; blockchain: string; symbol: string; decimals: number; price: number };
let tokens: { at: number; list: Token[] } | null = null;

export async function listTokens(): Promise<Token[]> {
  if (tokens && Date.now() - tokens.at < 5 * 60_000) return tokens.list;
  const r = await fetch(`${API}/tokens`, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`tokens ${r.status}`);
  tokens = { at: Date.now(), list: (await r.json()) as Token[] };
  return tokens.list;
}

function headers() {
  return { 'content-type': 'application/json', ...(env.oneClickJwt ? { authorization: `Bearer ${env.oneClickJwt}` } : {}) };
}

export type Quote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  deadline?: string;
  originAsset: string;
  dry: boolean;
};

/** Exactly `yocto` of wNEAR lands in the creator's own NEAR account. */
export const WNEAR_ASSET = 'nep141:wrap.near';
export function quoteFunding(opts: { yocto: string; recipient: string; originAsset: string; refundTo: string; dry: boolean }) {
  return quoteExact({ amount: opts.yocto, destinationAsset: WNEAR_ASSET, recipient: opts.recipient, originAsset: opts.originAsset, refundTo: opts.refundTo, dry: opts.dry });
}

async function quoteExact(opts: { amount: string; destinationAsset: string; recipient: string; originAsset: string; refundTo: string; dry: boolean }): Promise<Quote> {
  const { amount } = opts;
  const body = {
    dry: opts.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: opts.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: opts.destinationAsset,
    amount,
    recipient: opts.recipient,
    recipientType: 'DESTINATION_CHAIN',
    refundTo: opts.refundTo,
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const r = await fetch(`${API}/quote`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.message ?? `quote ${r.status}`);
  const q = d.quote ?? d;
  return {
    depositAddress: q.depositAddress,
    depositMemo: q.depositMemo,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountOutFormatted: q.amountOutFormatted,
    deadline: q.deadline,
    originAsset: opts.originAsset,
    dry: opts.dry,
  };
}

// ---- Top up from any chain: the caller pays a token on any chain, USDC lands in their phone wallet on NEAR. ----
// Dry quotes by default (nothing moves, no deposit address). A real deposit address only with TOPUP_LIVE=1, and even
// then the caller sends the funds themselves straight to 1Click; this server never holds them.
import { view } from './near.ts';

/** Native USDC on NEAR (checked in the 1Click /tokens list). */
export const USDC_NEAR = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const USDC_ASSET = `nep141:${USDC_NEAR}`;
export const topupLive = () => process.env.TOPUP_LIVE === '1';

/** "SOL", "eth", "btc" or a full assetId. A symbol prefers the coin on its own chain (SOL on Solana), native before tokens. */
export function pickToken(list: Token[], what: string): Token | null {
  const w = String(what ?? '').trim();
  if (w.includes(':')) return list.find((t) => t.assetId === w) ?? null;
  const hits = list.filter((t) => t.symbol.toUpperCase() === w.toUpperCase());
  const home: Record<string, string> = { SOL: 'sol', ETH: 'eth', BTC: 'btc', NEAR: 'near', USDC: 'eth', USDT: 'eth' };
  const rank = (t: Token & { contractAddress?: string }) => (t.blockchain === home[w.toUpperCase()] ? 0 : 2) + (t.contractAddress ? 1 : 0) + (t.blockchain === 'near' ? 4 : 0);
  return hits.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** USDC storage registration of an account on NEAR mainnet. A transfer to an unregistered account fails. */
export async function usdcRegistered(account: string): Promise<boolean> {
  return (await view<unknown>('storage_balance_of', { account_id: account }, 'mainnet', USDC_NEAR)) != null;
}

export type TopupQuote = { ok: true; dry: boolean; send: string; symbol: string; chain: string; receive: string; recipient: string; depositAddress?: string; depositMemo?: string; deadline: string; refund: string; minutes?: number }
  | { ok: false; reason: string };

/** A quote for about `usd` dollars of `origin` arriving as USDC in `recipient` on NEAR. */
export async function quoteTopup(opts: { usd: number; origin: string; recipient: string; refundTo?: string; live?: boolean; skipStorageCheck?: boolean }): Promise<TopupQuote> {
  const usd = Number(opts.usd);
  if (!(usd >= 1 && usd <= 10_000)) return { ok: false, reason: 'Pick an amount between 1 and 10,000 dollars.' };
  const tok = pickToken(await listTokens(), opts.origin);
  if (!tok) return { ok: false, reason: `NEAR Intents does not list ${opts.origin}.` };
  if (tok.assetId === USDC_ASSET) return { ok: false, reason: 'That is already USDC on NEAR: send it straight to the wallet.' };
  if (!opts.skipStorageCheck && !(await usdcRegistered(opts.recipient)))
    return { ok: false, reason: `The wallet ${opts.recipient} is not registered with the USDC contract yet, so USDC sent to it would fail. The owner registers it once (about 0.00125 NEAR). No quote made.` };
  const live = !!opts.live;
  if (live && !opts.refundTo) return { ok: false, reason: `A live top up needs a refund address on ${tok.blockchain}, in case the swap cannot complete.` };
  const amount = BigInt(Math.round((usd / tok.price) * 10 ** Math.min(tok.decimals, 12))) * 10n ** BigInt(Math.max(0, tok.decimals - 12));
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  const body = {
    dry: !live, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tok.assetId, depositType: 'ORIGIN_CHAIN',
    destinationAsset: USDC_ASSET, amount: amount.toString(), recipient: opts.recipient, recipientType: 'DESTINATION_CHAIN',
    // A dry quote needs no origin-chain address: the refund side is the recipient inside NEAR Intents. Live uses the caller's own address.
    refundTo: live ? opts.refundTo : opts.recipient, refundType: live ? 'ORIGIN_CHAIN' : 'INTENTS', deadline,
  };
  const r = await fetch(`${API}/quote`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, reason: `1Click: ${d.message ?? r.status}` };
  const q = d.quote ?? d;
  return {
    ok: true, dry: !live, send: q.amountInFormatted, symbol: tok.symbol, chain: tok.blockchain, receive: q.amountOutFormatted, recipient: opts.recipient,
    ...(q.depositAddress ? { depositAddress: q.depositAddress, depositMemo: q.depositMemo } : {}),
    deadline: q.deadline ?? deadline, refund: live ? String(opts.refundTo) : 'needed for a live top up: an address of yours on the sending chain', minutes: q.timeEstimate ? Math.ceil(q.timeEstimate / 60) : undefined,
  };
}
