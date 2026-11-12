// Owner-only, run on the server (it holds CUSTODY_PRIVATE_KEY, the factory owner's key):
//   npx tsx --env-file=.env scripts/forget-number.ts <64-hex phone_hash>
// The factory forgets which wallet that number uses, so its owner can create a new (named) one. The old wallet account
// keeps its owner and funds.
import { env } from '../src/config.ts';
import { callContract, custody } from '../src/wallet.ts';

const h = String(process.argv[2] ?? '');
if (!/^[0-9a-f]{64}$/.test(h)) { console.error('usage: forget-number.ts <64-hex phone_hash>'); process.exit(1); }
const r = await callContract(env.factoryAccountId, 'forget_number', { phone_hash: h }, 1n, custody());
console.log('forgotten', JSON.stringify(r).slice(0, 200));
