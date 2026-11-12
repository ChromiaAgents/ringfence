// npm run topup:quote -- <amount usd> <origin symbol or assetId> [recipient] [--live <refund address>]
// npm run topup:quote -- --status <deposit address>
// Prints a 1Click quote for USDC on NEAR. Dry by default: no keys, nothing moves.
// --live asks 1Click for a real deposit address. Nothing moves until YOU send funds to it from your own wallet;
// if the swap cannot complete, 1Click refunds to the refund address. The server never holds the funds.
import { quoteTopup, usdcRegistered } from '../src/fund.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v ?? ''; };

const status = flag('--status');
if (status !== undefined) {
  if (!status) { console.log('usage: npm run topup:quote -- --status <deposit address>'); process.exit(1); }
  const r = await fetch(`https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(status)}`, { signal: AbortSignal.timeout(10_000) });
  console.log(JSON.stringify(await r.json().catch(() => ({ status: r.status })), null, 2));
  process.exit(r.ok ? 0 : 1);
}

const refundTo = flag('--live');
const live = refundTo !== undefined;
const [usd, origin, recipient = 'f18d3a55399e.ringfence-wallet.near'] = argv;
if (!usd || !origin || (live && !refundTo)) { console.log('usage: npm run topup:quote -- <amount usd> <origin symbol or assetId> [recipient] [--live <refund address>]'); process.exit(1); }
const registered = await usdcRegistered(recipient);
console.log(`recipient ${recipient}: ${registered ? 'registered with USDC' : 'NOT registered with USDC (a real top up would fail)'}`);
if (live && !registered) { console.log('REFUSED: register the recipient on the USDC contract first.'); process.exit(1); }
const q: any = await quoteTopup({ usd: Number(usd), origin, recipient, refundTo, live, skipStorageCheck: !live });
console.log(JSON.stringify(q, null, 2));
if (!q.ok) process.exit(1);
if (live) console.log(`\nLIVE: send exactly ${q.send} ${q.symbol} on ${q.chain} to ${q.depositAddress}${q.depositMemo ? ` with memo ${q.depositMemo}` : ''} before ${q.deadline}.\nThen check: npm run topup:quote -- --status ${q.depositAddress}`);
