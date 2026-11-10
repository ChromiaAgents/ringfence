// Public numbers about the line. Counts only: nothing anyone said is shown here (src/stats.ts).
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { Makers, SiteFooter, Wordmark } from '../ui';
import type { PublicStats } from '../../src/stats.ts';

const getStats = createServerFn({ method: 'GET' }).handler(async () => {
  const { publicStats } = await import('../../src/stats.ts');
  return JSON.parse(JSON.stringify(publicStats())) as PublicStats;
});

export const Route = createFileRoute('/stats')({
  loader: () => getStats(),
  head: () => ({ meta: [{ title: 'Stats · Ringfence' }] }),
  component: Stats,
});

const n = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 4 });

function Stats() {
  const [s, setS] = useState<PublicStats>(Route.useLoaderData() as PublicStats);
  useEffect(() => { const t = setInterval(() => getStats().then(setS).catch(() => {}), 10_000); return () => clearInterval(t); }, []);
  const tiles: [string, string, string][] = [
    [n(s.calls.total), 'calls answered', `${n(s.calls.browser)} in the browser, ${n(s.calls.whatsapp)} on WhatsApp`],
    [n(s.packets.made), 'money packets made', s.realPackets ? `${n(s.packets.onChain)} on chain` : 'dry runs until the contracts are on mainnet'],
    [n(s.packets.sharesOpened), 'shares opened by saying the words', `${n(s.packets.nearGiven)} NEAR handed out${s.realPackets ? `, ${n(s.packets.nearGivenOnChain)} of it on chain` : ' (play money)'}`],
    [n(s.sends.onChain + s.sends.dryRun), 'sends by voice', `${n(s.sends.onChain)} on chain, ${n(s.sends.dryRun)} dry runs`],
    [n(s.refused.total), 'times the answer was no', `${n(s.refused.overLimit)} over a limit, ${n(s.refused.wrongPin)} wrong PIN, ${n(s.refused.wrongWords)} wrong words, ${n(s.refused.notMe)} “Not me”`],
    [s.medianReplyMs == null ? 'n/a' : `${(s.medianReplyMs / 1000).toFixed(1)} s`, 'to start answering (median)', `${n(s.replies)} replies so far`],
    [n(s.wallets.total), 'phone wallets on chain', `${n(s.wallets.phoneOnly)} made with “create a wallet”`],
    [n(s.filteredReplies), 'replies stopped by the hype filter', 'a reply that promises returns is replaced before it is spoken'],
  ];
  return (
    <>
      <main className="app stp">
        <div className="brandrow"><Wordmark /><Makers /></div>
        <h1>The line, in numbers</h1>
        <p className="st-lead">Live counts from this server on NEAR {s.network}{s.since ? `, since ${new Date(s.since).toLocaleDateString('en-GB', { dateStyle: 'medium' })}` : ''}. Counts only: what people said on calls stays private. {s.realMoney ? 'Sends are real.' : 'The server has no keys yet, so every send and packet so far is a labelled dry run.'}</p>
        <div className="st-grid">
          {tiles.map(([big, label, note]) => (
            <div className="st-tile" key={label}><p className="st-big">{big}</p><p className="st-label">{label}</p><p className="st-note">{note}</p></div>
          ))}
        </div>
        <p className="st-lead">The AI runs on NEAR AI Cloud: {s.models.chat} for the conversation and {s.models.speech} for speech. <a href="/proof">See the attestation</a>. <a href="/packet/demo">Open a money packet</a>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
