// Claim a demo custodial wallet (made in WhatsApp chat) to your own NEAR account: code to the bound phone, custody
// proposes you as owner, you sign accept_owner. After that the custody key has no say over it.
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import walletCss from '../styles/wallet-modal.css?url';
import { Makers, SiteFooter, Wordmark } from '../ui';
import { useNearWallet } from '../near-wallet';

const getNet = createServerFn({ method: 'GET' }).handler(async () => ({ network: (await import('../../src/config.ts')).env.network }));

export const Route = createFileRoute('/wallet/claim')({
  loader: () => getNet(),
  head: () => ({ meta: [{ title: 'Claim your wallet · Ringfence' }], links: [{ rel: 'stylesheet', href: walletCss }] }),
  component: Claim,
});

function Claim() {
  const cfg = Route.useLoaderData();
  const w = useNearWallet(`Connect the NEAR ${cfg.network} account that will own your phone wallet.`, cfg.network);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState('');
  const [claim, setClaim] = useState<{ receiverId: string; dryRun: boolean } | null>(null);
  const [done, setDone] = useState('');
  const post = async (url: string, body: object) => {
    w.setErr('');
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({ error: 'Something went wrong' }));
    if (!r.ok) w.setErr(d.error);
    return r.ok ? d : null;
  };
  async function accept() {
    if (!claim) return;
    try {
      if (await w.send(claim.receiverId, (ac) => [ac.functionCall('accept_owner', {}, 30_000_000_000_000n, 0n)])) {
        const d = await post('/api/wallet/claim', { action: 'done', phone });
        if (d) setDone(d.owner);
      }
    } catch (e: any) { w.setErr(e?.message ?? String(e)); }
  }
  return (
    <>
    <main className="app pay">
      <div className="brandrow"><Wordmark /><Makers /><span className="pill wait">NEAR {cfg.network}</span></div>
      <h1>Claim your phone wallet</h1>
      <p className="err" role="note"><b>Unaudited prototype: keep small amounts.</b> Until you claim it, your demo wallet is custodial: Ringfence holds the owner key.</p>
      <p className="muted">Made a wallet in WhatsApp chat? Move ownership to your own NEAR account. The agent keeps the same limits; as the owner you can change them, withdraw, or revoke the agent.</p>

      <section className="card">
        <h2>1. Connect your NEAR wallet</h2>
        {w.account ? <p className="muted">Connected as <b>{w.account}</b> · <button className="linkish" onClick={w.connect}>switch</button></p> : <button className="btn ink" onClick={w.connect}>Connect your NEAR wallet</button>}
        <p className="muted small">No wallet? <a href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer">Create one in Meteor (1 min)</a>.</p>
      </section>

      <section className="card">
        <h2>2. Prove you hold the WhatsApp number</h2>
        <label className="field-label" htmlFor="ph">Number with country code</label>
        <input id="ph" className="control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123" autoComplete="tel" />
        <button className="btn white small" disabled={!phone || !w.account} onClick={async () => { const d = await post('/api/wallet/code', { phone, purpose: 'claim', owner: w.account }); if (d) setSent(d.sent ? 'Code sent on WhatsApp.' : d.note); }}>Send me a code</button>
        <p className="muted small">The code gives ownership of the wallet to {w.account || 'your connected account'}. Never read it out to anyone or type it on a page someone sent you.</p>
        {sent && <p className="muted small">{sent}</p>}
        <label className="field-label" htmlFor="cd">6-digit code</label>
        <input id="cd" className="control" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
        <button className="btn ink small" disabled={!w.account || code.length !== 6} onClick={async () => { const d = await post('/api/wallet/claim', { phone, code, owner: w.account }); if (d) setClaim(d); }}>Claim</button>
      </section>

      {claim && (
        <section className="card">
          <h2>3. Sign: accept ownership</h2>
          {claim.dryRun && <p className="err">DRY RUN: this server has no custody key, so no owner change was proposed on chain. Signing would fail.</p>}
          <p className="muted">Ringfence proposed <b>{w.account}</b> as the owner of <b className="mono">{claim.receiverId}</b>. Demo custodial wallets wait 24 hours after this before you can accept, so a stolen code can be noticed. Then sign accept_owner to finish.</p>
          {done ? <p>Done. {claim.receiverId} is now owned by <b>{done}</b>. The custody key has no control over it any more.</p>
            : <button className="btn green" onClick={accept}>Sign accept_owner</button>}
        </section>
      )}
      {w.err && <p className="err" role="alert">{w.err}</p>}
    </main>
    <SiteFooter />
    </>
  );
}
