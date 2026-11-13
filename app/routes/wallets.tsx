// Public: the NEAR accounts the demo runs on, their live balances and explorer links. All of it is public on chain;
// no phone number is shown (the demo wallet is named by its contract account only).
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { Num, SiteFooter, TopBar, seo } from '../ui';

type Data = { network: string; explorer: string; rows: Row[]; at: number };
type Row = { role: string; account: string; near: number | null; usdc: number | null; note: string };

const getWallets = createServerFn({ method: 'GET' }).handler(async (): Promise<Data> => {
  const { env } = await import('../../src/config.ts');
  const { rpc, net, yoctoToNear } = await import('../../src/near.ts');
  const { bindingOf, ftBalance } = await import('../../src/wallet.ts');
  const demo = env.demoPhone ? bindingOf(env.demoPhone) : undefined;
  const list: Omit<Row, 'near' | 'usdc'>[] = [
    demo?.contract && { role: 'Demo wallet', account: demo.contract, note: 'The shared phone wallet the site and room use (PIN 4821). Its contract holds the limits.' },
    { role: 'Named phone wallet', account: 'liho.ringfence-wallet.near', note: 'A phone wallet with a readable name, used on the WhatsApp line.' },
    { role: 'Room host', account: 'liho00.near', note: 'Gifts in /room/liho00.near land here.' },
    env.packetsAccountId && { role: 'Money packets contract', account: env.packetsAccountId, note: 'Holds the NEAR locked in open packets.' },
    env.agentAccountId && { role: 'AI agent key', account: env.agentAccountId, note: 'Can only ask a wallet contract to send; pays gas.' },
    { role: 'Wallet factory', account: env.factoryAccountId, note: 'Creates a wallet contract per phone number.' },
    { role: 'Custody (phone-only wallets)', account: env.custodyAccountId, note: 'Owner of wallets made on WhatsApp until they are claimed.' },
  ].filter(Boolean) as Omit<Row, 'near' | 'usdc'>[];
  const rows = await Promise.all(list.map(async (r) => {
    const near = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: r.account })
      .then((a: any) => yoctoToNear(a.amount)).catch(() => null);
    const usdc = /wallet\.near$/.test(r.account) && r.role.includes('wallet') ? await ftBalance(env.usdcToken, r.account).then((x) => Number(x) / 1e6).catch(() => null) : null;
    return { ...r, near, usdc };
  }));
  return { network: env.network, explorer: net(env.network).explorer('').replace(/\/txns\/$/, ''), rows, at: Date.now() };
});

export const Route = createFileRoute('/wallets')({
  loader: () => getWallets(),
  head: () => ({ meta: seo({ title: 'Ringfence wallets, live on NEAR', description: 'Every NEAR account behind Ringfence with its live balance: the demo phone wallet, the room host, the money packets contract and the AI agent key. Open any of them on NearBlocks.', path: '/wallets', image: 'wallets' }) }),
  component: Wallets,
});

function Wallets() {
  const [s, setS] = useState<Data>(Route.useLoaderData() as Data);
  useEffect(() => { const t = setInterval(() => getWallets().then(setS).catch(() => {}), 15_000); return () => clearInterval(t); }, []);
  return (
    <>
      <main className="app stp">
        <TopBar />
        <h1>The wallets, live</h1>
        <p className="st-lead">NEAR {s.network}. Balances read from the chain every 15 seconds. Tap an account to open it on NearBlocks.</p>
        <div className="st-grid">
          {s.rows.map((r) => (
            <a className="st-tile wl-tile" key={r.account} href={`${s.explorer}/address/${r.account}`} target="_blank" rel="noreferrer">
              <p className="st-label">{r.role}</p>
              <p className="st-big wl-big"><Num value={r.near} /><small> NEAR</small></p>
              {r.usdc != null && <p className="wl-usdc"><Num value={r.usdc} digits={2} /> USDC</p>}
              <p className="st-note wl-acct" style={{ wordBreak: 'break-all' }}>{r.account} ↗</p>
              <p className="st-note">{r.note}</p>
            </a>
          ))}
        </div>
        <p className="st-lead"><a href="/stats">Stats</a> · <a href="/proof">Private AI proof</a> · <a href="/room/liho00.near">Live room</a></p>
      </main>
      <SiteFooter />
    </>
  );
}
