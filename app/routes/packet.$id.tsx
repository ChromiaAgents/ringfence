// A money packet's page. The page is the packet: a gift card on the left holds the amount, the words to say and how
// many shares are left, and the slip beside it lists who got what. It never shows the words (a demo packet's hint is its words, on
// purpose). Opening happens on a call: the button starts one with this packet, and the account typed here, attached.
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
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.packet ? `A money packet from ${loaderData.packet.from} · Ringfence` : 'Money packet · Ringfence' }] }),
  component: PacketPage,
});

const short = (a: string) => (a.length > 24 ? `${a.slice(0, 9)}…${a.slice(-9)}` : a);
const near = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });

function PacketPage() {
  const first = Route.useLoaderData();
  const { id } = Route.useParams();
  const [p, setP] = useState<Packet | null>(first.packet);
  const [acct, setAcct] = useState('');
  // Shares fill in as people open them.
  useEffect(() => {
    if (!p || p.expired) return;
    const t = setInterval(() => getPacket({ data: p.id }).then((r) => r.packet && setP(r.packet)).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [p?.id, p?.expired]);

  if (!p) return (
    <>
      <main className="app pk">
        <div className="brandrow"><Wordmark /><Makers /></div>
        <div className="pk-grid">
          <section className="pk-card shut" aria-label="An empty money packet">
            <div className="pk-top"><span className="pk-brand">Ringfence</span><span>money packet</span></div>
            <p className="pk-amt">0<span>NEAR</span></p>
            <p className="pk-say"><b>{id === 'demo' ? 'today’s are gone' : 'nothing in here'}</b></p>
            <div className="pk-foot"><span>come back tomorrow</span></div>
          </section>
          <div className="pk-side">
            <h1>{id === 'demo' ? 'Cleaned out.' : 'No packet here.'}</h1>
            <p className="pk-lead">{id === 'demo' ? 'Every demo packet for today got opened. The demo wallet has a daily limit and the contract won’t let it pay more. Come back tomorrow, or send your own.' : 'Check the link. Packets expire a day after they’re sent, and what’s left goes back to the sender.'}</p>
            <a className="btn" href="/#call">Send one by phone call</a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );

  const left = p.count - p.claims.length, done = left === 0, open = !p.expired && !done;
  const rest = Math.max(0, p.near - p.claims.reduce((s, c) => s + c.near, 0));
  const to = acct.trim().toLowerCase();
  const acctOk = /^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|testnet)$|^[0-9a-f]{64}$/.test(to);
  const callUrl = `/?packet=${p.id}${p.hint ? `&say=${encodeURIComponent(p.hint)}` : ''}${acctOk ? `&to=${encodeURIComponent(to)}` : ''}#call`;
  return (
    <>
      <main className="app pk">
        <div className="brandrow"><Wordmark /><Makers /></div>
        <div className="pk-grid">
          <section className={`pk-card${open ? '' : ' shut'}`} aria-label="The money packet">
            <div className="pk-top"><span className="pk-brand">Ringfence</span><span>{p.count} {p.count === 1 ? 'share' : 'shares'}, {p.lucky ? 'lucky split' : 'equal split'}</span></div>
            <p className="pk-amt">{near(p.near)}<span>NEAR</span></p>
            <p className="pk-say">{open ? <>say <b>“{p.hint ?? 'the words'}”</b></> : <b>{done ? 'all gone' : 'expired'}</b>}</p>
            <div className="pk-foot">
              <span>from <b>{short(p.from)}</b></span>
              <span className="pk-left"><span className="pk-dots" role="img" aria-label={`${p.claims.length} of ${p.count} opened`}>{Array.from({ length: p.count }, (_, i) => <i key={i} className={i < p.claims.length ? 'on' : ''} />)}</span>{done ? 'all gone' : p.expired ? 'expired' : `${left} of ${p.count} left`}</span>
            </div>
          </section>

          <div className="pk-side">
            {open ? <>
              <h1>Say the words. Get paid.</h1>
              <label className="pk-blank">Send my share to
                <input type="text" value={acct} onChange={(e) => setAcct(e.target.value)} placeholder={p.network === 'mainnet' ? 'illia.near' : 'illia.testnet'} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={acct !== '' && !acctOk} />
              </label>
              <div className="pk-acts">
                <a className="btn" href={callUrl}>Call and say it</a>
                {first.wa && <a href={`https://wa.me/${first.wa}?text=${encodeURIComponent(`open money packet ${p.id}`)}`} target="_blank" rel="noreferrer">or open it on WhatsApp</a>}
              </div>
              <p className="pk-lead"><b>{short(p.from)}</b> put {near(p.near)} NEAR in here for {p.count} {p.count === 1 ? 'person' : 'people'}. {p.hint ? <>Say <b>“{p.hint}”</b> on a call</> : 'Say the words the sender gave you on a call'} and one share is yours.{p.lucky && p.count > 1 ? ' The contract rolls every share at random, so you might pull dust or most of the packet.' : ''}</p>
              <p className="pk-note">No wallet popup, nothing to sign. An AI running inside a NEAR AI enclave checks what you said and the contract pays your account on NEAR {p.network}. Leave the account blank and the AI will ask for it.</p>
            </> : <>
              <h1>{done ? 'All gone.' : 'Too late.'}</h1>
              <p className="pk-lead">{done ? `All ${p.count} shares got opened. Want to be the one handing them out? It takes one phone call.` : 'This packet expired. What nobody opened went back to the sender.'}</p>
              <div className="pk-acts"><a className="btn" href="/#call">Send one by phone call</a></div>
            </>}
            {p.dryRun && <p className="pk-note pk-dry"><b>Dry run.</b> This server has no keys, so the packet holds play money. The split works exactly like the contract’s.</p>}

            <section className="pk-slip" aria-labelledby="pk-who">
              <h2 id="pk-who">Who got what</h2>
              {p.claims.length === 0 && <p className="pk-row"><span>Nobody yet</span><i /><b>be first</b></p>}
              {p.claims.map((c) => (
                <p className="pk-row" key={c.to}>
                  <span>{short(c.to)}{c.luckiest && <em>top</em>}</span><i />
                  <b>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{near(c.near)} NEAR</a> : `${near(c.near)} NEAR`}</b>
                </p>
              ))}
              <p className="pk-total"><span>{done ? 'Every share opened' : p.expired ? 'Sent back to the sender' : `${left} of ${p.count} still inside`}</span><b>{p.expired && !done ? '' : `${near(rest)} NEAR`}</b></p>
            </section>
            <p className="pk-note">
              {!p.expired && <>Whatever nobody opens goes back to {short(p.from)} on {new Date(p.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. </>}
              {p.url && <><a href={p.url} target="_blank" rel="noreferrer">See it funded on chain</a>. </>}
              <a href="/#call">Send your own by phone call</a>.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
