import { browserActions } from '../near-wallet';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import walletCss from '../styles/wallet-modal.css?url';
import { Makers, SiteFooter, Wordmark, TopBar } from '../ui';

type Launch = {
  id: string; network: 'mainnet' | 'testnet'; contract: string; tokenId: string | null; tokenUrl: string | null; status: 'prepared' | 'signed' | 'live' | 'failed';
  params: { name: string; symbol: string; description: string; icon: string; socials?: Record<string, string | undefined> };
  logoModel: string | null; signer: string | null; txHash: string | null; reason: string | null; txUrl: string | null;
};
type TxSpec = { receiverId: string; actions: { methodName: string; args: object; gas: string; deposit: string }[] };
type Cost = { createDeposit: string; registerDeposit: string; totalYocto: string; tokenId?: string | null };
// NEARON (https://stg.nearon.dev) is a testnet staging prototype today; this is a link only, nothing is called.

const getLaunch = createServerFn({ method: 'GET' }).validator((id: string) => id).handler(async ({ data }) => {
  const { findLaunch, publicLaunch } = await import('../backend.ts');
  const l = findLaunch(data);
  return l ? (JSON.parse(JSON.stringify(publicLaunch(l))) as Launch) : null;
});

export const Route = createFileRoute('/launch/$id')({
  loader: ({ params }) => getLaunch({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Launch $${loaderData.params.symbol} · Ringfence` : 'Launch · Ringfence' }],
    links: [{ rel: 'stylesheet', href: walletCss }],
  }),
  component: LaunchPage,
});

const near = (y: string) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 });

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
      const actionCreators = await browserActions();
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

  if (!l) return <main className="app pay"><TopBar /><h1>This launch link doesn’t exist</h1><p className="muted">Check the link in your message, or call the launch desk again.</p><SiteFooter /></main>;
  const p = l.params;
  const live = l.status === 'live';

  return (
    <>
    <main className="app pay launch">
      <TopBar><span className={`pill ${l.network === 'mainnet' ? 'warn' : 'wait'}`} title="JustHoot runs on NEAR mainnet only, so this launch is on mainnet even when the rest of the demo is on testnet.">NEAR {l.network} · JustHoot is mainnet-only</span></TopBar>

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
          <div className="row"><span>Launchpad</span><b>JustHoot: instant launch, trades on RHEA right away</b></div>
          <div className="row"><span>Trading</span><b>RHEA pool against wNEAR (1% fee tier), opens with the launch</b></div>
          <div className="row"><span>Transfer tax, dev buy</span><b>None, all supply to the pool and you</b></div>
          <div className="row"><span>Links</span><b>{[p.socials?.twitter, p.socials?.telegram, p.socials?.website].filter(Boolean).join(' · ') || 'None'}</b></div>
          <div className="row"><span>Contract</span><b className="mono">{l.contract}</b></div>
        </div>
        <p className="explain">The description and links live on this page.</p>
      </section>

      {live ? (
        <section className="card done" aria-labelledby="live-h">
          <h2 id="live-h">{`$${p.symbol} is live on JustHoot`}</h2>
          <p>It trades on RHEA now{l.tokenId && <>, token <span className="mono">{l.tokenId}</span></>}. Signed by {l.signer}.</p>
          <div className="actions">
            <a className="btn ink" href="https://justhoot.fun" target="_blank" rel="noreferrer">Open JustHoot</a>
            {l.tokenUrl && <a className="btn white" href={l.tokenUrl} target="_blank" rel="noreferrer">See the token</a>}
            {l.txUrl && <a className="btn white" href={l.txUrl} target="_blank" rel="noreferrer">See the transaction</a>}
          </div>
        </section>
      ) : null}

      {live ? (
        <section className="card" aria-labelledby="brain-h">
          <h2 id="brain-h">Give your coin a brain</h2>
          <p className="explain">With NEARON you stake NEAR, earn CREDIT, and bind the coin so its AI agent is paid for. NEARON is a testnet staging prototype today.</p>
          <a className="btn white small" href="https://stg.nearon.dev/#/docs" target="_blank" rel="noreferrer">Read the NEARON docs</a>
        </section>
      ) : (
        <section className="card" aria-labelledby="sign-h">
          <h2 id="sign-h">Sign with your NEAR wallet</h2>
          <p className="explain">One transaction to {l.contract} on JustHoot. It is built from the contract’s own views and you sign it in your wallet; this site never sees your keys.</p>
          {!account ? (
            <button className="btn ink" onClick={() => ws.current.modal?.show()}>Connect a wallet</button>
          ) : (
            <>
              <p className="muted">Connected as <b>{account}</b> · <button className="linkish" onClick={() => ws.current.modal?.show()}>switch</button></p>
              {tx ? (
                <>
                  <div className="rows">
                    {BigInt(tx.cost.registerDeposit) > 0n && <div className="row"><span>Register your account with JustHoot (storage)</span><b>{near(tx.cost.registerDeposit)} NEAR</b></div>}
                    <div className="row"><span>Create the token and its RHEA pool</span><b>{near(tx.cost.createDeposit)} NEAR</b></div>
                    <div className="row total"><span>You pay, plus gas</span><b>{near(tx.cost.totalYocto)} NEAR</b></div>
                  </div>
                  {tx.cost.tokenId && <p className="muted small">Your token will be <span className="mono">{tx.cost.tokenId}</span>.</p>}
                  {l.network === 'mainnet' && <p className="err" role="note">Mainnet: real NEAR, about {near(tx.cost.totalYocto)} NEAR plus gas.</p>}
                  <button className="btn green" onClick={sign} disabled={busy}>{busy ? 'Waiting for your wallet…' : `Sign and launch $${p.symbol}`}</button>
                  <details className="txdetails"><summary>The exact transaction</summary><pre>{JSON.stringify({ ...tx.tx, actions: tx.tx.actions.map((a) => ({ ...a, args: { ...a.args, icon: (a.args as any).icon ? `<${(a.args as any).icon.length} chars>` : undefined } })) }, null, 1)}</pre></details>
                </>
              ) : !err && <p className="muted">Asking the contract for the exact cost…</p>}
            </>
          )}
          {l.status === 'failed' && <p className="err" role="alert">The last transaction did not launch the coin: {l.reason}</p>}
          {err && <p className="err" role="alert">{err}</p>}
          <p className="risk">Memecoins are risky and most lose value. Nothing here is advice or a promise of returns.</p>
        </section>
      )}

      {!live && <Fund launch={l} account={account} yocto={tx?.cost.totalYocto} />}
    </main>
    <SiteFooter />
    </>
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
