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

// The makers' lockup: "Chromia × evalengine on NEAR" (light-on-dark marks; the -dark files are for light grounds).
export function Makers({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={`makers ${size}`} aria-label="By Chromia and evalengine, built on NEAR">
      <img src="/brand/chromia-logo-dark.svg" alt="Chromia" width={800} height={184} />
      <span className="x" aria-hidden="true">×</span>
      <img src="/brand/evalengine-wordmark-light.svg" alt="evalengine" width={600} height={120} />
      <span className="x" aria-hidden="true">on</span>
      <span className="near"><img src="/brand/near-mark-light.svg" alt="" width={24} height={24} />NEAR</span>
    </span>
  );
}

/** The WhatsApp glyph (Simple Icons, CC0) in WhatsApp green, so the channel is recognisable at a glance. */
export const WaIcon = ({ size = 18 }: { size?: number }) => (
  <svg className="wa-icon" role="img" aria-label="WhatsApp" viewBox="0 0 24 24" width={size} height={size} style={{ verticalAlign: '-0.18em', marginRight: 6, flex: 'none' }}>
    <path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);

export const CODE_URL = 'https://github.com/ChromiaAgents/ringfence';

// The site footer: picture credits (the landing page passes them), links, year and licence.
export function SiteFooter({ credits }: { credits?: ReactNode }) {
  return (
    <>
      {credits && <p className="site-credits">{credits}</p>}
      <p className="site-partners">Built with
        <a href="https://near.org" target="_blank" rel="noreferrer"><img src="/brand/near-mark-light.svg" alt="" width={16} height={16} />NEAR</a>
        <a href="https://cloud.near.ai" target="_blank" rel="noreferrer">NEAR AI Cloud</a>
        <a href="https://near-intents.org" target="_blank" rel="noreferrer">NEAR Intents</a>
        <a href="https://justhoot.fun" target="_blank" rel="noreferrer"><img src="/brand/justhoot.png" alt="" width={16} height={16} />JustHoot</a>
        <a href="https://nearon.dev" target="_blank" rel="noreferrer"><img src="/brand/nearon.svg" alt="" width={16} height={16} />NEARON</a>
      </p>
      <footer className="site-foot">
        <span className="foot-id"><span>Ringfence, built for the NEAR hackathon</span><Makers size="lg" /></span>
        <nav aria-label="Site"><a href="/packet/demo">Open a packet</a><a href="/#call">Try a call</a><a href="/deck.html">Deck</a><a href="/stats">Stats</a><a href="/proof">Proof</a><a href="/wallet/bind">Bind your number</a><a href={CODE_URL}>Code</a></nav>
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
export const ROLE: Record<string, string> = { 'deepseek-ai/DeepSeek-V4.1-Flash-1017': 'Chat', 'openai/whisper-large-v3': 'Speech to text', 'black-forest-labs/FLUX.2-klein-4B': 'Logo' };
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

/** The one top bar every page uses: wordmark, makers, an optional pill, the site links and "Try a call". */
export function TopBar({ children, onTry }: { children?: ReactNode; onTry?: (e: React.MouseEvent) => void }) {
  return (
    <nav className="bar topbar" aria-label="Ringfence">
      <Wordmark />
      <Makers />
      {children}
      <span className="sp" />
      <a className="code" href="/room/liho00.near">Live room</a>
      <a className="code" href="/live">Live panel</a>
      <a className="code" href="/wallet/bind">Bind wallet</a>
      <a className="code" href="/deck.html">Deck</a>
      <a className="code" href="/stats">Stats</a>
      <a className="code" href="/proof">Proof</a>
      <a className="code" href={CODE_URL}>Code</a>
      <a className="btn" href={onTry ? '#call' : '/#call'} onClick={onTry}>Try a call</a>
    </nav>
  );
}
