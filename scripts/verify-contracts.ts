// Checks that the code running on NEAR mainnet is the code in contracts/release/.
// The on-chain code hash is the base58 sha256 of the wasm, so we hash each release file and compare.
// Usage: npm run verify:contracts   (network only, no keys)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const RPC = 'https://rpc.mainnet.near.org';
const rpc = async (params: object) => {
  const r: any = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { finality: 'final', ...params } }) })).json();
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
};
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (b: Buffer) => { let n = BigInt('0x' + b.toString('hex')), s = ''; while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; } return s; };
const hashOf = (f: string) => b58(createHash('sha256').update(readFileSync(new URL(`../contracts/release/${f}`, import.meta.url))).digest());

const factory = await rpc({ request_type: 'call_function', account_id: 'ringfence-wallet.near', method_name: 'get_config', args_base64: 'e30=' });
const walletCode = JSON.parse(Buffer.from(factory.result).toString())[2];
const checks: [string, string, string][] = [
  ['factory  ringfence-wallet.near', 'wallet_factory.wasm', (await rpc({ request_type: 'view_account', account_id: 'ringfence-wallet.near' })).code_hash],
  ['packets  packets.ringfence-wallet.near', 'red_packets.wasm', (await rpc({ request_type: 'view_account', account_id: 'packets.ringfence-wallet.near' })).code_hash],
  ['wallet   global code the factory uses', 'phone_wallet.wasm', walletCode],
];
let ok = true;
for (const [what, file, onChain] of checks) {
  const mine = hashOf(file), same = mine === onChain;
  ok &&= same;
  console.log(`${same ? 'ok  ' : 'DIFF'} ${what}\n     chain ${onChain}\n     file  ${mine}  (contracts/release/${file})`);
}
process.exit(ok ? 0 : 1);
