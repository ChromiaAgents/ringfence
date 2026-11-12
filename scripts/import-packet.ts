// Lets a money packet that someone else funded on chain be opened by a call.
// The packets contract's `create` takes attached NEAR from any account (a wallet, a Sputnik DAO proposal), but the
// server only opens packets it has in its own store. This reads the packet from the contract with a view call, checks
// the words against the hash stored on chain, and adds the packet to the store. No keys, no transaction.
//
//   npm run import:packet -- <packet id> "<words>"            add it to the store (DB_FILE, default data/db.json)
//   npm run import:packet -- <packet id> "<words>" --check    read and check only, write nothing
//   npm run import:packet -- <packet id> "<words>" --hash     print the phrase_hash for `create` (no network)
//   --hint "<text>"   shown on the packet page as what to say: only for a packet whose words are meant to be public
//
// Run it where the server's store is, with the server stopped: a running server keeps the store in memory and
// would write over the new packet. Full steps for a DAO: docs/dao-packet.md
import { createHash } from 'node:crypto';
import { env } from '../src/config.ts';
import { view, yoctoToNear } from '../src/near.ts';
import { importPacket, norm, packetUrl, type ChainPacket } from '../src/packets.ts';

const argv = process.argv.slice(2);
const flag = (f: string) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const check = flag('--check'), hashOnly = flag('--hash');
const hi = argv.indexOf('--hint');
const hint = hi >= 0 ? argv.splice(hi, 2)[1] : undefined;
const id = String(argv[0] ?? '').trim().toLowerCase(), words = String(argv[1] ?? '');
const stop = (msg: string): never => { console.error(`REFUSED: ${msg}`); process.exit(1); };

if (!id || !norm(words) || argv.length !== 2) stop('usage: npm run import:packet -- <packet id> "<words>" [--check | --hash] [--hint "<text>"]');
if (!/^[a-z0-9-]{1,64}$/.test(id)) stop('a packet id is 1 to 64 of a-z, 0-9 and -');
const hash = createHash('sha256').update(`${id}:${norm(words)}`).digest('hex');
if (hashOnly) {
  console.log(`id              ${id}\nwords as hashed ${norm(words)}\nphrase_hash     ${hash}`);
  process.exit(0);
}

const contract = env.packetsAccountId || stop('PACKETS_ACCOUNT_ID is not set (on mainnet: packets.ringfence-wallet.near)');
console.log(`packets contract  ${contract} (${env.network})`);
const chain = await view<ChainPacket | null>('get_packet', { id }, env.network, contract);
if (chain) {
  const left = chain.count - chain.claimed;
  console.log(`packet            ${id}\nfunded by         ${chain.creator}\nholds             ${yoctoToNear(chain.remaining)} of ${yoctoToNear(chain.total)} NEAR, ${left} of ${chain.count} shares left, ${chain.lucky ? 'lucky' : 'equal'} split`
    + `\nexpires           ${new Date(Number(BigInt(chain.expires_ns) / 1_000_000n)).toISOString()}${chain.refunded ? '  (refunded)' : ''}\nhash on chain     ${chain.phrase_hash}\nhash of the words ${hash}`);
}
const r = importPacket(id, words, chain, { hint, dry: check });
if (!r.ok) stop(r.reason);

// A share can only be paid if the server's agent is the contract's agent and the contract is not paused.
const [, agent] = await view<[string, string]>('get_config', {}, env.network, contract);
if (env.agentAccountId && env.agentAccountId !== agent) console.log(`WARNING: the contract's agent is ${agent}, this server's is ${env.agentAccountId}: it cannot open a share.`);
if (await view<boolean>('is_paused', {}, env.network, contract)) console.log('WARNING: the packets contract is paused by its owner: no share can be opened until it is unpaused.');

console.log(check
  ? 'OK: the words match and the packet is open. Nothing was written (--check).'
  : `OK: added to ${process.env.DB_FILE ?? 'data/db.json'}. Start the server, then open a share at ${packetUrl(id)}`);
