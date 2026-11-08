// Over the agent's limits or to a new recipient: the caller signs the transfer in their own wallet instead.
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import walletCss from '@near-wallet-selector/modal-ui/styles.css?url';
import { Wordmark } from '../ui';
import { useNearWallet } from '../near-wallet';

export const Route = createFileRoute('/wallet/send')({
  validateSearch: (s: Record<string, unknown>) => ({ to: String(s.to ?? ''), amount: String(s.amount ?? '') }),
  head: () => ({ meta: [{ title: 'Sign a transfer · callhand' }], links: [{ rel: 'stylesheet', href: walletCss }] }),
  component: Send,
});

function Send() {
  const { to, amount } = Route.useSearch();
  const w = useNearWallet('Connect your NEAR testnet account to sign this transfer.');
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
    <main className="app pay">
      <div className="brandrow"><Wordmark /><span className="pill wait">NEAR testnet</span></div>
      <h1>{ok ? `Send ${amount} NEAR to ${to}` : 'This link is not valid'}</h1>
      <p className="muted">The agent can't send this one (over your limits, or a new recipient), so you sign it yourself, from your own account.</p>
      {ok && (hash ? <p>Sent. <a href={`https://testnet.nearblocks.io/txns/${hash}`} target="_blank" rel="noreferrer">See the transaction</a></p>
        : !w.account ? <button className="btn ink" onClick={w.connect}>Connect a wallet</button>
        : <button className="btn green" onClick={sign}>Sign as {w.account}</button>)}
      {w.err && <p className="err" role="alert">{w.err}</p>}
    </main>
  );
}
