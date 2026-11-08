// JustHoot (https://justhoot.fun) on NEAR mainnet: an instant launch. One launch_meme call creates the token and its
// RHEA DCL pool (1% fee tier) together, tradable straight away. There is no testnet deployment.
// Read-only views, the transaction the caller signs, and the after-the-fact check. This server never signs.
import sharp from 'sharp';
import { rpc, view } from './memecook.ts';

export const JUSTHOOT = {
  contract: 'v2-launchpad.justhoot.near',
  site: 'https://justhoot.fun',
  explorer: (h: string) => `https://nearblocks.io/txns/${h}`,
  tokenUrl: (id: string) => `https://nearblocks.io/token/${id}`,
} as const;

/** launch_meme's `args`, shaped like JustHoot's own builder. No transfer tax, no dev buy, all supply to the creator. */
export function justhootArgs(p: { name: string; symbol: string; icon: string }) {
  return {
    name: p.name,
    symbol: p.symbol,
    icon: p.icon || null,
    reference: null,
    reference_hash: null,
    quote_token_id: 'wrap.near',
    dev_buy_quote_max: null,
    transfer_fee_pips: 0,
    shares: { token_owner_bps: 10000, burn_bps: 0, holders_bps: 0 },
  };
}
export type JustHootArgs = ReturnType<typeof justhootArgs>;

/** JustHoot's app shrinks icons to 128 px and refuses data URLs over this many characters. */
export const ICON_MAX_CHARS = 7000;
export async function smallIcon(dataUrl: string): Promise<string> {
  if (dataUrl.length <= ICON_MAX_CHARS) return dataUrl;
  const img = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
  for (const q of [60, 45, 30, 20]) {
    const out = `data:image/webp;base64,${(await sharp(img).resize(128, 128, { fit: 'cover' }).webp({ quality: q }).toBuffer()).toString('base64')}`;
    if (out.length <= ICON_MAX_CHARS) return out;
  }
  throw new Error('icon too detailed for JustHoot');
}

type View = <T = any>(method: string, args?: object) => Promise<T>;
const mainnetView: View = (method, args = {}) => view(method, args, 'mainnet', JUSTHOOT.contract);

/** Deposit, gas and registration for this signer, from the contract's own views. `v` is injectable for tests. */
export async function justhootCost(args: JustHootArgs, signer: string, v: View = mainnetView) {
  const [deposit, tgas, balance, bounds, tokenId] = await Promise.all([
    v<string>('get_launch_deposit', { args, account_id: signer }),
    v<string>('get_launch_gas', { args }),
    v<unknown>('storage_balance_of', { account_id: signer }),
    v<{ min: string }>('storage_balance_bounds'),
    v<string>('get_next_token_id', { symbol: args.symbol }).catch(() => null),
  ]);
  const registerDeposit = balance == null ? bounds.min : '0';
  return { launchDeposit: deposit, gas: (BigInt(tgas) * 10n ** 12n).toString(), registerDeposit, totalYocto: (BigInt(deposit) + BigInt(registerDeposit)).toString(), tokenId };
}
export type JustHootCost = Awaited<ReturnType<typeof justhootCost>>;

/** One transaction to the launchpad: [storage_deposit if unregistered] + launch_meme (their app batches the same way). */
export function buildJustHootTx(args: JustHootArgs, cost: JustHootCost) {
  const actions: { methodName: string; args: object; gas: string; deposit: string }[] = [];
  if (BigInt(cost.registerDeposit) > 0n) actions.push({ methodName: 'storage_deposit', args: { registration_only: true }, gas: '10000000000000', deposit: cost.registerDeposit });
  actions.push({ methodName: 'launch_meme', args: { args }, gas: cost.gas, deposit: cost.launchDeposit });
  return { receiverId: JUSTHOOT.contract, actions };
}

/** Reads a signed transaction back from mainnet. The token id comes from the event logs if one names it (untested
 *  against a real launch); otherwise the page links the transaction and justhoot.fun. */
export async function confirmJustHoot(hash: string, signer: string): Promise<{ ok: boolean; tokenId?: string; reason?: string }> {
  const t = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' }, 'mainnet');
  if (t.transaction?.receiver_id !== JUSTHOOT.contract) return { ok: false, reason: 'transaction was not sent to the JustHoot launchpad' };
  if (!t.transaction.actions?.some((a: any) => a.FunctionCall?.method_name === 'launch_meme')) return { ok: false, reason: 'no launch_meme call in this transaction' };
  if (t.status?.Failure) return { ok: false, reason: JSON.stringify(t.status.Failure).slice(0, 200) };
  const logs: string[] = (t.receipts_outcome ?? []).flatMap((ro: any) => ro.outcome.logs ?? []);
  if (logs.some((l) => /launch_(failed|rejected)/.test(l))) return { ok: false, reason: 'the launchpad logged a failed launch; any deposit is refunded by the contract' };
  const re = new RegExp(`[a-z0-9-]+\\.${JUSTHOOT.contract.replace(/\./g, '\\.')}`);
  const tokenId = logs.filter((l) => l.includes('meme_launched')).map((l) => l.match(re)?.[0]).find(Boolean);
  return { ok: true, tokenId };
}
