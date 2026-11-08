import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Wordmark, usd } from '../ui';

export const Route = createFileRoute('/pay/$jobId')({
  head: () => ({ meta: [{ title: 'Pay your deposit · Ringfence' }] }),
  component: Pay,
});

type Token = { assetId: string; blockchain: string; symbol: string };
type Job = {
  id: string; business: string; service: string; quotedUsd: number; depositUsd: number; name: string; payout: string;
  payment: null | { status: string; originSymbol: string; chain: string; quote: { depositAddress?: string; depositMemo?: string; amountInFormatted: string; deadline?: string } };
};

const NICE: Record<string, string> = {
  PENDING_DEPOSIT: 'Waiting for your deposit', KNOWN_DEPOSIT_TX: 'Deposit seen, swapping', PROCESSING: 'Swapping',
  SUCCESS: 'Paid. The builder has your deposit.', INCOMPLETE_DEPOSIT: 'Deposit too small: top up or wait for the refund',
  REFUNDED: 'Refunded to you', FAILED: 'Failed, refund on its way',
};
const STEPS = [['PENDING_DEPOSIT', 'Send'], ['KNOWN_DEPOSIT_TX', 'Seen'], ['PROCESSING', 'Swapping'], ['SUCCESS', 'Paid']] as const;
const CHAINS = ['near', 'base', 'eth', 'arb', 'sol', 'bsc', 'pol', 'op', 'btc'];
const PREF = ['USDC', 'USDT', 'ETH', 'SOL', 'wNEAR', 'BTC', 'ZEC'];

function Pay() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [missing, setMissing] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [asset, setAsset] = useState('');
  const [refund, setRefund] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');

  useEffect(() => {
    fetch(`/api/pay/${jobId}`).then(async (r) => (r.ok ? setJob(await r.json()) : setMissing(true)));
    fetch('/api/tokens').then((r) => r.json()).then((t: Token[]) => {
      t.sort((a, b) => (PREF.indexOf(a.symbol) + 1 || 99) - (PREF.indexOf(b.symbol) + 1 || 99) || (CHAINS.indexOf(a.blockchain) + 1 || 99) - (CHAINS.indexOf(b.blockchain) + 1 || 99) || a.blockchain.localeCompare(b.blockchain));
      setTokens(t); setAsset(t[0]?.assetId ?? '');
    }).catch(() => setErr('Could not load the token list from 1Click. Refresh to try again.'));
    const i = setInterval(() => fetch(`/api/pay/${jobId}/status`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setJob(d)).catch(() => {}), 5000);
    return () => clearInterval(i);
  }, [jobId]);

  const addr = job?.payment?.quote.depositAddress;
  useEffect(() => {
    if (addr) fetch('/api/qr?text=' + encodeURIComponent(addr)).then((r) => r.text()).then(setQr);
  }, [addr]);

  async function quote() {
    setErr(''); setBusy(true);
    const r = await fetch(`/api/pay/${jobId}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ originAsset: asset, refundTo: refund }) });
    const d = await r.json().catch(() => ({ error: 'Something went wrong' }));
    setBusy(false);
    if (!r.ok) return setErr(d.error);
    setJob(d);
  }

  if (missing) return <main className="app pay"><div className="brandrow"><Wordmark /></div><h1>This deposit link doesn’t exist</h1><p className="muted">Check the link in your message, or call the builder again.</p></main>;
  if (!job) return <main className="app pay"><div className="brandrow"><Wordmark /></div><p className="muted">Loading your deposit…</p></main>;

  const p = job.payment;
  const status = p?.status;
  const step = STEPS.findIndex(([s]) => s === status);
  const picking = !p?.quote.depositAddress || status === 'PENDING_DEPOSIT';
  const bad = !!status && /FAIL|REFUND|INCOMPLETE/.test(status);

  return (
    <main className="app pay">
      <div className="brandrow"><Wordmark /><span className="muted">for {job.business}</span></div>
      <h1>Deposit for your {job.service.toLowerCase()}</h1>
      <p className="muted" style={{ margin: '6px 0 0' }}>Hi {job.name}, your quote is {usd(job.quotedUsd)}. This deposit holds your site visit.</p>

      <section className="card" aria-labelledby="amt">
        <h2 id="amt" className="muted" style={{ fontWeight: 500, fontSize: 14 }}>Deposit</h2>
        <div className="amount">{usd(job.depositUsd)}</div>
        <p className="explain">The builder receives exactly this in {job.payout}. You pay with whatever you hold; NEAR Intents swaps it on the way. Nobody holds your money in between.</p>
        {picking && (
          <>
            <label className="field-label" htmlFor="token">Pay with</label>
            <select id="token" className="control" value={asset} onChange={(e) => setAsset(e.target.value)}>
              {tokens.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {t.blockchain}</option>)}
            </select>
            <label className="field-label" htmlFor="refund">Your address on that chain (refunds go here if anything fails)</label>
            <input id="refund" className="control" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="0x…, name.near or a Solana address" autoComplete="off" />
            <button className="btn ink" onClick={quote} disabled={busy || !asset}>{busy ? 'Getting a quote…' : p ? 'Get a new address' : 'Get deposit address'}</button>
            {err && <p className="err" role="alert">{err}</p>}
          </>
        )}
      </section>

      {p?.quote.depositAddress && (
        <section className="card" aria-labelledby="send">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <h2 id="send">Send exactly</h2>
            <span className={`pill ${status === 'SUCCESS' ? 'ok' : bad ? 'warn' : 'wait'}`}>{NICE[status!] ?? status}</span>
          </div>
          <div className="amount">{p.quote.amountInFormatted} {p.originSymbol}</div>
          <p className="muted" style={{ margin: 0 }}>to this address on {p.chain}{p.quote.deadline ? `, before ${new Date(p.quote.deadline).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}:</p>
          <div className="qrrow">
            <div className="qr" aria-label="QR code of the deposit address" dangerouslySetInnerHTML={{ __html: qr }} />
            <div>
              <p className="addr">{p.quote.depositAddress}</p>
              {p.quote.depositMemo && <p className="addr">Memo (required): {p.quote.depositMemo}</p>}
              <button className="btn small white" onClick={() => navigator.clipboard?.writeText(p.quote.depositAddress!)}>Copy address</button>
            </div>
          </div>
          {!bad && (
            <ol className="steps" aria-label="Progress">
              {STEPS.map(([s, label], i) => <li key={s} className={i < step || status === 'SUCCESS' ? 'done' : i === step ? 'now' : ''}>{label}</li>)}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
