import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AttRow, Makers, ROLE, SiteFooter, Wordmark, type Att, TopBar } from '../ui';

const passed = (a: Att) => !('error' in a) && a.intel.verified && a.quoteBindsKey && a.gpu.verified;

// Public: anyone can see which TEE each model runs in and what this server checked. No call data here.
export const Route = createFileRoute('/proof')({
  head: () => ({ meta: [{ title: 'Proof the AI runs privately · Ringfence' }] }),
  component: Proof,
});

function Proof() {
  const [atts, setAtts] = useState<Att[] | null>(null);
  const [err, setErr] = useState('');
  const load = (fresh = false) => {
    setErr('');
    fetch(`/api/proof${fresh ? '?fresh=1' : ''}`).then(async (r) => (r.ok ? setAtts(await r.json()) : setErr(`The server answered ${r.status}.`))).catch(() => setErr('Can’t reach the server.'));
  };
  useEffect(() => load(), []);
  const n = atts?.filter(passed).length ?? 0;
  return (
    <>
    <main className="app pg pf">
      <TopBar />
      <p className="pf-kick">Private AI, checked live</p>
      <h1 className="pf-score"><span>{atts ? n : '…'}</span>/{atts ? atts.length : 3}</h1>
      <p className="pf-lead">{atts ? (n === atts.length ? 'models verified inside a TEE. Right now, fresh nonce.' : 'models verified. Some checks failed, see below.') : err || 'Checking Intel and NVIDIA, a few seconds…'}</p>
      {atts?.find((a: any) => a.host) && <p className="muted">Checked on {(atts.find((a: any) => a.host) as any).host}{(atts.find((a: any) => a.host) as any).host.includes('stg') ? ', the NEAR AI Cloud host our NEARON key runs on (staking rewards pay for the AI)' : ', NEAR AI Cloud production'}. <a href="https://nearon.dev">NEARON</a></p>}
      <div className="pf-grid">
        {(atts ?? []).map((a) => {
          const bad = 'error' in a;
          return (
            <section key={a.model} className={`pf-tile ${passed(a) ? 'ok' : 'no'}`}>
              <h2>{ROLE[a.model] ?? 'Model'}</h2>
              <p className="pf-model">{a.model.split('/').pop()}</p>
              {bad ? <p className="muted">{a.error === 'pending' ? 'Fetching…' : 'Attestation unavailable'}</p> : (
                <ul>
                  <li className={a.intel.verified ? 'y' : 'n'}>Intel TDX</li>
                  <li className={a.quoteBindsKey ? 'y' : 'n'}>Key in the enclave</li>
                  <li className={a.gpu.verified ? 'y' : 'n'}>NVIDIA {a.gpu.gpus}× {a.gpu.arch}</li>
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="pf-acts"><button className="btn" onClick={() => { setAtts(null); load(true); }}>Re-check now</button><a href="/api/proof">Raw JSON</a><a href="https://docs.near.ai/cloud/verification/">NEAR AI docs</a></p>
      <details className="pf-how">
        <summary>How the check works</summary>
        <p>Chat, speech-to-text and image models run on NEAR AI Cloud in an Intel TDX VM with NVIDIA confidential GPUs. For each one this server sends a fresh nonce and checks: Intel signed the report (<a href="https://github.com/Phala-Network/dcap-qvl">dcap-qvl</a>), the model key and nonce are inside it, and NVIDIA NRAS vouches for every GPU. Every chat reply is signed by that key. Run it yourself: <code>npm run attest</code>.</p>
        <p className="muted">Not attested: our app server and the Cartesia voice. Not checked: that the TDX measurements match a published NEAR AI build.</p>
        {atts && <div className="card att">{atts.map((a) => <AttRow key={a.model} a={a} full />)}</div>}
      </details>
    </main>
    <SiteFooter />
    </>
  );
}
