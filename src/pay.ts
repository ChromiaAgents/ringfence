// Deposits through NEAR Intents 1Click: the customer pays any supported token on any chain,
// the owner receives exactly the deposit in USDC. Nobody in the middle holds the funds.
import { env, owner } from './config.ts';

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

// usd -> exact USDC out to the owner; the customer's token amount is what 1Click asks for.
export async function quoteDeposit(opts: { usd: number; originAsset: string; refundTo: string; dry: boolean }): Promise<Quote> {
  const o = owner();
  if (!o.payout.recipient) throw new Error('OWNER_NEAR_ACCOUNT is not set');
  const amount = BigInt(Math.round(opts.usd * 10 ** o.payout.asset_decimals)).toString();
  const body = {
    dry: opts.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: opts.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: o.payout.asset,
    amount,
    recipient: o.payout.recipient,
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

export async function depositStatus(depositAddress: string, memo?: string): Promise<{ status: string; raw: any }> {
  const u = new URL(`${API}/status`);
  u.searchParams.set('depositAddress', depositAddress);
  if (memo) u.searchParams.set('depositMemo', memo);
  const r = await fetch(u, { headers: headers() });
  const d: any = await r.json();
  return { status: d.status ?? `HTTP_${r.status}`, raw: d };
}
