import { quoteDeposit, listTokens } from '../src/pay.ts';
process.env.OWNER_NEAR_ACCOUNT ??= 'aurora';
const t = await listTokens();
const pick = (chain: string, sym: string) => t.find((x) => x.blockchain === chain && x.symbol === sym)!;
for (const [chain, sym, refund] of [['base', 'USDC', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'], ['sol', 'SOL', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'], ['near', 'wNEAR', 'aurora']] as const) {
  const a = pick(chain, sym);
  const q = await quoteDeposit({ usd: 50, originAsset: a.assetId, refundTo: refund, dry: true }).catch((e) => ({ err: e.message }));
  console.log(chain, sym, q);
}
