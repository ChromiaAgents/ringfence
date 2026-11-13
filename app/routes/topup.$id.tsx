// Top up from another chain: the caller pastes a refund address (impossible to say on a call) and gets the 1Click
// deposit address to send to. The funds go from the caller's wallet straight to NEAR Intents, never through us.
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { SiteFooter, TopBar, seo } from '../ui';

export const Route = createFileRoute('/topup/$id')({
  head: () => ({ meta: seo({ title: 'Top up from any chain · Ringfence', description: 'Send USDT, USDC, SOL, ETH or BTC from any chain; NEAR Intents swaps it into your phone wallet as USDC.', path: '/', image: 'topup' }) }),
  component: Topup,
});

type Info = { usd: number; token: string; recipient: string; demo: boolean; live: boolean; quote?: any };
type Quote = { send: string; symbol: string; chain: string; receive: string; depositAddress?: string; depositMemo?: string; deadline: string; refund?: string };

function Topup() {
  const { id } = Route.useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState('');
  const [refund, setRefund] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState<(Quote & { status?: string | null }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [st, setSt] = useState<{ status?: string; out?: string; tx?: string; inTx?: string; chain?: string; deposit?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  // Live: the swap's status every 5 s (the server follows 1Click), and a countdown to the quote's deadline.
  useEffect(() => {
    if (!q?.depositAddress) return;
    const tick = () => fetch(`/api/topup/${id}/status`).then((r) => r.json()).then(setSt).catch(() => {});
    tick(); const a = setInterval(tick, 5000), b = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [q?.depositAddress, id]);
  const left = q ? Date.parse(q.deadline) - now : 0;
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const STEP: Record<string, string> = { PENDING_DEPOSIT: 'Waiting for your deposit…', KNOWN_DEPOSIT_TX: 'Deposit seen, confirming…', PROCESSING: 'Swapping on NEAR Intents…', SUCCESS: 'Landed ✓', INCOMPLETE_DEPOSIT: 'Deposit was short: send the rest or wait for a refund', REFUNDED: 'Refunded to your address', FAILED: 'Failed' };

  useEffect(() => {
    fetch(`/api/topup/${id}`).then(async (r) => (r.ok ? (async () => { const j = await r.json(); setInfo(j); if (j.quote) setQ(j.quote); })() : setErr(((await r.json().catch(() => ({}))) as any).error ?? `The server answered ${r.status}.`))).catch(() => setErr('Can’t reach the server.'));
  }, [id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await fetch(`/api/topup/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refund }) }).catch(() => null);
    setBusy(false);
    const j: any = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) setQ({ ...j.quote, status: j.status }); else setErr(j.error ?? 'Can’t reach the server.');
  }

  return (
    <>
      <main className="app pg live">
        <TopBar />
        <div className="pg-two">
          <div>
            <h1>Top up</h1>
            {!info ? <p className="muted">{err || 'Loading…'}</p> : (<>
              <p>{info.usd} {info.usd === 1 ? 'dollar' : 'dollars'} of <b>{info.token}</b> in, USDC out on NEAR, through NEAR Intents.</p>
              <p className="muted">Lands in <code>{info.recipient}</code>{info.demo ? ': the shared demo wallet, not yours. Anything sent is a gift to the demo.' : '.'}</p>
              {!q ? (
                <form onSubmit={submit}>
                  <label htmlFor="tp-refund">Your refund address on the sending chain</label>
                  <input id="tp-refund" autoComplete="off" spellCheck={false} placeholder="Paste your address" value={refund} onChange={(e) => setRefund(e.target.value.trim())} required />
                  <p className="muted" style={{ fontSize: 13 }}>If the swap fails, NEAR Intents sends your {info.token} back here.</p>
                  <button className="btn" type="submit" disabled={busy || refund.length < 20}>{busy ? 'Getting the address…' : 'Get deposit address'}</button>
                  {err && <p role="alert" className="refused">{err}</p>}
                </form>
              ) : (
                <div className="tp-quote">
                  <p className="tp-big">Send exactly <b>{q.send} {q.symbol}</b> on {q.chain}</p>
                  {q.depositAddress ? (<>
                    <p className="muted">to this address</p>
                    <p className="tp-addr"><code>{q.depositAddress}</code></p>
                    {q.depositMemo && <p>Memo: <code>{q.depositMemo}</code></p>}
                    <p className="tp-acts">
                      <button className="btn" onClick={() => { navigator.clipboard?.writeText(q.depositAddress!); setCopied(true); }}>{copied ? 'Copied' : 'Copy address'}</button>
                      <a href={`https://explorer.near-intents.org/transactions/${q.depositAddress}`} target="_blank" rel="noreferrer">NEAR Intents explorer</a>
                    </p>
                    <p className={`tp-status ${st?.status === 'SUCCESS' ? 'ok' : ['REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'].includes(st?.status ?? '') ? 'bad' : ''}`} role="status">
                      {STEP[st?.status ?? 'PENDING_DEPOSIT'] ?? st?.status}
                      {st?.status === 'SUCCESS' && <> {st.out} USDC is in your wallet.{st.tx && <> <a href={`https://nearblocks.io/txns/${st.tx}`} target="_blank" rel="noreferrer">On NEAR</a></>}</>}
                    </p>
                    {st?.inTx && <p className="muted small">Your deposit: {({ sol: 'https://solscan.io/tx/', eth: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', arb: 'https://arbiscan.io/tx/', bsc: 'https://bscscan.com/tx/', pol: 'https://polygonscan.com/tx/', tron: 'https://tronscan.org/#/transaction/' } as Record<string, string>)[st.chain ?? ''] ? <a href={`${({ sol: 'https://solscan.io/tx/', eth: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', arb: 'https://arbiscan.io/tx/', bsc: 'https://bscscan.com/tx/', pol: 'https://polygonscan.com/tx/', tron: 'https://tronscan.org/#/transaction/' } as Record<string, string>)[st.chain!]}${st.inTx}`} target="_blank" rel="noreferrer">{st.inTx.slice(0, 10)}…</a> : <code>{st.inTx.slice(0, 10)}…</code>}</p>}
                    {st?.status !== 'SUCCESS' && <p>About <b>{q.receive} USDC</b> arrives. {left > 0 ? <>Send within <b>{mmss(left)}</b> (until {new Date(q.deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}).</> : <b>This quote has expired. Ask the agent for a new one.</b>}</p>}
                  </>) : <p className="muted">Dry run: live top ups are off on this server, nothing to send.</p>}
                  <p className="muted" style={{ fontSize: 13 }}>Send only from your own wallet. This site never holds your funds.</p>
                </div>
              )}
            </>)}
          </div>
          <aside className="pg-side" aria-labelledby="tp-how">
            <h2 id="tp-how">How it works</h2>
            <ol>
              <li>Paste an address of yours on the chain you pay from. It is only used for a refund.</li>
              <li>Send the exact amount to the deposit address from your own wallet.</li>
              <li>NEAR Intents swaps it and USDC lands on NEAR, usually within minutes.</li>
            </ol>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
