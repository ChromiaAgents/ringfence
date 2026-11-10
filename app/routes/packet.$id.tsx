// A red packet's page: who sent it, how many shares are open, who got what. It never shows the words (a demo packet's
// hint is its words, on purpose). Opening happens on a call: the button starts one with this packet attached.
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';
import { Makers, SiteFooter, Wordmark } from '../ui';

type Claim = { to: string; near: number; at: number; url: string | null; luckiest: boolean };
type Packet = {
  id: string; from: string; near: number; count: number; lucky: boolean; hint: string | null; demo: boolean; dryRun: boolean;
  createdAt: number; expiresAt: number; expired: boolean; url: string | null; network: 'mainnet' | 'testnet'; contract: string | null; claims: Claim[];
};

const getPacket = createServerFn({ method: 'GET' }).validator((id: string) => id).handler(async ({ data }) => {
  const { findPacket, publicPacket, demoPacket, refundExpired } = await import('../../src/packets.ts');
  const { env } = await import('../../src/config.ts');
  refundExpired().catch(() => {});
  const p = data === 'demo' ? await demoPacket() : findPacket(data);
  return { packet: p ? (JSON.parse(JSON.stringify(publicPacket(p))) as Packet) : null, wa: env.waNumber || null };
});

export const Route = createFileRoute('/packet/$id')({
  loader: ({ params }) => getPacket({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.packet ? `A red packet from ${loaderData.packet.from} · Ringfence` : 'Red packet · Ringfence' }] }),
  component: PacketPage,
});

const short = (a: string) => (a.length > 26 ? `${a.slice(0, 10)}…${a.slice(-10)}` : a);
const near = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });

function PacketPage() {
  const first = Route.useLoaderData();
  const { id } = Route.useParams();
  const [p, setP] = useState<Packet | null>(first.packet);
  const [acct, setAcct] = useState('');
  // Shares appear as people open them.
  useEffect(() => {
    if (!p || p.expired) return;
    const t = setInterval(() => getPacket({ data: p.id }).then((r) => r.packet && setP(r.packet)).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [p?.id, p?.expired]);

  if (!p) return (
    <>
      <main className="app pay">
        <div className="brandrow"><Wordmark /><Makers /></div>
        <h1>{id === 'demo' ? 'Today’s demo packets have all been opened' : 'No red packet here'}</h1>
        <p className="muted">{id === 'demo' ? 'The demo wallet’s daily limit is used up. Come back tomorrow, or make your own packet by calling.' : 'Check the link. Packets expire a day after they are sent.'}</p>
        <a className="btn ink" href="/#call">Make one by phone call</a>
      </main>
      <SiteFooter />
    </>
  );
  const left = p.count - p.claims.length, done = left === 0, open = !p.expired && !done;
  const acctOk = /^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|testnet)$|^[0-9a-f]{64}$/.test(acct.trim().toLowerCase());
  const callUrl = `/?packet=${p.id}${p.hint ? `&say=${encodeURIComponent(p.hint)}` : ''}${acctOk ? `&to=${encodeURIComponent(acct.trim().toLowerCase())}` : ''}#call`;
  return (
    <>
      <main className="app pay hb-page">
        <div className="brandrow"><Wordmark /><Makers /><span className="pill wait">NEAR {p.network}</span></div>
        {p.dryRun && <p className="err" role="note"><b>Dry run.</b> This server has no keys, so no real money is in this packet. The split rule is the contract’s.</p>}
        <section className={`hb${open ? '' : ' shut'}`} aria-label="Red packet">
          <div className="hb-seal" aria-hidden="true">福</div>
          <p className="hb-from">A red packet from <b>{short(p.from)}</b></p>
          <p className="hb-amt">{near(p.near)} <span>NEAR</span></p>
          <p className="hb-meta">{p.count} {p.count === 1 ? 'share' : 'shares'} · {p.lucky ? 'lucky split' : 'equal split'}</p>
          <div className="hb-dots" role="img" aria-label={`${p.claims.length} of ${p.count} opened`}>
            {Array.from({ length: p.count }, (_, i) => <span key={i} className={i < p.claims.length ? 'on' : ''} />)}
          </div>
          <p className="hb-state">{done ? 'Every share has been opened.' : p.expired ? 'Expired. What was left went back to the sender.' : `${left} of ${p.count} still to open`}</p>
        </section>

        {open && <>
          <h1>Say the words to open it</h1>
          <p className="muted">{p.hint ? <>The words are <b>“{p.hint}”</b>. </> : 'The sender told you the words. '}Type the NEAR account that should get your share, press Call, and say the words out loud (or type them). An AI in a NEAR AI enclave checks what you said; the contract pays.</p>
          <label className="hb-acct">Your NEAR account
            <input type="text" value={acct} onChange={(e) => setAcct(e.target.value)} placeholder={p.network === 'mainnet' ? 'alice.near' : 'alice.testnet'} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </label>
          <div className="hb-cta">
            <a className="btn green" href={callUrl}>Call to open it</a>
            {first.wa && <a className="btn white small" href={`https://wa.me/${first.wa}?text=${encodeURIComponent(`open red packet ${p.id}`)}`} target="_blank" rel="noreferrer">Open on WhatsApp</a>}
          </div>
        </>}

        {p.claims.length > 0 && <div className="card rules">
          {p.claims.map((c) => (
            <div className="row" key={c.to}>
              <span>{short(c.to)}{c.luckiest && <b className="hb-lucky"> luckiest</b>}</span>
              <b>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{near(c.near)} NEAR</a> : `${near(c.near)} NEAR`}</b>
            </div>
          ))}
        </div>}

        <p className="muted hb-foot">
          {p.url && <><a href={p.url} target="_blank" rel="noreferrer">How it was funded, on chain</a>. </>}
          Unopened shares go back to the sender {p.expired ? '' : `on ${new Date(p.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}. <a href="/#call">Send one yourself by phone call</a>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
