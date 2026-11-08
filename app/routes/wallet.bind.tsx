import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import walletCss from '@near-wallet-selector/modal-ui/styles.css?url';
import { Wordmark } from '../ui';
import { useNearWallet } from '../near-wallet';

export const Route = createFileRoute('/wallet/bind')({
  head: () => ({ meta: [{ title: 'Bind your wallet · callhand' }], links: [{ rel: 'stylesheet', href: walletCss }] }),
  component: Bind,
});

type Tx = { receiverId: string; deposit: string; init: { owner: string; agent: string; phone_hash: string; signer: string } };

function Bind() {
  const w = useNearWallet('Connect the NEAR testnet account that will own your phone wallet.');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [sent, setSent] = useState('');
  const [tx, setTx] = useState<Tx | null>(null);
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async (url: string, body: object) => {
    w.setErr('');
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({ error: 'Something went wrong' }));
    if (!r.ok) w.setErr(d.error);
    return r.ok ? d : null;
  };
  async function sign() {
    if (!tx) return;
    setBusy(true);
    try {
      const code = new Uint8Array(await (await fetch('/phone_wallet.wasm')).arrayBuffer());
      const { parseNearAmount } = await import('near-api-js');
      const h = await w.send(tx.receiverId, (ac) => [
        ac.createAccount(), ac.transfer(BigInt(parseNearAmount(tx.deposit as `${number}`)!)), ac.deployContract(code),
        ac.functionCall('new', tx.init, 100_000_000_000_000n, 0n),
      ]);
      if (h) setHash(h);
    } catch (e: any) { w.setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  }

  return (
    <main className="app pay">
      <div className="brandrow"><Wordmark /><span className="pill wait">NEAR testnet</span></div>
      <h1>Your phone number is a wallet</h1>
      <p className="muted">Bind your NEAR account to your WhatsApp number. Then on a call say “send 1 NEAR to bob.testnet”, confirm with your PIN, and it goes through within limits a contract enforces, not the AI.</p>

      <section className="card">
        <h2>1. Connect your NEAR wallet</h2>
        {w.account ? <p className="muted">Connected as <b>{w.account}</b> · <button className="linkish" onClick={w.connect}>switch</button></p> : <button className="btn ink" onClick={w.connect}>Connect a wallet</button>}
      </section>

      <section className="card">
        <h2>2. Your WhatsApp number</h2>
        <label className="field-label" htmlFor="ph">Number with country code</label>
        <input id="ph" className="control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123" autoComplete="tel" />
        <button className="btn white small" disabled={!phone} onClick={async () => { const d = await post('/api/wallet/code', { phone }); if (d) setSent(d.sent ? 'Code sent on WhatsApp.' : d.note); }}>Send me a code</button>
        {sent && <p className="muted small">{sent}</p>}
      </section>

      <section className="card">
        <h2>3. Code and a 4-digit PIN</h2>
        <label className="field-label" htmlFor="cd">6-digit code</label>
        <input id="cd" className="control" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
        <label className="field-label" htmlFor="pn">PIN you'll say on calls</label>
        <input id="pn" className="control" type="password" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={4} />
        <p className="muted small">We keep only a salted hash of the PIN. Three wrong tries lock the wallet for 15 minutes.</p>
        <button className="btn ink small" disabled={!w.account || code.length !== 6 || pin.length !== 4} onClick={async () => { const d = await post('/api/wallet/bind', { phone, code, pin, owner: w.account }); if (d) setTx(d); }}>Bind</button>
      </section>

      {tx && (
        <section className="card">
          <h2>4. Sign: create your phone wallet</h2>
          <div className="rows">
            <div className="row"><span>New account (yours, a sub-account)</span><b className="mono">{tx.receiverId}</b></div>
            <div className="row"><span>Fund it with</span><b>{tx.deposit} NEAR</b></div>
            <div className="row"><span>Owner: full control, withdraw any time</span><b className="mono">{tx.init.owner}</b></div>
            <div className="row"><span>Agent: may spend within limits only</span><b className="mono">{tx.init.agent}</b></div>
            <div className="row"><span>Default limits</span><b>5 NEAR per transfer, 10 per day; 0.01 Sepolia ETH, 0.02 per day</b></div>
            <div className="row"><span>New recipients</span><b>wait 10 minutes; you can cancel</b></div>
          </div>
          <p className="explain">One transaction from your account: create account, transfer, deploy contract, call new. Nothing runs until you sign it in your wallet.</p>
          {hash ? <p>Done. <a href={`https://testnet.nearblocks.io/txns/${hash}`} target="_blank" rel="noreferrer">See the transaction</a>. Call and say “send 1 NEAR to …”.</p>
            : <button className="btn green" onClick={sign} disabled={busy}>{busy ? 'Waiting for your wallet…' : 'Sign and create'}</button>}
          <details className="txdetails"><summary>Init arguments</summary><pre>{JSON.stringify(tx.init, null, 1)}</pre></details>
        </section>
      )}
      {w.err && <p className="err" role="alert">{w.err}</p>}
    </main>
  );
}
