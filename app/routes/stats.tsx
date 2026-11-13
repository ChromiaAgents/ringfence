// Public numbers about the line. Counts only: nothing anyone said is shown here (src/stats.ts).
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { Makers, Num, SiteFooter, Wordmark, TopBar, seo } from '../ui';
import type { PublicStats } from '../../src/stats.ts';

const getStats = createServerFn({ method: 'GET' }).handler(async () => {
  const { publicStats } = await import('../../src/stats.ts');
  return JSON.parse(JSON.stringify(publicStats())) as PublicStats;
});

export const Route = createFileRoute('/stats')({
  loader: () => getStats(),
  head: () => ({ meta: seo({ title: 'Ringfence, in numbers', description: 'Live counts from the line: calls answered, money packets opened by voice, sends on NEAR mainnet, and every time the contract said no.', path: '/stats', image: 'stats' }) }),
  component: Stats,
});

const n = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 4 });

function Stats() {
  const [s, setS] = useState<PublicStats>(Route.useLoaderData() as PublicStats);
  useEffect(() => { const t = setInterval(() => getStats().then(setS).catch(() => {}), 10_000); return () => clearInterval(t); }, []);
  const tiles: [React.ReactNode, string, string][] = [
    [<Num value={s.calls.total} />, 'calls answered', `${n(s.calls.browser)} in the browser, ${n(s.calls.whatsapp)} on WhatsApp`],
    [<Num value={s.packets.made} />, 'money packets made', s.realPackets ? `${n(s.packets.onChain)} on chain` : 'dry runs until the contracts are on mainnet'],
    [<Num value={s.packets.sharesOpened} />, 'shares opened by saying the words', `${n(s.packets.nearGiven)} NEAR handed out${s.realPackets ? `, ${n(s.packets.nearGivenOnChain)} of it on chain` : ' (play money)'}`],
    [<Num value={s.sends.onChain + s.sends.dryRun} />, 'sends by voice', `${n(s.sends.onChain)} on chain, ${n(s.sends.dryRun)} dry runs`],
    [<Num value={s.refused.total} />, 'times the answer was no', `${n(s.refused.overLimit)} over a limit, ${n(s.refused.wrongPin)} wrong PIN, ${n(s.refused.wrongWords)} wrong words, ${n(s.refused.notMe)} “Not me”`],
    [s.medianReplyMs == null ? 'n/a' : `${(s.medianReplyMs / 1000).toFixed(1)} s`, 'to start answering (median)', `${n(s.replies)} replies so far`],
    [<Num value={s.wallets.total} />, 'phone wallets on chain', `${n(s.wallets.phoneOnly)} made with “create a wallet”`],
    [<Num value={s.filteredReplies} />, 'replies stopped by the hype filter', 'a reply that promises returns is replaced before it is spoken'],
  ];
  return (
    <>
      <main className="app stp">
        <TopBar />
        <h1>The line, in numbers</h1>
        <p className="st-lead">Live, NEAR {s.network}{s.since ? `, since ${new Date(s.since).toLocaleDateString('en-GB', { dateStyle: 'medium' })}` : ''}. Counts only, no call content.{s.realMoney ? '' : ' Dry run so far.'}</p>
        <div className="st-grid">
          {tiles.map(([big, label, note]) => (
            <div className="st-tile" key={label}><p className="st-big">{big}</p><p className="st-label">{label}</p><p className="st-note">{note}</p></div>
          ))}
        </div>
        <p className="st-lead"><a href="/wallets">Wallets and balances</a> · <a href="/proof">Private AI proof</a> · <a href="/packet/demo">Open a money packet</a></p>
      </main>
      <SiteFooter />
    </>
  );
}
