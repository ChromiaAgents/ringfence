import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import walletCss from '../styles/wallet-modal.css?url';
import { Makers, SiteFooter, Wordmark } from '../ui';
import { useNearWallet } from '../near-wallet';

const getCfg = createServerFn({ method: 'GET' }).handler(async () => {
  const { env } = await import('../../src/config.ts');
  const { net } = await import('../../src/memecook.ts');
  return { network: env.network, defaults: env.walletDefaults, factory: env.factoryAccountId, small: env.smallLimitNear, rpc: net(env.network).rpc, waNumber: env.waNumber };
});

export const Route = createFileRoute('/wallet/bind')({
  loader: () => getCfg(),
  head: () => ({ meta: [{ title: 'Bind your wallet · Ringfence' }], links: [{ rel: 'stylesheet', href: walletCss }] }),
  component: Bind,
});

type Tx = { receiverId: string; method: string; deposit: string; args: Record<string, any> & { owner: string; agent: string | null; phone_hash: string } };

function Bind() {
  const cfg = Route.useLoaderData();
  const sfx = cfg.network === 'mainnet' ? 'near' : 'testnet';
  const explorer = cfg.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  const w = useNearWallet(`Connect the NEAR ${cfg.network} account that will own the phone wallet.`, cfg.network);
  const [lim, setLim] = useState(cfg.defaults);
  const [guardian, setGuardian] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [sent, setSent] = useState('');
  const [tx, setTx] = useState<Tx | null>(null);
  const [hash, setHash] = useState('');
  const [wallet, setWallet] = useState('');
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
      const { parseNearAmount } = await import('near-api-js');
      const y = (n: string) => parseNearAmount(n as `${number}`)!;
      // The limits as edited here; the contract takes them at create and only the owner can change them later.
      const args = { ...tx.args, near_limit: { per_tx: y(lim.nearPerTx), per_day: y(lim.nearPerDay) }, new_recipient_delay_sec: Number(lim.delaySec) };
      const h = await w.send(tx.receiverId, (ac) => [ac.functionCall(tx.method, args, 100_000_000_000_000n, BigInt(tx.deposit))]);
      if (h) { setHash(h); setWallet(await walletOf(tx.args.phone_hash)); }
    } catch (e: any) { w.setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  }
  // The address comes from the factory after signing, never from a guess shown before (a guess could be someone else's).
  async function walletOf(phoneHash: string): Promise<string> {
    const args = btoa(JSON.stringify({ phone_hash: phoneHash }));
    const r = await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: cfg.factory, method_name: 'get_wallet', args_base64: args } }) }).then((x) => x.json()).catch(() => null);
    const bytes = r?.result?.result;
    return bytes ? JSON.parse(String.fromCharCode(...bytes)) ?? '' : '';
  }
  const who = guardian ? 'your family member' : 'you';

  return (
    <>
    <main className="app pay">
      <div className="brandrow"><Wordmark /><Makers /><span className="pill wait">NEAR {cfg.network}</span></div>
      <h1>Your phone number is a wallet</h1>
      <p className="err" role="note"><b>Unaudited prototype: keep small amounts.</b> The phone-wallet contract has not been audited.{cfg.network === 'mainnet' ? ' This is NEAR mainnet: real money.' : ''}</p>

      <p className="muted">Mum can make a phone call; she doesn't need to know MetaMask. Bind a NEAR wallet to a WhatsApp number, then on a call say “send 0.1 NEAR to liho.{sfx}”. Up to {cfg.small} NEAR is confirmed with a spoken PIN; more needs an Approve tap on WhatsApp. The contract checks the limits before anything moves, and the owner can withdraw or revoke at any time.</p>

      <section className="card">
        <h2>Who is it for?</h2>
        <label><input type="radio" checked={!guardian} onChange={() => setGuardian(false)} /> Me: my wallet, my WhatsApp</label><br />
        <label><input type="radio" checked={guardian} onChange={() => setGuardian(true)} /> Set up for someone else: my wallet owns it, their WhatsApp makes the calls</label>
        {guardian && <p className="muted small">You (the guardian) own the wallet and can withdraw or revoke at any time. The code goes to your family member's phone and names your account; they pass it to you only because they know you.</p>}
      </section>

      <section className="card">
        <h2>1. {guardian ? 'Connect your (the guardian’s) NEAR wallet' : 'Connect your NEAR wallet'}</h2>
        {w.account ? <p className="muted">Connected as <b>{w.account}</b> · <button className="linkish" onClick={w.connect}>switch</button></p> : <button className="btn ink" onClick={w.connect}>Connect your NEAR wallet</button>}
        <p className="muted small">No wallet? <a href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer">Create one in Meteor (1 min)</a>, then come back and connect it. No wallet at all? Text “create a wallet” to {cfg.waNumber ? <a href={`https://wa.me/${cfg.waNumber}?text=create%20a%20wallet`} target="_blank" rel="noreferrer">+{cfg.waNumber} on WhatsApp</a> : 'our WhatsApp number'} for a demo custodial wallet you can claim later.</p>
      </section>

      <section className="card">
        <h2>2. {guardian ? 'Their WhatsApp number' : 'Your WhatsApp number'}</h2>
        <label className="field-label" htmlFor="ph">Number with country code</label>
        <input id="ph" className="control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123" autoComplete="tel" />
        <button className="btn white small" disabled={!phone || !w.account} onClick={async () => { const d = await post('/api/wallet/code', { phone, purpose: 'bind', owner: w.account }); if (d) setSent(d.sent ? `Code sent on WhatsApp to ${who}.` : d.note); }}>Send a code to {guardian ? 'their' : 'my'} WhatsApp</button>
        {sent && <p className="muted small">{sent}</p>}
      </section>

      <section className="card">
        <h2>3. Code and a 4-digit PIN</h2>
        <label className="field-label" htmlFor="cd">6-digit code{guardian ? ' (from their phone)' : ''}</label>
        <input id="cd" className="control" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
        <label className="field-label" htmlFor="pn">PIN {who} will say on calls</label>
        <input id="pn" className="control" type="password" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={4} />
        <p className="muted small">We keep only a salted hash of the PIN. Three wrong tries lock the wallet for 15 minutes.</p>
        <button className="btn ink small" disabled={!w.account || code.length !== 6 || pin.length !== 4} onClick={async () => { const d = await post('/api/wallet/bind', { phone, code, pin, owner: w.account }); if (d) setTx(d); }}>Bind</button>
      </section>

      {tx && (
        <section className="card">
          <h2>4. Sign: create the phone wallet</h2>
          <div className="rows">
            <div className="row"><span>New wallet account</span><b>shown after you sign</b></div>
            <div className="row"><span>Created by</span><b className="mono">{tx.receiverId}</b></div>
            <div className="row"><span>Attach (storage; any excess is refunded)</span><b>0.013 NEAR</b></div>
            <div className="row"><span>Owner: full control, withdraw any time</span><b className="mono">{tx.args.owner}</b></div>
            <div className="row"><span>Agent: may spend within limits only</span><b className="mono">{tx.args.agent ?? 'the factory default'}</b></div>
          </div>
          <h3>Limits (change them before you sign)</h3>
          {([['nearPerTx', 'NEAR per transfer'], ['nearPerDay', 'NEAR per day'], ['delaySec', 'New-recipient delay, seconds']] as const).map(([k, label]) => (
            <div key={k}><label className="field-label" htmlFor={k}>{label}</label>
              <input id={k} className="control" inputMode="decimal" value={String(lim[k])} onChange={(e) => setLim({ ...lim, [k]: k === 'delaySec' ? Number(e.target.value) || 0 : e.target.value })} /></div>))}
          <p className="explain">One function call from your account: {tx.receiverId}.create_wallet. Works in any NEAR wallet, including Meteor and implicit accounts. Nothing runs until you sign. The new wallet's address appears here after.</p>
          {hash ? <p>Done. <a href={`${explorer}/txns/${hash}`} target="_blank" rel="noreferrer">See the transaction</a>. {wallet ? <>Your wallet is <b className="mono">{wallet}</b>. Fund it, then call</> : 'The wallet address is not readable yet: check the transaction for it before you fund anything. Then call'} and say “send 0.1 NEAR to liho.{sfx}”.</p>
            : <button className="btn green" onClick={sign} disabled={busy}>{busy ? 'Waiting for your wallet…' : 'Sign and create'}</button>}
          <details className="txdetails"><summary>Call arguments</summary><pre>{JSON.stringify(tx.args, null, 1)}</pre></details>
        </section>
      )}
      {w.err && <p className="err" role="alert">{w.err}</p>}
    </main>
    <SiteFooter />
    </>
  );
}
