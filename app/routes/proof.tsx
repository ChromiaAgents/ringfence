import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AttRow, Makers, ROLE, SiteFooter, Wordmark, type Att } from '../ui';

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
  return (
    <>
    <main className="app canvas" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <div className="brandrow" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}><Wordmark /><Makers /></div>
      <h1>Proof the AI runs privately</h1>
      <p className="muted">Our app server and Cartesia (speech) aren’t attested.</p>
      <div className="proof-sum">
        <h2>{atts ? `${atts.filter(passed).length} of ${atts.length} models checked live, just now` : err || 'Checking the models live…'}</h2>
        {atts && <p>{atts.map((a) => `${ROLE[a.model] ?? 'Model'}: ${passed(a) ? 'verified' : 'not verified'}`).join(' · ')}</p>}
      </div>
      <p>Every model Ringfence uses runs on NEAR AI Cloud inside an Intel TDX confidential VM with NVIDIA confidential-computing GPUs. For each model this server fetches the attestation report with a fresh random nonce and checks three things.</p>
      <ol>
        <li>Intel signed the TDX attestation report, and the platform is up to date (<a href="https://github.com/Phala-Network/dcap-qvl">dcap-qvl</a>, collateral from Intel PCS).</li>
        <li>The model’s signing key and our nonce are inside that report, so the key was made in that TEE, just now.</li>
        <li>NVIDIA’s attestation service (NRAS) vouches for every GPU, with the same nonce.</li>
      </ol>
      <p>Each chat and photo reply is signed by the model’s key. The dashboard marks a reply TEE-signed only when that signature recovers to a key that passed checks 1 and 2.</p>
      <div className="card att" style={{ marginTop: 16 }}>
        {atts ? atts.map((a) => <AttRow key={a.model} a={a} full />) : <p className="muted">{err || 'Verifying (Intel PCS and NVIDIA NRAS, a few seconds)…'}</p>}
      </div>
      <p><button className="btn" onClick={() => { setAtts(null); load(true); }}>Check again with a new nonce</button> · <a href="/api/proof">raw JSON</a></p>
      <h2>Verify it yourself</h2>
      <ul>
        <li>From this repo, no key needed: <code>npm run attest</code> prints every check for every model.</li>
        <li>The raw report: <code>https://cloud-api.near.ai/v1/attestation/report?model=&lt;model&gt;&amp;signing_algo=ecdsa&amp;nonce=&lt;64 hex&gt;</code>, then check <code>intel_quote</code> with <a href="https://github.com/Phala-Network/dcap-qvl">dcap-qvl</a> and post <code>nvidia_payload</code> to <code>https://nras.attestation.nvidia.com/v3/attest/gpu</code>.</li>
        <li>NEAR AI’s guide: <a href="https://docs.near.ai/cloud/verification/">docs.near.ai/cloud/verification</a>.</li>
      </ul>
      <p className="muted">Not checked here: that the TDX measurements (MRTD, RTMRs) equal a published, reproducible NEAR AI build. That needs the image hashes NEAR AI publishes; the NEAR AI docs describe it.</p>
    </main>
    <SiteFooter />
    </>
  );
}
