// "Try it on WhatsApp": while Meta verification is pending, the test line only answers numbers added by hand.
// A visitor (a judge) leaves their WhatsApp number; the owner adds it in the Meta dashboard and they can call.
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Makers, SiteFooter, WaIcon, Wordmark } from '../ui';

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
      <main className="app canvas live" style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
        <div className="brandrow" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}><Wordmark /><Makers /></div>
        <h1 style={{ marginTop: 32 }}><WaIcon size={34} />Try it on WhatsApp</h1>
        <p>Ringfence works on a WhatsApp call: same agent, same NEAR contract limits as the browser call.</p>
        <p className="muted">Our public number <b>+60 11-7512 3486</b> opens when Meta finishes verifying our business. Until then the test line <b>+1 555-144-4220</b> only answers numbers we add by hand.</p>
        {state === 'done' ? (
          <div className="signlink" role="status" style={{ marginTop: 24 }}>
            <span>Thanks. We will add your number within a few hours. Then WhatsApp-call <b>+1 555-144-4220</b>. If a link or the Approve card can’t reach you on WhatsApp, the agent gives you a code for <a href="/live">the live panel</a>.</span>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 24 }}>
            <label htmlFor="wa-phone">Your WhatsApp number, with country code</label>
            <input id="wa-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+60 12 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <label htmlFor="wa-name">Your name (optional)</label>
            <input id="wa-name" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            <p className="muted" style={{ fontSize: 13 }}>We use your number only to add it to our WhatsApp test line for this hackathon demo.</p>
            <button className="btn" type="submit" disabled={state === 'busy' || phone.replace(/\D/g, '').length < 8}>{state === 'busy' ? 'Sending…' : 'Request access'}</button>
            {err && <p role="alert" className="refused">{err}</p>}
          </form>
        )}
        <p style={{ marginTop: 32 }}><a href="/#call">Or try it in your browser now</a>: no phone needed.</p>
      </main>
      <SiteFooter />
    </>
  );
}
