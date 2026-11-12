// npm run topup:quote -- <amount usd> <origin symbol or assetId> [recipient]
// Prints a dry 1Click quote for USDC on NEAR. No keys, nothing moves.
import { quoteTopup, usdcRegistered } from '../src/fund.ts';

const [usd, origin, recipient = 'f18d3a55399e.ringfence-wallet.near'] = process.argv.slice(2);
if (!usd || !origin) { console.log('usage: npm run topup:quote -- <amount usd> <origin symbol or assetId> [recipient]'); process.exit(1); }
const registered = await usdcRegistered(recipient);
console.log(`recipient ${recipient}: ${registered ? 'registered with USDC' : 'NOT registered with USDC (a real top up would fail; quoting anyway because this is dry)'}`);
const q = await quoteTopup({ usd: Number(usd), origin, recipient, skipStorageCheck: true });
console.log(JSON.stringify(q, null, 2));
if (!q.ok) process.exit(1);
