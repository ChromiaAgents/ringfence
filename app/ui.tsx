// Small pieces shared by the screens.
import type { ReactNode } from 'react';

export const Phone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" />
  </svg>
);

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="Ringfence home">
      <span className="dot"><Phone /></span>Ringfence
    </a>
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
export const ROLE: Record<string, string> = { 'Qwen/Qwen3.6-35B-A3B-FP8': 'Chat', 'openai/whisper-large-v3': 'Speech to text', 'Qwen/Qwen3-VL-30B-A3B-Instruct': 'Photo reader', 'black-forest-labs/FLUX.2-klein-4B': 'Logo' };
const ok = (b: boolean, yes: string, no: string, title?: string) => <span className={`pill ${b ? 'ok' : 'warn'}`} title={title}>{b ? yes : no}</span>;

export function AttRow({ a, full }: { a: Att; full?: boolean }) {
  return (
    <div className="attrow">
      <p><b>{ROLE[a.model] ?? 'Model'}</b> · {a.model}</p>
      {'error' in a ? (a.error === 'pending' ? <p><span className="pill wait">Fetching attestation</span></p> : <p><span className="pill warn">Attestation unavailable</span> {a.error}</p>) : (
        <>
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ok(a.intel.verified, `Intel TDX quote valid · ${a.intel.tcbStatus}`, 'Intel TDX quote not verified', a.intel.error)}
            {ok(a.quoteBindsKey, 'Key + nonce bound', 'Key not bound')}
            {ok(a.gpu.verified, `NVIDIA GPU attested · ${a.gpu.gpus} × ${a.gpu.arch}`, 'GPU not verified', a.gpu.error)}
          </p>
          <p className="mono" style={{ wordBreak: 'break-all' }} title={a.signingAddress}>{full ? a.signingAddress : `${a.signingAddress.slice(0, 10)}…`}</p>
          {full && (
            <>
              {a.intel.error && <p className="muted">Intel: {a.intel.error}</p>}
              {a.gpu.error && <p className="muted">GPU: {a.gpu.error}</p>}
              <p className="muted mono" style={{ wordBreak: 'break-all' }}>nonce {a.nonce}<br />report_data {a.reportDataHex}<br />checked {new Date(a.fetchedAt).toISOString()}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
