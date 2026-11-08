import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { AttRow, Signed, Wordmark, time, usd, type Att, type Proof } from '../ui';

// First paint comes with data; the page then polls /api/state every 3 s.
const getState = createServerFn({ method: 'GET' }).handler(async () => (await import('../backend.ts')).snapshot(false));

export const Route = createFileRoute('/dashboard')({
  loader: () => getState() as Promise<State>,
  head: () => ({ meta: [{ title: 'Dashboard · callhand' }] }),
  component: Dashboard,
});

type Timing = { sttMs?: number; firstTokenMs?: number; firstAudioMs?: number; totalMs?: number };
type Turn = { at: number; who: 'caller' | 'agent' | 'tool'; text: string; proof?: Proof; timing?: Timing };
const ms = (x?: number) => (x == null ? '–' : `${(x / 1000).toFixed(1)}s`);
type Call = { id: string; channel: 'web' | 'whatsapp' | 'dashboard'; desk?: string; from?: string; startedAt: number; endedAt?: number; turns: Turn[]; caller?: Record<string, string> };
type Job = { id: string; serviceName: string; quotedUsd: number; discountPct: number; depositUsd: number; preferredDate?: string; notes?: string; caller: Record<string, string>; createdAt: number; payment?: { status: string; originSymbol: string; chain: string } };
type Launch = { id: string; createdAt: number; network: string; status: string; params: { name: string; symbol: string; durationMinutes: number; softCapNear: number; team?: { pct: number } }; logoModel?: string; signer?: string; memeId?: number; txHash?: string; reason?: string };
type Ledger = { at: number; kind: string; desk?: string; detail: string };
type State = {
  owner: { business: { name: string; owner: string; area: string }; rules: Record<string, any>; payout: { asset_symbol: string; recipient: string } };
  launchpad: { rules: Record<string, any>; blocked_tickers: string[]; blocked_names: string[] };
  network: string; attestation: Att[]; model: string; calls: Call[]; jobs: Job[]; launches: Launch[]; ledger: Ledger[];
};

const PAYLABEL: Record<string, string> = { SUCCESS: 'Paid', PENDING_DEPOSIT: 'Waiting on the customer', KNOWN_DEPOSIT_TX: 'Deposit seen', PROCESSING: 'Swapping', REFUNDED: 'Refunded', FAILED: 'Failed', INCOMPLETE_DEPOSIT: 'Short deposit' };
const KIND: Record<string, string> = { quote: 'Quote', refused: 'Refused', booking: 'Booking', deposit_link: 'Link sent', payment: 'Payment', message: 'Message', launch_prepared: 'Launch ready', launch_signed: 'Signed', logo: 'Logo', photo: 'Photo', rules_proposed: 'Rules proposed', rules_changed: 'Rules changed', filtered: 'Reply filtered' };
const LSTATUS: Record<string, string> = { prepared: 'Waiting for signature', signed: 'Signed', live: 'Live', failed: 'Failed' };

function Dashboard() {
  const [s, setS] = useState<State | null>(Route.useLoaderData());
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [desk, setDesk] = useState<'all' | 'launch' | 'business' | 'owner'>('all');
  useEffect(() => {
    const load = () => fetch('/api/state').then(async (r) => (r.ok ? (setS(await r.json()), setErr('')) : setErr(`The server answered ${r.status}.`))).catch(() => setErr('Can’t reach the server.'));
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  if (!s) return <main className="app canvas"><Wordmark /><h1>Dashboard</h1><p className="muted">{err || 'Loading…'}</p></main>;

  const o = s.owner, lr = s.launchpad.rules;
  const calls = s.calls.filter((c) => desk === 'all' || c.desk === desk);
  const ledger = s.ledger.filter((l) => desk === 'all' || l.desk === desk);
  const paid = s.jobs.filter((j) => j.payment?.status === 'SUCCESS');
  const refused = s.ledger.filter((l) => l.kind === 'refused' || l.kind === 'filtered');
  const call = calls.find((c) => c.id === open) ?? calls[0];
  const signed = call ? call.turns.filter((t) => t.who === 'agent' && t.proof?.status === 'verified').length : 0;
  const agentTurns = call ? call.turns.filter((t) => t.who === 'agent' && t.proof).length : 0;

  return (
    <div className="app dash">
      <aside className="side">
        <div className="ws"><Wordmark /><div>Two desks on one engine<br />Launches on NEAR {s.network}</div></div>
        <nav aria-label="Sections">
          <a className="on" href="#overview">Overview</a>
          <a href="#launches">Launches</a>
          <a href="#jobs">Jobs</a>
          <a href="#ledger">Ledger</a>
          <a href="#rules">Rules</a>
          <a href="#settings">Settings line</a>
        </nav>
        <p className="foot-note">Rules come from launchpad.yaml and owner.yaml and are enforced in code, not by the model.</p>
      </aside>

      <main className="canvas" id="overview">
        <div className="titlerow">
          <div>
            <h1>Calls and launches</h1>
            <p className="muted">The last {s.calls.length} calls across both desks{err ? ` · ${err}` : ''}</p>
          </div>
          <div className="seg" role="radiogroup" aria-label="Filter by desk">
            {(['all', 'launch', 'business', 'owner'] as const).map((k) => <button key={k} role="radio" aria-checked={desk === k} className={desk === k ? 'on' : ''} onClick={() => setDesk(k)}>{k === 'all' ? 'All desks' : k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
        </div>

        <div className="grid">
          <div className="stack">
            <section className="card kpis" aria-label="Totals">
              <div><div className="l">Calls</div><div className="v">{s.calls.length}</div><div className="c">{s.calls.filter((c) => !c.endedAt).length} live now</div></div>
              <div><div className="l">Launches</div><div className="v">{s.launches.length}</div><div className="c">{s.launches.filter((l) => l.status === 'live').length} live on meme.cooking</div></div>
              <div><div className="l">Deposits paid</div><div className="v">{usd(paid.reduce((n, j) => n + j.depositUsd, 0))}</div><div className="c">{paid.length} of {s.jobs.length} jobs, in {o.payout.asset_symbol}</div></div>
              <div><div className="l">Refused or filtered</div><div className="v">{refused.length}</div><div className="c">in the last {s.ledger.length} ledger lines</div></div>
            </section>

            <section className="card" aria-labelledby="tr">
              <div className="panelhead">
                <h2 id="tr">{call ? `Call at ${time(call.startedAt)}` : 'Calls'}{call?.desk ? ` · ${call.desk} desk` : ''}</h2>
                {call && <span className="muted" style={{ fontSize: 13 }}>{call.channel === 'whatsapp' ? `WhatsApp ${call.from ?? ''}` : call.channel === 'dashboard' ? 'Dashboard' : 'Browser'} · {signed} of {agentTurns} replies TEE-signed {call.endedAt ? '' : '· live'}</span>}
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
              {s.launches.length ? (
                <div className="scroll"><table>
                  <thead><tr><th>Coin</th><th>Auction</th><th>Logo</th><th>Status</th></tr></thead>
                  <tbody>{s.launches.map((l) => (
                    <tr key={l.id}>
                      <td><a href={`/launch/${l.id}`}>${l.params.symbol}</a><span className="sub">{l.params.name} · {time(l.createdAt)}</span></td>
                      <td>{l.params.durationMinutes} min, {l.params.softCapNear} NEAR soft cap<span className="sub">{l.params.team ? `${l.params.team.pct}% team` : 'no team share'} · {l.network}</span></td>
                      <td>{l.logoModel ?? '—'}</td>
                      <td><span className={`pill ${l.status === 'live' ? 'ok' : l.status === 'failed' ? 'warn' : 'wait'}`}>{LSTATUS[l.status] ?? l.status}</span><span className="sub">{l.memeId != null ? `meme #${l.memeId} · ${l.signer}` : l.reason ?? ''}</span></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="none">No launches yet. Call the launch desk to prepare one.</p>}
            </section>

            <section className="card" id="jobs" aria-labelledby="jh">
              <div className="panelhead"><h2 id="jh">Jobs and deposits</h2><span className="muted" style={{ fontSize: 13 }}>{o.business.name} · {s.jobs.length} booked</span></div>
              {s.jobs.length ? (
                <div className="scroll"><table>
                  <thead><tr><th>Customer</th><th>Job</th><th className="n">Quote</th><th className="n">Deposit</th><th>Payment</th></tr></thead>
                  <tbody>{s.jobs.map((j) => (
                    <tr key={j.id}>
                      <td>{j.caller.name}<span className="sub">{j.caller.postcode} · {time(j.createdAt)}</span></td>
                      <td>{j.serviceName}<span className="sub">{[j.preferredDate, j.notes].filter(Boolean).join(' · ') || '—'}</span></td>
                      <td className="n">{usd(j.quotedUsd)}{j.discountPct ? <span className="sub">−{j.discountPct}%</span> : null}</td>
                      <td className="n">{usd(j.depositUsd)}</td>
                      <td>{j.payment
                        ? <><span className={`pill ${j.payment.status === 'SUCCESS' ? 'ok' : /FAIL|REFUND|INCOMPLETE/.test(j.payment.status) ? 'warn' : 'wait'}`}>{PAYLABEL[j.payment.status] ?? j.payment.status}</span><span className="sub">{j.payment.originSymbol} on {j.payment.chain}</span></>
                        : <><a href={`/pay/${j.id}`}>Link sent</a><span className="sub">not opened yet</span></>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="none">No visits booked yet.</p>}
            </section>

            <section className="card" id="ledger" aria-labelledby="lh">
              <div className="panelhead"><h2 id="lh">Ledger</h2><span className="muted" style={{ fontSize: 13 }}>Every refusal, launch, quote, rule change and payment</span></div>
              {ledger.length ? (
                <div className="scroll"><table className="ledger"><tbody>{ledger.slice(0, 40).map((l, i) => (
                  <tr key={i}><td>{time(l.at)}</td><td><span className={`pill ${l.kind === 'refused' || l.kind === 'filtered' ? 'warn' : l.kind === 'payment' || l.kind === 'launch_signed' || l.kind === 'rules_changed' ? 'ok' : ''}`}>{KIND[l.kind] ?? l.kind}</span><span className="sub">{l.desk ?? ''}</span></td><td>{l.detail}</td></tr>
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
                    <span>{time(c.startedAt)} · {c.desk ?? 'routing'} · {c.caller?.name ?? (c.channel === 'whatsapp' ? c.from : c.channel === 'dashboard' ? 'Owner' : 'Browser')}</span>
                    <span className="muted">{c.endedAt ? `${c.turns.length} turns` : 'live'}</span>
                  </button></li>
                ))}</ul> : <p className="none">None yet.</p>}
              </div>
            </section>

            <section className="railsec" id="settings" aria-labelledby="sh">
              <h2 id="sh">Settings line</h2>
              <OwnerDesk />
            </section>

            <section className="railsec" id="rules" aria-labelledby="rh">
              <h2 id="rh">Rules</h2>
              <div className="card rules">
                <div className="row"><span>Launch kill switch</span>{lr.kill_switch ? <span className="pill warn">On: no launches</span> : <b>Off</b>}</div>
                <div className="row"><span>Ticker</span><b>{lr.ticker_min}–{lr.ticker_max} of A–Z, 0–9</b></div>
                <div className="row"><span>Blocked</span><b>{s.launchpad.blocked_tickers.length} tickers, {s.launchpad.blocked_names.length} names</b></div>
                <div className="row"><span>Auction</span><b>{lr.duration_min_minutes} min to {lr.duration_max_minutes / 60} h</b></div>
                <div className="row"><span>Soft cap</span><b>{lr.soft_cap_min_near}–{lr.soft_cap_max_near} NEAR</b></div>
                <div className="row"><span>Team share</span><b>≤ {lr.max_team_allocation_pct}%, cliff ≥ {lr.min_cliff_days} d, vest ≥ {lr.min_vesting_days} d</b></div>
                <div className="row"><span>Max discount</span><b>{o.rules.max_discount_pct}%</b></div>
                <div className="row"><span>Deposit</span><b>{o.rules.deposit_pct}% ({usd(o.rules.min_deposit_usd)}–{usd(o.rules.max_deposit_usd)})</b></div>
                <div className="row"><span>Work refused</span><b>{(o.rules.refuse_work ?? []).join(', ') || 'None'}</b></div>
                <div className="row"><span>Business kill switch</span>{o.rules.kill_switch ? <span className="pill warn">On: messages only</span> : <b>Off</b>}</div>
                <div className="row"><span>Payout</span><b style={{ wordBreak: 'break-all', textAlign: 'right' }}>{o.payout.asset_symbol} to {o.payout.recipient || 'not set'}</b></div>
              </div>
            </section>

            <section className="railsec" aria-labelledby="ah">
              <h2 id="ah">Private inference</h2>
              <div className="card att">
                {s.attestation.map((a) => <AttRow key={a.model} a={a} />)}
                <p className="muted" style={{ margin: 0 }}>Checked by this server with a fresh nonce: Intel’s signature on the TDX quote (collateral from Intel PCS), the key and nonce in report_data, and the GPUs through NVIDIA NRAS. Chat and photo replies are checked against these keys. Details on the public <a href="/proof">proof page</a>; verify independently with <code>npm run attest</code> or the <a href="https://docs.near.ai/cloud/verification/">NEAR AI verification docs</a>.</p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

// The owner desk in text: say a rule change, read the diff, say yes.
function OwnerDesk() {
  const [id, setId] = useState<string | null>(null);
  const [lines, setLines] = useState<{ who: 'agent' | 'caller'; text: string }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(t: string) {
    setBusy(true);
    if (t) setLines((l) => [...l, { who: 'caller', text: t }]);
    const r = await fetch('/api/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callId: id, text: t }) });
    const d = await r.json().catch(() => ({ error: 'Something went wrong' }));
    setBusy(false);
    if (d.callId) setId(d.callId);
    setLines((l) => [...l, { who: 'agent', text: d.say ?? d.error }]);
  }
  return (
    <div className="card ownerdesk">
      <div className="transcript">
        {lines.length ? lines.map((l, i) => <div key={i} className={`bubble ${l.who}`}>{l.text}</div>) : <p className="muted" style={{ margin: 0 }}>Change the business rules by saying it, for example “max 15% off and no roofs”. You confirm the diff before owner.yaml changes.</p>}
      </div>
      <form className="typed" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send(text.trim()); setText(''); } }}>
        <label className="vh" htmlFor="ownerline">Tell the settings line what to change</label>
        <input id="ownerline" value={text} onChange={(e) => setText(e.target.value)} placeholder="Max 15% off, no roofs" autoComplete="off" />
        <button className="btn small ink" disabled={busy}>{busy ? '…' : 'Send'}</button>
      </form>
    </div>
  );
}
