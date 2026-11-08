// Over the agent's limits or to a new recipient: the caller signs the transfer in their own wallet instead.
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import walletCss from '../styles/wallet-modal.css?url';
import { Makers, SiteFooter, Wordmark } from '../ui';
import { useNearWallet } from '../near-wallet';

const getNet = createServerFn({ method: 'GET' }).handler(async () => ({ network: (await import('../../src/config.ts')).env.network }));

export const Route = createFileRoute('/wallet/send')({
  loader: () => getNet(),
  validateSearch: (s: Record<string, unknown>) => ({ to: String(s.to ?? ''), amount: String(s.amount ?? '') }),
  head: () => ({ meta: [{ title: 'Sign a transfer · Ringfence' }], links: [{ rel: 'stylesheet', href: walletCss }] }),
  component: Send,
});

function Send() {
  const { to, amount } = Route.useSearch();
  const cfg = Route.useLoaderData();
  const w = useNearWallet(`Connect your NEAR ${cfg.network} account to sign this transfer.`, cfg.network);
  const [hash, setHash] = useState('');
  const ok = /^[a-z0-9._-]{2,64}$/.test(to) && /^\d+(\.\d+)?$/.test(amount);
  async function sign() {
    try {
      const { parseNearAmount } = await import('near-api-js');
      const h = await w.send(to, (ac) => [ac.transfer(BigInt(parseNearAmount(amount as `${number}`)!))]);
      if (h) setHash(h);
    } catch (e: any) { w.setErr(e?.message ?? String(e)); }
  }
  return (
    <>
    <main className="app pay">
      <div className="brandrow"><Wordmark /><Makers /><span className="pill wait">NEAR {cfg.network}</span></div>
      <p className="err" role="note"><b>Unaudited prototype: keep small amounts.</b> The phone-wallet contract has not been audited.{cfg.network === 'mainnet' ? ' This is NEAR mainnet: real money.' : ''}</p>

      <h1>{ok ? `Send ${amount} NEAR to ${to}` : 'This link is not valid'}</h1>
      <p className="muted">The agent can’t send this one. It’s over your limits or to a new recipient, so you sign it yourself from your own account.</p>
      {ok && <div className="card rules">
        <div className="row"><span>Amount</span><b>{amount} NEAR</b></div>
        <div className="row"><span>To</span><b>{to}</b></div>
        <div className="row"><span>From</span><b>{w.account ?? 'your wallet, once connected'}</b></div>
        <div className="row"><span>Network</span><b>NEAR {cfg.network}</b></div>
        <div className="row"><span>Who signs</span><b>you, not the agent</b></div>
      </div>}
      {ok && (hash ? <p>Sent. <a href={`${cfg.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'}/txns/${hash}`} target="_blank" rel="noreferrer">See the transaction</a></p>
        : !w.account ? <button className="btn ink" onClick={w.connect}>Connect a wallet</button>
        : <button className="btn green" onClick={sign}>Sign as {w.account}</button>)}
      {w.err && <p className="err" role="alert">{w.err}</p>}
    </main>
    <SiteFooter />
    </>
  );
}
