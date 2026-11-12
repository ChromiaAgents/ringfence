// "Try it on WhatsApp": while Meta verification is pending, the test line only answers numbers added by hand.
// A visitor (a judge) leaves their WhatsApp number; the owner adds it in the Meta dashboard and they can call.
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Makers, SiteFooter, WaIcon, Wordmark, TopBar } from '../ui';

export const Route = createFileRoute('/whatsapp')({
  head: () => ({ meta: [{ title: 'Try it on WhatsApp · Ringfence' }] }),
  component: WhatsApp,
});

function WhatsApp() {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setState('busy');
    const r = await fetch('/api/whatsapp-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, name }) }).catch(() => null);
    if (r?.ok) return setState('done');
    setState('idle');
    setErr(r ? ((await r.json().catch(() => ({}))) as any).error ?? `The server answered ${r.status}.` : 'Can’t reach the server.');
  }

  return (
    <>
      <main className="app pg live">
        <TopBar />
        <div className="pg-two">
        <div>
        <h1><WaIcon size={34} />Try it on WhatsApp</h1>
        <p>Same agent, same NEAR limits, on a WhatsApp call.</p>
        <p className="muted">Test line <b>+1 555-144-4220</b> answers numbers we add. Public line <b>+60 11-7512 3486</b> opens after Meta verification.</p>
        {state === 'done' ? (
          <div className="signlink" role="status" style={{ marginTop: 24 }}>
            <span>Got it. We add you within a few hours, then WhatsApp-call <b>+1 555-144-4220</b>.</span>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 24 }}>
            <label htmlFor="wa-phone">Your WhatsApp number, with country code</label>
            <input id="wa-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+60 12 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <label htmlFor="wa-name">Your name (optional)</label>
            <input id="wa-name" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            <p className="muted" style={{ fontSize: 13 }}>Only used to add you to the test line.</p>
            <button className="btn" type="submit" disabled={state === 'busy' || phone.replace(/\D/g, '').length < 8}>{state === 'busy' ? 'Sending…' : 'Request access'}</button>
            {err && <p role="alert" className="refused">{err}</p>}
          </form>
        )}
        <p style={{ marginTop: 32 }}><a href="/#call">Or call from your browser now</a></p>
        </div>
        <aside className="pg-side" aria-labelledby="wa-try">
          <h2 id="wa-try">Try saying</h2>
          <ul>
            <li>"Is there a free money packet?" Then say its words.</li>
            <li>"Money packet, 0.02 NEAR, 5 people, words merry christmas."</li>
            <li>"Send 0.1 NEAR to liho00.near." Then the PIN.</li>
            <li>"Send 5 NEAR to stranger.near." Refused.</li>
            <li>"Launch a coin on JustHoot."</li>
            <li>"Top up my wallet with 2 dollars of SOL."</li>
          </ul>
          <p className="muted" style={{ marginTop: 16 }}>Link didn't arrive? The agent reads a code for <a href="/live">/live</a>.</p>
        </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
