// Launch funding through NEAR Intents 1Click (mainnet only): the creator pays any supported token on any chain
// and exactly the launch cost lands in their own NEAR account as wNEAR. Nobody in the middle holds the funds.
import { env } from './config.ts';

const API = 'https://1click.chaindefuser.com/v0';

export type Token = { assetId: string; blockchain: string; symbol: string; decimals: number; price: number };
let tokens: { at: number; list: Token[] } | null = null;

export async function listTokens(): Promise<Token[]> {
  if (tokens && Date.now() - tokens.at < 5 * 60_000) return tokens.list;
  const r = await fetch(`${API}/tokens`);
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
