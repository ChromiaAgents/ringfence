// The live panel: during a WhatsApp call the agent says a 6-digit code; typed here, it shows the links and the
// Approve card that WhatsApp could not deliver, the conversation so far, and a box to type instead of speaking.
// Polls /api/live/:code every 2 seconds. PINs show as dots; no phone number here. /live?c=123456 opens straight away.
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Makers, SiteFooter, Wordmark, TopBar } from '../ui';

type View = { state: 'live' | 'ended'; startedAt: number; links: { label: string; url: string }[]; approval: { body: string; id: string } | null; turns: { who: 'caller' | 'agent'; text: string }[] };

export const Route = createFileRoute('/live')({
  head: () => ({ meta: [{ title: 'Live panel · Ringfence' }, { name: 'robots', content: 'noindex' }] }),
  component: Live,
});

function Live() {
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [typeNote, setTypeNote] = useState('');
  const [open, setOpen] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const [now, setNow] = useState(Date.now());
  const seenLinks = useRef<Set<string>>(new Set());
  const loaded = useRef(false);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => { // /live?c=123456 opens straight away
    const c = new URLSearchParams(location.search).get('c')?.replace(/\D/g, '') ?? '';
    if (/^\d{6}$/.test(c)) { setCode(c); setOpen(c); }
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { // the newest link gets a "New" mark and a buzz on phones
    if (!view) return;
    const first = !loaded.current; loaded.current = true;
    for (const l of view.links) if (!seenLinks.current.has(l.url)) { seenLinks.current.add(l.url); if (!first) { setFresh(l.url); navigator.vibrate?.(80); } }
  }, [view?.links.length]);
  const talk = useRef<HTMLDivElement>(null);
  useEffect(() => { talk.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [view?.turns.length]);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const poll = async () => {
      const r = await fetch(`/api/live/${open}`, { cache: 'no-store' }).catch(() => null);
      if (stop) return;
      if (!r) return setErr('Can’t reach the server. Retrying…');
      if (r.status === 404) { setOpen(''); setView(null); return setErr('That code doesn’t work. Check the six digits from the call.'); }
      if (r.status === 429) return setErr('Too many tries. Wait a minute.');
      if (!r.ok) return setErr(`The server answered ${r.status}.`);
      setErr('');
      setView(await r.json());
    };
    poll();
    timer.current = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(timer.current); };
  }, [open]);
  useEffect(() => { if (view?.state === 'ended' && !view.approval) clearInterval(timer.current); }, [view]);

  async function tap(action: 'approve' | 'cancel' | 'reject') {
    if (!view?.approval || busy) return;
    setBusy(true);
    const r = await fetch(`/api/live/${open}/tap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: view.approval.id, action }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setNote(d?.message ?? d?.error ?? 'Something went wrong.');
    // Clear the card only when the tap landed (or the approval is gone: 409); on 429 or a network error keep it to tap again.
    if (r && (r.ok || r.status === 409)) setView((v) => (v ? { ...v, approval: null } : v));
    setBusy(false);
  }

  return (
    <>
    <main className="app pg live">
      <TopBar />
      <div className={open ? 'live-open' : 'pg-two'}>
      <div>
      <h1>Live panel</h1>
      {!open ? (
        <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code)) { setErr(''); setNote(''); setOpen(code); } }}>
          <p className="muted">On a WhatsApp call, when we can’t text you, the agent says a 6-digit code. Enter it to see your links and the Approve card.</p>
          <label htmlFor="live-code">Code from the call</label>
          <input id="live-code" className="live-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="000000"
            value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) { setErr(''); setNote(''); setOpen(v); } }} autoFocus />
          <p><button className="btn" type="submit" disabled={code.length !== 6}>Open</button></p>
        </form>
      ) : (
        <>
          <p className={`live-state ${view?.state === 'live' ? 'on' : ''}`}>{view?.state === 'ended' ? 'Call ended' : view ? <>On the call · {Math.floor((now - view.startedAt) / 60000)}:{String(Math.floor(((now - view.startedAt) % 60000) / 1000)).padStart(2, '0')} · code {open}</> : 'Connecting…'}</p>
          {[...(view?.links ?? [])].reverse().map((l) => (
            <div className={`signlink ${l.url === fresh ? 'fresh' : ''}`} key={l.url}><span>{l.url === fresh && <b className="new">New</b>}{l.label}</span><a className="btn small" href={l.url} target="_blank" rel="noreferrer">Open</a></div>
          ))}
          {view?.approval && (
            <div className="wa-card" role="dialog" aria-label="Approve this transfer">
              <p className="wa-from">Ringfence · live panel</p>
              <p className="wa-body">{view.approval.body}</p>
              <div className="wa-btns">
                <button type="button" disabled={busy} onClick={() => tap('approve')}>Approve</button>
                <button type="button" disabled={busy} onClick={() => tap('cancel')}>Cancel</button>
                <button type="button" disabled={busy} onClick={() => tap('reject')}>Not me</button>
              </div>
            </div>
          )}
          {note && <p className="live-note">{note}</p>}
          {view && !view.links.length && !view.approval && !note && view.state === 'live' && <p className="muted">Nothing yet. Links and Approve cards show up here while you talk.</p>}
          {!!view?.turns.length && (
            <div className="live-talk" ref={talk} aria-label="The conversation so far">
              {view.turns.map((t, i) => <p key={i} className={t.who}><b>{t.who === 'caller' ? 'You' : 'Ringfence'}</b>{t.text}</p>)}
            </div>
          )}
          {view?.state === 'live' && (
            <form className="live-type" onSubmit={async (e) => {
              e.preventDefault(); const text = typed.trim(); if (!text) return;
              setTypeNote('Sending…');
              const r = await fetch(`/api/live/${open}/type`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => null);
              if (r?.ok) { setTyped(''); setTypeNote(/^\s*\d{4}\s*$/.test(text) ? 'Sent (PIN hidden). Listen for the answer on the call.' : `Sent: "${text}". Listen for the answer on the call.`); } else setTypeNote('The call is not on any more.');
            }}>
              <label htmlFor="live-typed">Type instead of speaking</label>
              <div className="live-type-row">
                <input id="live-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="send 0.1 NEAR to liho00.near" autoComplete="off" maxLength={300} />
                <button className="btn" type="submit" disabled={!typed.trim()}>Send</button>
              </div>
              <p className="muted small">Account names, amounts, your PIN: typing them here is easier than saying them. The agent answers on the call.</p>
              {typeNote && <p className="muted small" role="status">{typeNote}</p>}
            </form>
          )}
          <p><button className="btn white small" type="button" onClick={() => { setOpen(''); setView(null); setCode(''); setNote(''); }}>Use another code</button></p>
        </>
      )}
      {err && <p className="live-err" role="alert">{err}</p>}
      </div>
      {!open && <aside className="pg-side" aria-labelledby="live-how">
        <h2 id="live-how">How it works</h2>
        <ol>
          <li>Call Ringfence on WhatsApp. Our test line <b>+1 555-144-4220</b> answers <a href="/whatsapp">numbers we have added</a>.</li>
          <li>When a link or the Approve card can’t reach you as a WhatsApp message, the agent says a 6-digit code.</li>
          <li>Enter it here. Your links and the Approve card show up while the call is on.</li>
        </ol>
        <p className="muted" style={{ marginTop: 16 }}>The PIN is never shown here, and the code stops working 10 minutes after the call. No WhatsApp? <a href="/#call">Try the browser call</a>.</p>
      </aside>}
      </div>
    </main>
    <SiteFooter />
    </>
  );
}
