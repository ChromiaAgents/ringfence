// meme.cooking on NEAR: read-only RPC views, the exact create_meme transaction the caller signs, and
// the after-the-fact check of a signed transaction. This server never holds a key and never signs.
import { createHash } from 'node:crypto';
import { env } from './config.ts';

export const NET = {
  mainnet: {
    contract: 'meme-cooking.near', wnear: 'wrap.near', rpc: 'https://rpc.mainnet.near.org',
    memeUrl: (id: number) => `https://meme.cooking/meme/${id}`, explorer: (h: string) => `https://nearblocks.io/txns/${h}`,
  },
  // The testnet contract listed in meme.cooking's developer docs; it whitelists wrap.testnet.
  // (meme-cooking-test.testnet also has code, but it only whitelists wrap.near, which cannot exist on testnet.)
  testnet: {
    contract: 'factory.v10.meme-cooking.testnet', wnear: 'wrap.testnet', rpc: 'https://rpc.testnet.near.org',
    memeUrl: (id: number) => `https://testnet.meme.cooking/meme/${id}`, explorer: (h: string) => `https://testnet.nearblocks.io/txns/${h}`,
  },
} as const;
export const net = (n = env.network) => NET[n];

export async function rpc(method: string, params: unknown, network = env.network): Promise<any> {
  const r = await fetch(net(network).rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const d: any = await r.json();
  if (d.error) throw new Error(`rpc ${method}: ${JSON.stringify(d.error).slice(0, 300)}`);
  return d.result;
}

export async function view<T = any>(method: string, args: object = {}, network = env.network, account: string = net(network).contract): Promise<T> {
  const res = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }, network);
  if (res.error) throw new Error(`${method}: ${res.error}`);
  return JSON.parse(Buffer.from(res.result).toString());
}

// ---- units ----
const YOCTO = 10n ** 24n;
export const nearToYocto = (near: number) => (BigInt(Math.round(near * 1e6)) * YOCTO) / 1_000_000n;
export const yoctoToNear = (y: string | bigint) => Number((BigInt(y) * 1_000_000n) / YOCTO) / 1e6;

// ---- the launch, as the desk agreed it ----
export type LaunchParams = {
  name: string; symbol: string; description: string; icon: string; // icon = small data URL
  durationMinutes: number; softCapNear: number; hardCapNear?: number;
  team?: { pct: number; cliffDays: number; vestingDays: number };
  socials?: { twitter?: string; telegram?: string; website?: string };
  totalSupply: string; decimals: number; // whole tokens, decimals
};

/** The reference JSON meme.cooking's own app pins to IPFS, and its base64 sha256. */
export function referenceJson(p: LaunchParams) {
  const json = JSON.stringify({ description: p.description, twitterLink: p.socials?.twitter ?? '', telegramLink: p.socials?.telegram ?? '', website: p.socials?.website ?? '', image: '' });
  return { json, hash: createHash('sha256').update(json).digest('base64') };
}

/** Pins the reference JSON with Pinata when PINATA_JWT is set; otherwise the launch goes out with an empty reference. */
export async function pinReference(p: LaunchParams): Promise<{ reference: string; reference_hash: string }> {
  if (!env.pinataJwt) return { reference: '', reference_hash: '' };
  const { json, hash } = referenceJson(p);
  const fd = new FormData();
  fd.set('file', new Blob([json], { type: 'application/json' }), 'reference.json');
  const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: `Bearer ${env.pinataJwt}` }, body: fd });
  const d: any = await r.json();
  if (!r.ok || !d.IpfsHash) throw new Error(`pinata ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  return { reference: d.IpfsHash, reference_hash: hash };
}

/** create_meme's arguments, in the shape the contract's ABI declares. */
export function createMemeArgs(p: LaunchParams, ref: { reference: string; reference_hash: string }, network = env.network) {
  return {
    duration_ms: String(Math.round(p.durationMinutes * 60_000)),
    name: p.name,
    symbol: p.symbol,
    icon: p.icon,
    decimals: p.decimals,
    total_supply: (BigInt(p.totalSupply) * 10n ** BigInt(p.decimals)).toString(),
    reference: ref.reference,
    reference_hash: ref.reference_hash,
    deposit_token_id: net(network).wnear,
    soft_cap: nearToYocto(p.softCapNear).toString(),
    hard_cap: p.hardCapNear ? nearToYocto(p.hardCapNear).toString() : null,
    team_allocation: p.team && p.team.pct > 0
      ? ([Math.round(p.team.pct * 100), Math.round(p.team.vestingDays * 86_400_000), Math.round(p.team.cliffDays * 86_400_000)] as [number, number, number])
      : null,
  };
}
export type CreateMemeArgs = ReturnType<typeof createMemeArgs>;

/** The NEAR cost of a launch for this signer, from the contract's own views. */
export async function launchCost(args: CreateMemeArgs, signer: string, network = env.network) {
  const { team_allocation: _t, ...costArgs } = args; // the storage-cost view takes the same fields minus team_allocation
  const [storage, costs, balance] = await Promise.all([
    view<string>('create_meme_storage_cost', { sender_id: signer, ...costArgs }, network),
    view<{ account: string; perMemeDeposit: string }>('storage_costs', {}, network),
    view<unknown>('storage_balance_of', { account_id: signer }, network),
  ]);
  const register = balance == null ? costs.account : '0';
  return { createDeposit: storage, registerDeposit: register, totalYocto: (BigInt(storage) + BigInt(register)).toString() };
}

export type TxSpec = { receiverId: string; actions: { methodName: string; args: object; gas: string; deposit: string }[] };

/** The one transaction the caller signs: [storage_deposit if unregistered] + create_meme. */
export function buildTx(args: CreateMemeArgs, cost: Awaited<ReturnType<typeof launchCost>>, network = env.network): TxSpec {
  const actions: TxSpec['actions'] = [];
  if (BigInt(cost.registerDeposit) > 0n) actions.push({ methodName: 'storage_deposit', args: {}, gas: '20000000000000', deposit: cost.registerDeposit });
  actions.push({ methodName: 'create_meme', args, gas: '250000000000000', deposit: cost.createDeposit });
  return { receiverId: net(network).contract, actions };
}

/** Reads a signed transaction back from chain and returns the new meme id if create_meme succeeded. */
export async function confirmTx(hash: string, signer: string, network = env.network): Promise<{ ok: boolean; memeId?: number; reason?: string }> {
  const t = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' }, network);
  if (t.transaction?.receiver_id !== net(network).contract) return { ok: false, reason: 'transaction was not sent to the meme.cooking contract' };
  if (!t.transaction.actions?.some((a: any) => a.FunctionCall?.method_name === 'create_meme')) return { ok: false, reason: 'no create_meme call in this transaction' };
  if (t.status?.Failure) return { ok: false, reason: JSON.stringify(t.status.Failure).slice(0, 200) };
  for (const ro of t.receipts_outcome ?? [])
    for (const l of ro.outcome.logs ?? []) {
      if (!l.startsWith('EVENT_JSON:')) continue;
      try {
        const e = JSON.parse(l.slice(11));
        if (e.event === 'create_meme') return { ok: true, memeId: Number(e.data?.[0]?.meme_id ?? e.data?.meme_id) };
      } catch {}
    }
  const v = t.status?.SuccessValue;
  if (v) return { ok: true, memeId: Number(JSON.parse(Buffer.from(v, 'base64').toString())) };
  return { ok: false, reason: 'no meme id in the result' };
}

// ---- existing tickers (meme.cooking's public indexer, mainnet) ----
let known: { at: number; list: { id: number; symbol: string; name: string }[] } | null = null;
export async function existingMemes() {
  if (known && Date.now() - known.at < 5 * 60_000) return known.list;
  const r = await fetch('https://api.meme.cooking/meme', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`meme.cooking indexer ${r.status}`);
  const d: any[] = await r.json();
  known = { at: Date.now(), list: d.map((m) => ({ id: m.meme_id, symbol: String(m.symbol), name: String(m.name) })) };
  return known.list;
}
