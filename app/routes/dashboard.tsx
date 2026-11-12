import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AttRow, Signed, SiteFooter, TopBar, time, type Att, type Proof } from '../ui';

// The data comes only from /api/state, which the server puts behind the owner's password. It used to be loaded by a
// server function too, and a server function has its own public address that the password check never saw: anyone
// could read the last 30 call transcripts. Never load owner data through a server function.

export const Route = createFileRoute('/dashboard')({
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
  network: string; attestation: Att[]; model: string; calls: Call[]; launches: Launch[]; ledger: Ledger[]; access?: { phone: string; name: string; at: number }[];
};

const KIND: Record<string, string> = { refused: 'Refused', launch_prepared: 'Launch ready', launch_signed: 'Signed', logo: 'Logo', filtered: 'Reply filtered', wallet: 'Wallet' };
const LSTATUS: Record<string, string> = { prepared: 'Waiting for signature', signed: 'Signed', live: 'Live', failed: 'Failed' };

const TABS = [['overview', 'Overview'], ['calls', 'Calls'], ['access', 'WhatsApp access'], ['launches', 'Launches'], ['ledger', 'Ledger'], ['rules', 'Rules and proof']] as const;
type Tab = (typeof TABS)[number][0];

function Stat({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: 'ok' | 'warn' }) {
  return <div className={`db-stat ${tone ?? ''}`}><p className="l">{label}</p><p className="v">{value}</p>{note && <p className="c">{note}</p>}</div>;
}
function Panel({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="db-panel"><header><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</header>{children}</section>;
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="db-empty">{children}</p>;

function Dashboard() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [desk, setDesk] = useState<'all' | 'launch' | 'wallet'>('all');
  const [tab, setTabState] = useState<Tab>('overview');
  const setTab = (t: Tab) => { setTabState(t); history.replaceState(null, '', `#${t}`); };
  useEffect(() => {
    const h = location.hash.slice(1); if (TABS.some(([k]) => k === h)) setTabState(h as Tab);
    const load = () => fetch('/api/state').then(async (r) => (r.ok ? (setS(await r.json()), setErr('')) : setErr(`The server answered ${r.status}.`))).catch(() => setErr('Can’t reach the server.'));
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  if (!s) return <main className="app db"><TopBar /><h1>Dashboard</h1><p className="muted">{err || 'Loading…'}</p></main>;

  const lr = s.launchpad.rules;
  // Old test launches whose name or ticker the desk would now refuse stay in the DB but are not shown.
  const blocked = (l: Launch) => s.launchpad.blocked_tickers.includes(l.params.symbol.toUpperCase()) || s.launchpad.blocked_names.some((n) => `${l.params.name} ${l.params.symbol}`.toLowerCase().includes(n));
  const launches = s.launches.filter((l) => !blocked(l));
  // Only the wallet and launch desks exist; older records from other desks may still sit in the store and are skipped.
  const known = (d?: string) => !d || d === 'wallet' || d === 'launch';
  const calls = s.calls.filter((c) => known(c.desk) && c.channel !== ('dashboard' as string) && (desk === 'all' || (c.desk ?? 'wallet') === desk));
  const ledger = s.ledger.filter((l) => known(l.desk) && l.kind in KIND && (desk === 'all' || l.desk === desk));
  const refused = s.ledger.filter((l) => known(l.desk) && (l.kind === 'refused' || l.kind === 'filtered'));
  const call = calls.find((c) => c.id === open) ?? calls[0];
  const signed = call ? call.turns.filter((t) => t.who === 'agent' && t.proof?.status === 'verified').length : 0;
  const agentTurns = call ? call.turns.filter((t) => t.who === 'agent' && t.proof).length : 0;
  const access = s.access ?? [];
  const live = calls.filter((c) => !c.endedAt).length;
  const attOk = s.attestation.filter((a) => !('error' in a) && a.intel.verified && a.quoteBindsKey && a.gpu.verified).length;
  const who = (c: Call) => c.caller?.name ?? (c.channel === 'whatsapp' ? `+${c.from ?? ''}` : 'Browser');

  const callList = (n: number) => calls.length ? (
    <ul className="db-list">{calls.slice(0, n).map((c) => (
      <li key={c.id}><button className={c.id === call?.id ? 'on' : ''} onClick={() => { setOpen(c.id); setTab('calls'); }}>
        <span className={`dot ${c.endedAt ? '' : 'live'}`} /><span className="t">{time(c.startedAt)}</span><span className="w">{who(c)}</span>
        <span className="m">{c.channel === 'whatsapp' ? 'WhatsApp' : 'Browser'} · {c.endedAt ? `${c.turns.length} turns` : 'live'}</span>
      </button></li>
    ))}</ul>
  ) : <Empty>No calls yet. Ring the line and the transcript shows up here as it happens.</Empty>;

  const accessList = (n: number) => access.length ? (
    <ul className="db-list">{access.slice(0, n).map((r) => <li key={r.phone}><div className="row"><span className="w">+{r.phone}</span><span className="m">{r.name || '—'} · {time(r.at)}</span></div></li>)}</ul>
  ) : <Empty>No requests yet. Judges ask at /whatsapp.</Empty>;

  return (
    <>
    <main className="app db">
      <TopBar><span className="pill wait">Owner · NEAR {s.network}</span></TopBar>
      <div className="db-head">
        <h1>Dashboard</h1>
        <div className="seg" role="radiogroup" aria-label="Filter by desk">
          {(['all', 'wallet', 'launch'] as const).map((k) => <button key={k} role="radio" aria-checked={desk === k} className={desk === k ? 'on' : ''} onClick={() => setDesk(k)}>{k === 'all' ? 'All desks' : k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
      </div>
      {err && <p className="refused">{err}</p>}
      <nav className="db-tabs" role="tablist" aria-label="Sections">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}{k === 'access' && access.length ? <b>{access.length}</b> : null}{k === 'calls' && live ? <b className="live">{live}</b> : null}</button>)}
      </nav>

      {tab === 'overview' && (<>
        <div className="db-stats">
          <Stat label="Calls" value={calls.length} note={`${live} live now`} />
          <Stat label="WhatsApp requests" value={access.length} note="add in Meta, 5 max" />
          <Stat label="Refused or filtered" value={refused.length} note={`last ${s.ledger.length} ledger lines`} tone="warn" />
          <Stat label="Models verified" value={`${attOk}/${s.attestation.length}`} note="TEE, fresh nonce" tone="ok" />
        </div>
        <div className="db-two">
          <Panel title="Recent calls" action={<button className="db-link" onClick={() => setTab('calls')}>All calls</button>}>{callList(6)}</Panel>
          <Panel title="WhatsApp access" action={<button className="db-link" onClick={() => setTab('access')}>All requests</button>}>{accessList(6)}</Panel>
        </div>
      </>)}

      {tab === 'calls' && (
        <div className="db-split">
          <Panel title={`Calls (${calls.length})`}>{callList(50)}</Panel>
          <Panel title={call ? `${who(call)} · ${time(call.startedAt)}` : 'Transcript'} note={call ? `${call.channel === 'whatsapp' ? 'WhatsApp' : 'Browser'}${call.desk ? ` · ${call.desk} desk` : ''}${agentTurns ? ` · ${signed} of ${agentTurns} replies TEE-signed` : ''}${call.endedAt ? '' : ' · live'}` : undefined}>
            {call ? (
              <div className="transcript">
                {call.turns.map((t, i) => (
                  <div key={i} className={`bubble ${t.who}`}>{t.text.replace(/data:image\/\w+;base64,[A-Za-z0-9+/=]+/g, '<image>')}{t.who === 'agent' && <Signed proof={t.proof} />}{t.timing && <div className="muted" style={{ fontSize: 12 }}>stt {ms(t.timing.sttMs)} · first token {ms(t.timing.firstTokenMs)} · first audio {ms(t.timing.firstAudioMs)} · total {ms(t.timing.totalMs)}</div>}</div>
                ))}
              </div>
            ) : <Empty>Pick a call.</Empty>}
          </Panel>
        </div>
      )}

      {tab === 'access' && (
        <Panel title={`WhatsApp access requests (${access.length})`} note='Add each number in Meta: WhatsApp → API Setup → "To" → Manage phone numbers. The test line takes 5 at most.'>{accessList(200)}</Panel>
      )}

      {tab === 'launches' && (
        <Panel title={`Launches (${launches.length})`} note="Prepared by the desk, signed by the caller">
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
          ) : <Empty>No launches yet.</Empty>}
        </Panel>
      )}

      {tab === 'ledger' && (
        <Panel title="Ledger" note="Every refusal, launch and wallet action">
          {ledger.length ? (
            <div className="scroll"><table className="ledger"><tbody>{ledger.slice(0, 100).map((l, i) => (
              <tr key={i}><td>{time(l.at)}</td><td><span className={`pill ${l.kind === 'refused' || l.kind === 'filtered' ? 'warn' : l.kind === 'launch_signed' ? 'ok' : ''}`}>{KIND[l.kind] ?? l.kind}</span><span className="sub">{l.desk ?? ''}</span></td><td>{l.detail}</td></tr>
            ))}</tbody></table></div>
          ) : <Empty>Nothing yet.</Empty>}
        </Panel>
      )}

      {tab === 'rules' && (
        <div className="db-two">
          <Panel title="Launch rules" note="From launchpad.yaml, checked in code. Spending limits live in each phone-wallet contract.">
            <div className="rules">
              <div className="row"><span>Launch kill switch</span>{lr.kill_switch ? <span className="pill warn">On: no launches</span> : <b>Off</b>}</div>
              <div className="row"><span>Ticker</span><b>{lr.ticker_min}–{lr.ticker_max} of A–Z, 0–9</b></div>
              <div className="row"><span>Blocked</span><b>{s.launchpad.blocked_tickers.length} tickers, {s.launchpad.blocked_names.length} names</b></div>
            </div>
          </Panel>
          <Panel title="Private inference" note="Fresh nonce: Intel TDX, key in report, NVIDIA NRAS." action={<a className="db-link" href="/proof">Public proof</a>}>
            <div className="att">{s.attestation.map((a) => <AttRow key={a.model} a={a} />)}</div>
          </Panel>
        </div>
      )}
    </main>
    <SiteFooter />
    </>
  );
}
