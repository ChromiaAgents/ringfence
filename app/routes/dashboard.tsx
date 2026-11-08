import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { AttRow, Makers, Signed, SiteFooter, Wordmark, time, type Att, type Proof } from '../ui';

// First paint comes with data; the page then polls /api/state every 3 s.
const getState = createServerFn({ method: 'GET' }).handler(async () => (await import('../backend.ts')).snapshot(false));

export const Route = createFileRoute('/dashboard')({
  loader: () => getState() as Promise<State>,
  head: () => ({ meta: [{ title: 'Dashboard · Ringfence' }] }),
  component: Dashboard,
});

type Timing = { sttMs?: number; firstTokenMs?: number; firstAudioMs?: number; totalMs?: number };
type Turn = { at: number; who: 'caller' | 'agent' | 'tool'; text: string; proof?: Proof; timing?: Timing };
const ms = (x?: number) => (x == null ? '–' : `${(x / 1000).toFixed(1)}s`);
type Call = { id: string; channel: 'web' | 'whatsapp'; desk?: string; from?: string; startedAt: number; endedAt?: number; turns: Turn[]; caller?: Record<string, string> };
type Launch = { id: string; createdAt: number; network: string; status: string; params: { name: string; symbol: string }; logoModel?: string; signer?: string; tokenId?: string; txHash?: string; reason?: string };
type Ledger = { at: number; kind: string; desk?: string; detail: string };
type State = {
  launchpad: { rules: Record<string, any>; blocked_tickers: string[]; blocked_names: string[] };
  network: string; attestation: Att[]; model: string; calls: Call[]; launches: Launch[]; ledger: Ledger[];
};

const KIND: Record<string, string> = { refused: 'Refused', launch_prepared: 'Launch ready', launch_signed: 'Signed', logo: 'Logo', filtered: 'Reply filtered', wallet: 'Wallet' };
const LSTATUS: Record<string, string> = { prepared: 'Waiting for signature', signed: 'Signed', live: 'Live', failed: 'Failed' };

function Dashboard() {
  const [s, setS] = useState<State | null>(Route.useLoaderData());
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [desk, setDesk] = useState<'all' | 'launch' | 'wallet'>('all');
  useEffect(() => {
    const load = () => fetch('/api/state').then(async (r) => (r.ok ? (setS(await r.json()), setErr('')) : setErr(`The server answered ${r.status}.`))).catch(() => setErr('Can’t reach the server.'));
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  if (!s) return <main className="app canvas"><Wordmark /><h1>Dashboard</h1><p className="muted">{err || 'Loading…'}</p></main>;

  const lr = s.launchpad.rules;
  // Old test launches whose name or ticker the desk would now refuse stay in the DB but are not shown.
  const blocked = (l: Launch) => s.launchpad.blocked_tickers.includes(l.params.symbol.toUpperCase()) || s.launchpad.blocked_names.some((n) => `${l.params.name} ${l.params.symbol}`.toLowerCase().includes(n));
  const launches = s.launches.filter((l) => !blocked(l));
  // Only the wallet and launch desks exist; older records from other desks may still sit in the store and are skipped.
  const known = (d?: string) => !d || d === 'wallet' || d === 'launch';
  const calls = s.calls.filter((c) => known(c.desk) && c.channel !== ('dashboard' as string) && (desk === 'all' || c.desk === desk));
  const ledger = s.ledger.filter((l) => known(l.desk) && l.kind in KIND && (desk === 'all' || l.desk === desk));
  const refused = s.ledger.filter((l) => known(l.desk) && (l.kind === 'refused' || l.kind === 'filtered'));
  const call = calls.find((c) => c.id === open) ?? calls[0];
  const signed = call ? call.turns.filter((t) => t.who === 'agent' && t.proof?.status === 'verified').length : 0;
  const agentTurns = call ? call.turns.filter((t) => t.who === 'agent' && t.proof).length : 0;

  return (
    <div className="app dash">
      <aside className="side">
        <div className="ws"><Wordmark /><div>Wallet and launch desks<br />NEAR {s.network}</div><Makers /></div>
        <nav aria-label="Sections">
          <a className="on" href="#overview">Overview</a>
          <a href="#launches">Launches</a>
          <a href="#ledger">Ledger</a>
          <a href="#rules">Rules</a>
        </nav>
        <p className="foot-note">Launch rules come from launchpad.yaml and are checked in code. Spending limits live in each phone-wallet contract.</p>
      </aside>

      <main className="canvas" id="overview">
        <div className="titlerow">
          <div>
            <h1>Calls</h1>
            <p className="muted">The last {calls.length} calls on the wallet and launch desks{err ? ` · ${err}` : ''}</p>
          </div>
          <div className="seg" role="radiogroup" aria-label="Filter by desk">
            {(['all', 'wallet', 'launch'] as const).map((k) => <button key={k} role="radio" aria-checked={desk === k} className={desk === k ? 'on' : ''} onClick={() => setDesk(k)}>{k === 'all' ? 'All desks' : k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
        </div>

        <div className="grid">
          <div className="stack">
            <section className="card kpis" aria-label="Totals">
              <div><div className="l">Calls</div><div className="v">{calls.length}</div><div className="c">{calls.filter((c) => !c.endedAt).length} live now</div></div>
              <div><div className="l">Launches</div><div className="v">{launches.length}</div><div className="c">{launches.filter((l) => l.status === 'live').length} live on JustHoot</div></div>
              <div><div className="l">Refused or filtered</div><div className="v">{refused.length}</div><div className="c">in the last {s.ledger.length} ledger lines</div></div>
            </section>

            <section className="card" aria-labelledby="tr">
              <div className="panelhead">
                <h2 id="tr">{call ? `Call at ${time(call.startedAt)}` : 'Calls'}{call?.desk ? ` · ${call.desk} desk` : ''}</h2>
                {call && <span className="muted" style={{ fontSize: 13 }}>{call.channel === 'whatsapp' ? `WhatsApp ${call.from ?? ''}` : 'Browser'}{agentTurns ? ` · ${signed} of ${agentTurns} replies TEE-signed` : ''}{call.endedAt ? '' : ' · live'}</span>}
              </div>
              {call ? (
                <div className="transcript">
                  {call.turns.map((t, i) => (
                    <div key={i} className={`bubble ${t.who}`}>{t.text.replace(/data:image\/\w+;base64,[A-Za-z0-9+/=]+/g, '<image>')}{t.who === 'agent' && <Signed proof={t.proof} />}{t.timing && <div className="muted" style={{ fontSize: 12 }}>stt {ms(t.timing.sttMs)} · first token {ms(t.timing.firstTokenMs)} · first audio {ms(t.timing.firstAudioMs)} · total {ms(t.timing.totalMs)}</div>}</div>
                  ))}
                </div>
              ) : <p className="none">No calls yet. Ring the line and the transcript appears here as it happens.</p>}
            </section>

            <section className="card" id="launches" aria-labelledby="lch">
              <div className="panelhead"><h2 id="lch">Launches</h2><span className="muted" style={{ fontSize: 13 }}>Prepared by the desk, signed by the caller</span></div>
              {launches.length ? (
                <div className="scroll"><table>
                  <thead><tr><th>Coin</th><th>Launchpad</th><th>Logo</th><th>Status</th></tr></thead>
                  <tbody>{launches.map((l) => (
                    <tr key={l.id}>
                      <td><a href={`/launch/${l.id}`}>${l.params.symbol}</a><span className="sub">{l.params.name} · {time(l.createdAt)}</span></td>
                      <td>JustHoot<span className="sub">{l.network}</span></td>
                      <td>{l.logoModel ?? '—'}</td>
                      <td><span className={`pill ${l.status === 'live' ? 'ok' : l.status === 'failed' ? 'warn' : 'wait'}`}>{LSTATUS[l.status] ?? l.status}</span><span className="sub">{l.status === 'live' ? `${l.tokenId ?? 'token'} · ${l.signer}` : l.reason ?? ''}</span></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="none">No launches yet. Call the launch desk to prepare one.</p>}
            </section>

            <section className="card" id="ledger" aria-labelledby="lh">
              <div className="panelhead"><h2 id="lh">Ledger</h2><span className="muted" style={{ fontSize: 13 }}>Every refusal, launch and wallet action</span></div>
              {ledger.length ? (
                <div className="scroll"><table className="ledger"><tbody>{ledger.slice(0, 40).map((l, i) => (
                  <tr key={i}><td>{time(l.at)}</td><td><span className={`pill ${l.kind === 'refused' || l.kind === 'filtered' ? 'warn' : l.kind === 'launch_signed' ? 'ok' : ''}`}>{KIND[l.kind] ?? l.kind}</span><span className="sub">{l.desk ?? ''}</span></td><td>{l.detail}</td></tr>
                ))}</tbody></table></div>
              ) : <p className="none">Nothing yet.</p>}
            </section>
          </div>

          <div>
            <section className="railsec" aria-labelledby="ch">
              <h2 id="ch">Recent calls</h2>
              <div className="card">
                {calls.length ? <ul className="calls">{calls.slice(0, 8).map((c) => (
                  <li key={c.id}><button className={c.id === call?.id ? 'on' : ''} onClick={() => setOpen(c.id)}>
                    <span>{time(c.startedAt)} · {c.desk ?? 'agent'} · {c.caller?.name ?? (c.channel === 'whatsapp' ? c.from : 'Browser')}</span>
                    <span className="muted">{c.endedAt ? `${c.turns.length} turns` : 'live'}</span>
                  </button></li>
                ))}</ul> : <p className="none">None yet.</p>}
              </div>
            </section>

            <section className="railsec" id="rules" aria-labelledby="rh">
              <h2 id="rh">Rules</h2>
              <div className="card rules">
                <div className="row"><span>Launch kill switch</span>{lr.kill_switch ? <span className="pill warn">On: no launches</span> : <b>Off</b>}</div>
                <div className="row"><span>Ticker</span><b>{lr.ticker_min}–{lr.ticker_max} of A–Z, 0–9</b></div>
                <div className="row"><span>Blocked</span><b>{s.launchpad.blocked_tickers.length} tickers, {s.launchpad.blocked_names.length} names</b></div>
              </div>
            </section>

            <section className="railsec" aria-labelledby="ah">
              <h2 id="ah">Private inference</h2>
              <div className="card att">
                {s.attestation.map((a) => <AttRow key={a.model} a={a} />)}
                <p className="muted" style={{ margin: 0 }}>Checked by this server with a fresh nonce: Intel’s signature on the TDX attestation report (collateral from Intel PCS), the key and nonce in report_data, and the GPUs through NVIDIA NRAS. Chat and photo replies are checked against these keys. Details on the public <a href="/proof">proof page</a>; verify independently with <code>npm run attest</code> or the <a href="https://docs.near.ai/cloud/verification/">NEAR AI verification docs</a>.</p>
              </div>
            </section>
          </div>
        </div>
        <SiteFooter />
      </main>
    </div>
  );
}

