// NEAR RPC helpers shared by the launch desk and the phone wallet: read-only views, units, explorer links.
// This server never holds a launch key and never signs a launch.
import { env } from './config.ts';

export const NET = {
  mainnet: { rpc: 'https://rpc.mainnet.near.org', explorer: (h: string) => `https://nearblocks.io/txns/${h}` },
  testnet: { rpc: 'https://rpc.testnet.near.org', explorer: (h: string) => `https://testnet.nearblocks.io/txns/${h}` },
} as const;
export const net = (n = env.network) => NET[n];

export async function rpc(method: string, params: unknown, network = env.network): Promise<any> {
  const r = await fetch(net(network).rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const d: any = await r.json();
  if (d.error) throw new Error(`rpc ${method}: ${JSON.stringify(d.error).slice(0, 300)}`);
  return d.result;
}

export async function view<T = any>(method: string, args: object, network: 'mainnet' | 'testnet', account: string): Promise<T> {
  const res = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }, network);
  if (res.error) throw new Error(`${method}: ${res.error}`);
  return JSON.parse(Buffer.from(res.result).toString());
}

// ---- units ----
const YOCTO = 10n ** 24n;
export const nearToYocto = (near: number) => (BigInt(Math.round(near * 1e6)) * YOCTO) / 1_000_000n;
export const yoctoToNear = (y: string | bigint) => Number((BigInt(y) * 1_000_000n) / YOCTO) / 1e6;

/** The coin as the launch desk agreed it. */
export type LaunchParams = {
  name: string; symbol: string; description: string; icon: string; // icon = small data URL
  socials?: { twitter?: string; telegram?: string; website?: string };
};
