import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import walletCss from '@near-wallet-selector/modal-ui/styles.css?url';
import { Wordmark } from '../ui';

type Launch = {
  id: string; network: 'mainnet' | 'testnet'; contract: string; status: 'prepared' | 'signed' | 'live' | 'failed';
  params: { name: string; symbol: string; description: string; icon: string; durationMinutes: number; softCapNear: number; hardCapNear?: number; team?: { pct: number; cliffDays: number; vestingDays: number }; socials?: Record<string, string | undefined>; totalSupply: string };
  logoModel: string | null; signer: string | null; txHash: string | null; memeId: number | null; reason: string | null; memeUrl: string | null; txUrl: string | null; pinning: boolean;
};
type TxSpec = { receiverId: string; actions: { methodName: string; args: object; gas: string; deposit: string }[] };
type Cost = { createDeposit: string; registerDeposit: string; totalYocto: string };

const getLaunch = createServerFn({ method: 'GET' }).validator((id: string) => id).handler(async ({ data }) => {
  const { findLaunch, publicLaunch } = await import('../backend.ts');
  const l = findLaunch(data);
  return l ? (JSON.parse(JSON.stringify(publicLaunch(l))) as Launch) : null;
});

export const Route = createFileRoute('/launch/$id')({
  loader: ({ params }) => getLaunch({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Launch $${loaderData.params.symbol} · callhand` : 'Launch · callhand' }],
    links: [{ rel: 'stylesheet', href: walletCss }],
  }),
  component: LaunchPage,
});

const near = (y: string) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 });
const dur = (m: number) => { const h = +(m / 60).toFixed(2); return m >= 60 ? `${h} hour${h === 1 ? '' : 's'}` : `${m} minutes`; };

function LaunchPage() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const [l, setL] = useState<Launch | null>(initial);
  const [account, setAccount] = useState<string | null>(null);
  const [tx, setTx] = useState<{ tx: TxSpec; cost: Cost } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ws = useRef<{ selector?: any; modal?: any }>({});

  // Wallet selector only runs in the browser; its modules are loaded on demand.
  useEffect(() => {
    if (!l) return;
    let off: any;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupHotWallet }, { setupMyNearWallet }, { setupIntearWallet }] = await Promise.all([
        import('@near-wallet-selector/core'), import('@near-wallet-selector/modal-ui'), import('@near-wallet-selector/meteor-wallet'),
        import('@near-wallet-selector/hot-wallet'), import('@near-wallet-selector/my-near-wallet'), import('@near-wallet-selector/intear-wallet'),
      ]);
      const selector = await setupWalletSelector({ network: l.network, modules: [setupMeteorWallet(), setupHotWallet(), setupIntearWallet(), setupMyNearWallet()] });
      ws.current = { selector, modal: setupModal(selector, { description: 'Connect the wallet that will own this meme.' }) };
      const sync = (s: any) => setAccount(s.accounts.find((a: any) => a.active)?.accountId ?? null);
      sync(selector.store.getState());
      off = selector.store.observable.subscribe(sync);
      // Redirect wallets (MyNearWallet) come back with the hash in the URL.
      const q = new URLSearchParams(location.search);
      const h = q.get('transactionHashes')?.split(',').pop();
      const signer = selector.store.getState().accounts.find((a: any) => a.active)?.accountId;
      if (h && signer) report(h, signer);
    })().catch((e) => setErr(`Wallet selector failed to load: ${e.message}`));
    return () => off?.unsubscribe?.();
  }, [l?.network]);

  // The exact transaction and cost for the connected account, from the contract's own views.
  useEffect(() => {
    if (!account || !l || l.status === 'live') return;
    setTx(null); setErr('');
    fetch(`/api/launch/${id}/tx?signer=${encodeURIComponent(account)}`).then(async (r) => {
      const d = await r.json();
      r.ok ? setTx(d) : setErr(d.error);
    }).catch(() => setErr('Could not reach the server.'));
  }, [account, id]);

  async function report(txHash: string, signer: string) {
    setBusy(true);
    const r = await fetch(`/api/launch/${id}/signed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash, signer }) });
    const d = await r.json().catch(() => ({ error: 'Something went wrong' }));
    setBusy(false);
    r.ok ? setL(d) : setErr(d.error);
  }

  async function sign() {
    if (!tx || !account) return;
    setErr(''); setBusy(true);
    try {
      const { actionCreators } = await import('@near-wallet-selector/core');
      const wallet = await ws.current.selector.wallet();
      const out = await wallet.signAndSendTransaction({
        signerId: account,
        receiverId: tx.tx.receiverId,
        actions: tx.tx.actions.map((a) => actionCreators.functionCall(a.methodName, a.args, BigInt(a.gas), BigInt(a.deposit))),
      });
      const hash = out?.transaction?.hash ?? out?.transaction_outcome?.id;
      if (hash) await report(hash, account);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!l) return <main className="app pay"><div className="brandrow"><Wordmark /></div><h1>This launch link doesn’t exist</h1><p className="muted">Check the link in your message, or call the launch desk again.</p></main>;
  const p = l.params;
  const live = l.status === 'live';

  return (
    <main className="app pay launch">
      <div className="brandrow"><Wordmark /><span className={`pill ${l.network === 'mainnet' ? 'warn' : 'wait'}`}>NEAR {l.network}</span></div>

      <section className="coin" aria-labelledby="coin-h">
        <img className="logo stk" src={p.icon} alt={`Logo for ${p.name}`} width="256" height="256" />
        <div>
          <p className="ticker">${p.symbol}</p>
          <h1 id="coin-h">{p.name}</h1>
          {p.description && <p className="muted">{p.description}</p>}
          <p className="muted small">Logo: {l.logoModel === 'drawn locally' ? 'a placeholder drawn on this server (the image model was unavailable)' : `${l.logoModel ?? 'unknown'} on NEAR AI Cloud`}</p>
        </div>
      </section>

      <section className="card" aria-labelledby="terms">
        <h2 id="terms">What you agreed on the call</h2>
        <div className="rows">
          <div className="row"><span>Auction</span><b>{dur(p.durationMinutes)}, starts when the transaction lands</b></div>
          <div className="row"><span>Soft cap</span><b>{p.softCapNear.toLocaleString('en-US')} NEAR</b></div>
          <div className="row"><span>Hard cap</span><b>{p.hardCapNear ? `${p.hardCapNear.toLocaleString('en-US')} NEAR` : 'None'}</b></div>
          <div className="row"><span>Supply</span><b>{Number(p.totalSupply).toLocaleString('en-US')} {p.symbol}</b></div>
          <div className="row"><span>Team allocation</span><b>{p.team ? `${p.team.pct}%, ${p.team.cliffDays}-day cliff, vests over ${p.team.vestingDays} days` : 'None'}</b></div>
          <div className="row"><span>Links</span><b>{[p.socials?.twitter, p.socials?.telegram, p.socials?.website].filter(Boolean).join(' · ') || 'None'}</b></div>
          <div className="row"><span>Contract</span><b className="mono">{l.contract}</b></div>
        </div>
        {!l.pinning && <p className="explain">The description and links live on this page.</p>}
      </section>

      {live ? (
        <section className="card done" aria-labelledby="live-h">
          <h2 id="live-h">${p.symbol} is meme #{l.memeId}</h2>
          <p>The auction is open on meme.cooking. Signed by {l.signer}.</p>
          <div className="actions">
            {l.memeUrl && <a className="btn ink" href={l.memeUrl} target="_blank" rel="noreferrer">Open on meme.cooking</a>}
            {l.txUrl && <a className="btn white" href={l.txUrl} target="_blank" rel="noreferrer">See the transaction</a>}
          </div>
        </section>
      ) : (
        <section className="card" aria-labelledby="sign-h">
          <h2 id="sign-h">Sign with your NEAR wallet</h2>
          <p className="explain">One transaction to {l.contract}. It is built from the contract’s own views and you sign it in your wallet; this site never sees your keys.</p>
          {!account ? (
            <button className="btn ink" onClick={() => ws.current.modal?.show()}>Connect a wallet</button>
          ) : (
            <>
              <p className="muted">Connected as <b>{account}</b> · <button className="linkish" onClick={() => ws.current.modal?.show()}>switch</button></p>
              {tx ? (
                <>
                  <div className="rows">
                    {BigInt(tx.cost.registerDeposit) > 0n && <div className="row"><span>Register your account with meme.cooking (refundable storage)</span><b>{near(tx.cost.registerDeposit)} NEAR</b></div>}
                    <div className="row"><span>Store the meme on chain</span><b>{near(tx.cost.createDeposit)} NEAR</b></div>
                    <div className="row total"><span>You pay, plus gas</span><b>{near(tx.cost.totalYocto)} NEAR</b></div>
                  </div>
                  <button className="btn green" onClick={sign} disabled={busy}>{busy ? 'Waiting for your wallet…' : `Sign and launch $${p.symbol}`}</button>
                  <details className="txdetails"><summary>The exact transaction</summary><pre>{JSON.stringify({ ...tx.tx, actions: tx.tx.actions.map((a) => ({ ...a, args: { ...a.args, icon: (a.args as any).icon ? `<${(a.args as any).icon.length} chars>` : undefined } })) }, null, 1)}</pre></details>
                </>
              ) : !err && <p className="muted">Asking the contract for the exact cost…</p>}
            </>
          )}
          {l.status === 'failed' && <p className="err" role="alert">The last transaction did not create the meme: {l.reason}</p>}
          {err && <p className="err" role="alert">{err}</p>}
          <p className="risk">Memecoins are risky and most lose value. Nothing here is advice or a promise of returns.</p>
        </section>
      )}

      {!live && <Fund launch={l} account={account} yocto={tx?.cost.totalYocto} />}
    </main>
  );
}

// Optional: get the NEAR for the launch from another chain, through NEAR Intents 1Click (mainnet only).
function Fund({ launch, account, yocto }: { launch: Launch; account: string | null; yocto?: string }) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<{ assetId: string; blockchain: string; symbol: string }[]>([]);
  const [asset, setAsset] = useState('');
  const [refund, setRefund] = useState('');
  const [q, setQ] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open || tokens.length) return;
    fetch('/api/tokens').then((r) => r.json()).then((t) => { const f = t.filter((x: any) => ['USDC', 'USDT', 'ETH', 'SOL', 'BTC'].includes(x.symbol)); setTokens(f); setAsset(f[0]?.assetId ?? ''); }).catch(() => setErr('Could not load tokens.'));
  }, [open]);
  if (launch.network !== 'mainnet') return <p className="muted small fundnote">Funding from another chain uses NEAR Intents, which runs on mainnet only. On testnet, get NEAR from a faucet.</p>;
  async function quote() {
    setErr('');
    const r = await fetch(`/api/fund/${launch.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ originAsset: asset, refundTo: refund, recipient: account, yocto }) });
    const d = await r.json();
    r.ok ? setQ(d) : setErr(d.error);
  }
  return (
    <section className="card" aria-labelledby="fund-h">
      <h2 id="fund-h">No NEAR yet?</h2>
      <p className="explain">Optional, mainnet only. NEAR Intents 1Click swaps a token you hold on another chain into exactly the launch cost, delivered to your NEAR account as wNEAR. Unwrap it in your wallet before signing.</p>
      {!open ? <button className="btn white small" onClick={() => setOpen(true)}>Fund from another chain</button> : !account || !yocto ? <p className="muted">Connect your wallet first so we know where to send it and how much.</p> : (
        <>
          <label className="field-label" htmlFor="ftok">Pay with</label>
          <select id="ftok" className="control" value={asset} onChange={(e) => setAsset(e.target.value)}>{tokens.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {t.blockchain}</option>)}</select>
          <label className="field-label" htmlFor="fref">Your address on that chain (refunds)</label>
          <input id="fref" className="control" value={refund} onChange={(e) => setRefund(e.target.value)} autoComplete="off" />
          <button className="btn ink small" onClick={quote} disabled={!asset || !refund}>Get a deposit address</button>
          {q && <p className="addr">Send {q.quote.amountInFormatted} {q.symbol} on {q.chain} to {q.quote.depositAddress}{q.quote.depositMemo ? ` (memo ${q.quote.depositMemo})` : ''}</p>}
        </>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </section>
  );
}
