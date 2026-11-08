// Small pieces shared by the screens.
import type { ReactNode } from 'react';

export const Phone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" />
  </svg>
);

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <a className="wordmark" href={href}>Ringfence</a>
  );
}

// The makers' lockup: "Chromia × evalengine × NEAR" (light-on-dark marks; the -dark files are for light grounds).
export function Makers({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={`makers ${size}`} aria-label="By Chromia and evalengine, built on NEAR">
      <img src="/brand/chromia-logo-dark.svg" alt="Chromia" width={800} height={184} />
      <span className="x" aria-hidden="true">×</span>
      <img src="/brand/evalengine-wordmark-light.svg" alt="evalengine" width={600} height={120} />
      <span className="x" aria-hidden="true">×</span>
      <span className="near"><img src="/brand/near-mark-light.svg" alt="" width={24} height={24} />NEAR</span>
    </span>
  );
}

export const CODE_URL = 'https://github.com/ChromiaAgents/ringfence';

// The site footer: picture credits (the landing page passes them), links, year and licence.
export function SiteFooter({ credits }: { credits?: ReactNode }) {
  return (
    <>
      {credits && <p className="site-credits">{credits}</p>}
      <footer className="site-foot">
        <span className="foot-id"><span>Ringfence, built for the NEAR hackathon</span><Makers size="lg" /></span>
        <nav aria-label="Site"><a href="/#call">Try a call</a><a href="/proof">Proof</a><a href="/wallet/bind">Bind your number</a><a href="/dashboard">Dashboard</a><a href={CODE_URL}>Code</a></nav>
        <span className="r">2026 · MIT licence</span>
      </footer>
    </>
  );
}

export type Proof = { status: 'pending' | 'verified' | 'unverified'; signer?: string; kind?: string; model?: string };

export function Signed({ proof }: { proof?: Proof }): ReactNode {
  if (!proof) return null;
  if (proof.status === 'verified')
    return <span className="pill ok" title={`Signed by ${proof.signer} (${proof.kind})`}>TEE-signed</span>;
  if (proof.status === 'pending') return <span className="pill wait">Checking signature</span>;
  return <span className="pill warn">Unverified</span>;
}

export const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
export const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// A drawn sticker coin, used as the launch desk's picture (no stock imagery for something that doesn't exist yet).
export const Coin = ({ label, className }: { label: string; className?: string }) => (
  <svg className={className} viewBox="0 0 240 240" role="img" aria-label={`A sticker coin marked ${label}`}>
    <circle cx="128" cy="128" r="104" fill="var(--ink)" />
    <circle cx="116" cy="116" r="104" fill="var(--white)" stroke="var(--ink)" strokeWidth="6" />
    <circle cx="116" cy="116" r="80" fill="none" stroke="var(--ink)" strokeWidth="4" strokeDasharray="2 12" strokeLinecap="round" />
    <text x="116" y="116" dy=".35em" textAnchor="middle" fontFamily="var(--display)" fontSize={label.length > 4 ? 32 : 44} fill="var(--ink)">${label}</text>
  </svg>
);

// ---- TEE attestation, as verified by this server (src/ai.ts attest) ----
export type Att =
  | { model: string; signingAddress: string; nonce: string; quoteBindsKey: boolean; reportDataHex: string; fetchedAt: number;
      intel: { verified: boolean; tcbStatus?: string; advisoryIds?: string[]; error?: string };
      gpu: { verified: boolean; gpus?: number; arch?: string; nonceMatch?: boolean; error?: string } }
  | { model: string; error: string };
export const ROLE: Record<string, string> = { 'Qwen/Qwen3.6-35B-A3B-FP8': 'Chat', 'openai/whisper-large-v3': 'Speech to text', 'black-forest-labs/FLUX.2-klein-4B': 'Logo' };
const ok = (b: boolean, yes: string, no: string, title?: string) => <span className={`pill ${b ? 'ok' : 'warn'}`} title={title}>{b ? yes : no}</span>;

export function AttRow({ a, full }: { a: Att; full?: boolean }) {
  return (
    <div className="attrow">
      <p><b>{ROLE[a.model] ?? 'Model'}</b> · {a.model}</p>
      {'error' in a ? (a.error === 'pending' ? <p><span className="pill wait">Fetching attestation</span></p> : <p><span className="pill warn">Attestation unavailable</span> {a.error}</p>) : (
        <>
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ok(a.intel.verified, `Intel TDX report valid · ${a.intel.tcbStatus}`, 'Intel TDX report not verified', a.intel.error)}
            {ok(a.quoteBindsKey, 'Key + nonce bound', 'Key not bound')}
            {ok(a.gpu.verified, `NVIDIA GPU attested · ${a.gpu.gpus} × ${a.gpu.arch}`, 'GPU not verified', a.gpu.error)}
          </p>
          {!full && <p className="mono" style={{ wordBreak: 'break-all' }} title={a.signingAddress}>{`${a.signingAddress.slice(0, 10)}…`}</p>}
          {full && (
            <details className="raw">
              <summary>Raw evidence</summary>
              {a.intel.error && <p className="muted">Intel: {a.intel.error}</p>}
              {a.gpu.error && <p className="muted">GPU: {a.gpu.error}</p>}
              <p className="muted mono" style={{ wordBreak: 'break-all' }}>signing address {a.signingAddress}<br />nonce {a.nonce}<br />report_data {a.reportDataHex}<br />checked {new Date(a.fetchedAt).toISOString()}</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
