// The live panel: during a WhatsApp call the agent says a 6-digit code; typed here, it shows the links and the
// Approve card that WhatsApp could not deliver. Polls /api/live/:code every 2 seconds. No transcript, PIN or phone here.
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Makers, SiteFooter, Wordmark } from '../ui';

type View = { state: 'live' | 'ended'; links: { label: string; url: string }[]; approval: { body: string; id: string } | null };

export const Route = createFileRoute('/live')({
  head: () => ({ meta: [{ title: 'Live panel · Ringfence' }, { name: 'robots', content: 'noindex' }] }),
  component: Live,
});

function Live() {
  const [code, setCode] = useState('');
  const [open, setOpen] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

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
      <div className="brandrow"><Wordmark /><Makers /></div>
      <div className="pg-two">
      <div>
      <h1>Live panel</h1>
      {!open ? (
        <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code)) { setErr(''); setNote(''); setOpen(code); } }}>
          <p className="muted">On a WhatsApp call, when we can’t text you, the agent says a 6-digit code. Enter it to see your links and the Approve card.</p>
          <label htmlFor="live-code">Code from the call</label>
          <input id="live-code" className="live-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="000000"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
          <p><button className="btn" type="submit" disabled={code.length !== 6}>Open</button></p>
        </form>
      ) : (
        <>
          <p className="muted">{view?.state === 'ended' ? 'Call ended.' : view ? 'On the call. This page updates by itself.' : 'Connecting…'}</p>
          {view?.links.map((l) => (
            <div className="signlink" key={l.url}><span>{l.label}</span><a className="btn small" href={l.url} target="_blank" rel="noreferrer">Open</a></div>
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
          <p><button className="btn white small" type="button" onClick={() => { setOpen(''); setView(null); setCode(''); setNote(''); }}>Use another code</button></p>
        </>
      )}
      {err && <p className="live-err" role="alert">{err}</p>}
      </div>
      <aside className="pg-side" aria-labelledby="live-how">
        <h2 id="live-how">How it works</h2>
        <ol>
          <li>Call Ringfence on WhatsApp. Our test line <b>+1 555-144-4220</b> answers <a href="/whatsapp">numbers we have added</a>.</li>
          <li>When a link or the Approve card can’t reach you as a WhatsApp message, the agent says a 6-digit code.</li>
          <li>Enter it here. Your links and the Approve card show up while the call is on.</li>
        </ol>
        <p className="muted" style={{ marginTop: 16 }}>The PIN is never shown here, and the code stops working 10 minutes after the call. No WhatsApp? <a href="/#call">Try the browser call</a>.</p>
      </aside>
      </div>
    </main>
    <SiteFooter />
    </>
  );
}
