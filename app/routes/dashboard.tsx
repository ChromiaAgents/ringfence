import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { Signed, Wordmark, time, usd, type Proof } from '../ui';

// First paint comes with data; the page then polls /api/state every 3 s.
const getState = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ owner, env }, { db }, { attest }] = await Promise.all([import('../../src/config.ts'), import('../../src/store.ts'), import('../../src/ai.ts')]);
  const a = await attest().catch((e) => ({ error: String(e.message) }));
  return JSON.parse(JSON.stringify({ owner: owner(), attestation: a, model: env.llmModel, calls: db.calls.slice(-30).reverse(), jobs: db.jobs.slice(-30).reverse(), ledger: db.ledger.slice(-100).reverse() }));
});

export const Route = createFileRoute('/dashboard')({
  loader: () => getState() as Promise<State>,
  head: () => ({ meta: [{ title: 'Owner dashboard · callhand' }] }),
  component: Dashboard,
});

type Turn = { at: number; who: 'caller' | 'agent' | 'tool'; text: string; proof?: Proof };
type Call = { id: string; channel: 'web' | 'whatsapp'; from?: string; startedAt: number; endedAt?: number; turns: Turn[]; caller?: Record<string, string>; jobId?: string };
type Job = { id: string; serviceName: string; quotedUsd: number; discountPct: number; depositUsd: number; preferredDate?: string; notes?: string; caller: Record<string, string>; createdAt: number; payment?: { status: string; originSymbol: string; chain: string } };
type Ledger = { at: number; kind: string; detail: string };
type State = {
  owner: { business: { name: string; owner: string; area: string }; rules: Record<string, any>; payout: { asset_symbol: string; recipient: string } };
  attestation: { model: string; signingAddress: string; quoteBindsKey: boolean } | { error: string };
  model: string; calls: Call[]; jobs: Job[]; ledger: Ledger[];
};

const PAYLABEL: Record<string, string> = { SUCCESS: 'Paid', PENDING_DEPOSIT: 'Waiting on the customer', KNOWN_DEPOSIT_TX: 'Deposit seen', PROCESSING: 'Swapping', REFUNDED: 'Refunded', FAILED: 'Failed', INCOMPLETE_DEPOSIT: 'Short deposit' };
const KIND: Record<string, string> = { quote: 'Quote', refused: 'Refused', booking: 'Booking', deposit_link: 'Link sent', payment: 'Payment', message: 'Message' };

function Dashboard() {
  const [s, setS] = useState<State | null>(Route.useLoaderData());
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/state').then(async (r) => (r.ok ? (setS(await r.json()), setErr('')) : setErr(`The server answered ${r.status}.`))).catch(() => setErr('Can’t reach the server.'));
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  if (!s) return <main className="app canvas"><Wordmark /><h1>Owner dashboard</h1><p className="muted">{err || 'Loading…'}</p></main>;

  const o = s.owner;
  const paid = s.jobs.filter((j) => j.payment?.status === 'SUCCESS');
  const refused = s.ledger.filter((l) => l.kind === 'refused').length;
  const call = s.calls.find((c) => c.id === open) ?? s.calls[0];
  const signed = call ? call.turns.filter((t) => t.who === 'agent' && t.proof?.status === 'verified').length : 0;
  const agentTurns = call ? call.turns.filter((t) => t.who === 'agent' && t.proof).length : 0;
  const a = s.attestation;

  return (
    <div className="app dash">
      <aside className="side">
        <div className="ws"><Wordmark /><div>{o.business.name}<br />{o.business.area}</div></div>
        <nav aria-label="Sections">
          <a className="on" href="#overview">Overview</a>
          <a href="#jobs">Jobs</a>
          <a href="#ledger">Ledger</a>
          <a href="#rules">Rules</a>
        </nav>
        <p className="foot-note">Rules come from owner.yaml and are enforced in code, not by the model.</p>
      </aside>

      <main className="canvas" id="overview">
        <div className="titlerow">
          <div>
            <h1>{o.business.name}</h1>
            <p className="muted">Calls answered for {o.business.owner}, the last {s.calls.length} shown{err ? ` · ${err}` : ''}</p>
          </div>
          <a className="btn small ink" href="/" target="_blank" rel="noreferrer">Ring the line</a>
        </div>

        <div className="grid">
          <div className="stack">
            <section className="card kpis" aria-label="Totals">
              <div><div className="l">Calls</div><div className="v">{s.calls.length}</div><div className="c">{s.calls.filter((c) => !c.endedAt).length} live now</div></div>
              <div><div className="l">Visits booked</div><div className="v">{s.jobs.length}</div><div className="c">{usd(s.jobs.reduce((n, j) => n + j.quotedUsd, 0))} quoted</div></div>
              <div><div className="l">Deposits paid</div><div className="v">{usd(paid.reduce((n, j) => n + j.depositUsd, 0))}</div><div className="c">{paid.length} of {s.jobs.length} jobs, in {o.payout.asset_symbol}</div></div>
              <div><div className="l">Refused by rules</div><div className="v">{refused}</div><div className="c">in the last {s.ledger.length} ledger lines</div></div>
            </section>

            <section className="card" aria-labelledby="tr">
              <div className="panelhead">
                <h2 id="tr">{call ? `Call at ${time(call.startedAt)}` : 'Calls'}{call?.caller?.name ? ` · ${call.caller.name}` : ''}</h2>
                {call && <span className="muted" style={{ fontSize: 13 }}>{call.channel === 'whatsapp' ? `WhatsApp ${call.from ?? ''}` : 'Browser'} · {signed} of {agentTurns} replies TEE-signed {call.endedAt ? '' : '· live'}</span>}
              </div>
              {call ? (
                <div className="transcript">
                  {call.turns.map((t, i) => (
                    <div key={i} className={`bubble ${t.who}`}>{t.text}{t.who === 'agent' && <Signed proof={t.proof} />}</div>
                  ))}
                </div>
              ) : <p className="none">No calls yet. Ring the line and the transcript appears here as it happens.</p>}
            </section>

            <section className="card" id="jobs" aria-labelledby="jh">
              <div className="panelhead"><h2 id="jh">Jobs and deposits</h2><span className="muted" style={{ fontSize: 13 }}>{s.jobs.length} booked</span></div>
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
              <div className="panelhead"><h2 id="lh">Ledger</h2><span className="muted" style={{ fontSize: 13 }}>Every quote, refusal, booking and payment</span></div>
              {s.ledger.length ? (
                <div className="scroll"><table className="ledger"><tbody>{s.ledger.slice(0, 30).map((l, i) => (
                  <tr key={i}><td>{time(l.at)}</td><td><span className={`pill ${l.kind === 'refused' ? 'warn' : l.kind === 'payment' ? 'ok' : ''}`}>{KIND[l.kind] ?? l.kind}</span></td><td>{l.detail}</td></tr>
                ))}</tbody></table></div>
              ) : <p className="none">Nothing yet.</p>}
            </section>
          </div>

          <div>
            <section className="railsec" aria-labelledby="ch">
              <h2 id="ch">Recent calls</h2>
              <div className="card">
                {s.calls.length ? <ul className="calls">{s.calls.slice(0, 8).map((c) => (
                  <li key={c.id}><button className={c.id === call?.id ? 'on' : ''} onClick={() => setOpen(c.id)}>
                    <span>{time(c.startedAt)} · {c.caller?.name ?? (c.channel === 'whatsapp' ? c.from : 'Browser caller')}</span>
                    <span className="muted">{c.endedAt ? `${c.turns.length} turns` : 'live'}</span>
                  </button></li>
                ))}</ul> : <p className="none">None yet.</p>}
              </div>
            </section>

            <section className="railsec" id="rules" aria-labelledby="rh">
              <h2 id="rh">Rules</h2>
              <div className="card rules">
                <div className="row"><span>Max discount</span><b>{o.rules.max_discount_pct}%</b></div>
                <div className="row"><span>Deposit</span><b>{o.rules.deposit_pct}% ({usd(o.rules.min_deposit_usd)}–{usd(o.rules.max_deposit_usd)})</b></div>
                <div className="row"><span>Outside {o.business.area}</span><b>{o.rules.accept_jobs_outside_area ? 'Accepted' : 'Declined'}</b></div>
                <div className="row"><span>Kill switch</span>{o.rules.kill_switch ? <span className="pill warn">On: messages only</span> : <b>Off</b>}</div>
                <div className="row"><span>Payout</span><b style={{ wordBreak: 'break-all', textAlign: 'right' }}>{o.payout.asset_symbol} to {o.payout.recipient || 'not set'}</b></div>
              </div>
            </section>

            <section className="railsec" aria-labelledby="ah">
              <h2 id="ah">Private inference</h2>
              <div className="card att">
                {'error' in a ? <p><span className="pill warn">Attestation unavailable</span> {a.error}</p> : (
                  <>
                    <p>{a.model} runs in an Intel TDX and NVIDIA TEE on NEAR AI Cloud.</p>
                    <p>Signing key <b style={{ wordBreak: 'break-all' }}>{a.signingAddress}</b></p>
                    <p>{a.quoteBindsKey ? <span className="pill ok">Bound in the TDX quote</span> : <span className="pill warn">Not bound</span>}</p>
                  </>
                )}
                <p className="muted" style={{ margin: 0 }}>Each reply is checked against this key. Intel’s signature on the quote is not checked here; use the <a href="https://docs.near.ai/cloud/verification/verification-center">NEAR Verification Center</a> for that.</p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
