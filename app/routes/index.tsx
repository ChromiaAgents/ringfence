import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useCall } from '../call';
import { Phone, Wordmark, usd } from '../ui';

// What the page needs from owner.yaml, read on the server.
const getOwner = createServerFn({ method: 'GET' }).handler(async () => {
  const { owner } = await import('../../src/config.ts');
  const o = owner();
  return { business: o.business, rules: o.rules, services: o.services.map((s) => ({ id: s.id, name: s.name, from: s.from_usd, to: s.to_usd })), payout: o.payout.asset_symbol };
});
type O = Awaited<ReturnType<typeof getOwner>>;

export const Route = createFileRoute('/')({
  loader: () => getOwner(),
  head: () => ({ meta: [{ title: 'callhand: the phone, answered' }, { name: 'description', content: 'An AI receptionist for a small building firm: answers the call, quotes inside the owner’s rules, books the visit and takes a deposit in any token.' }] }),
  component: Landing,
});

const TRY = ['Hi, I need a new kitchen.', 'Medium size, white units, oak worktop.', "I'm Sam, postcode E8 3QP.", 'Can you do 30% off?', 'OK, book it for next Tuesday.'];

function Landing() {
  const o = Route.useLoaderData();
  const call = useCall();
  const [typed, setTyped] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [call.lines]);
  useReveal();

  // Sample numbers from the real rules: a medium kitchen, priced the way quote_job prices it.
  const k = o.services.find((s) => s.id === 'kitchen') ?? o.services[0];
  const kitchen = Math.round(k.from + (k.to - k.from) * 0.5);
  const deposit = Math.min(Math.max(Math.round((kitchen * o.rules.deposit_pct) / 100), o.rules.min_deposit_usd), o.rules.max_deposit_usd);

  return (
    <>
      <header className="hero">
        <div className="topbar">
          <span className="left">Answering for {o.business.name}</span>
          <Wordmark />
          <a className="right" href="/dashboard">Owner dashboard</a>
        </div>
        <h1>Never miss the call</h1>
        <p className="sub">callhand answers the phone for a small building firm, quotes inside the owner’s rules, books the site visit and sends a deposit link the customer can pay in any token.</p>

        <div className="folders">
          <a className="folder f1" href="#how"><span className="tab">How it works</span></a>
          <a className="folder f2" href="#haggle"><span className="tab">The {o.rules.max_discount_pct}% rule</span></a>
          <a className="folder f3" href="#questions"><span className="tab">Questions</span></a>
          <section className="folder front" id="call" aria-labelledby="call-h">
            <span className="tab">Call now</span>
            <div className="call">
              <div>
                <div className="dial">
                  <button className={`mic stk${call.live ? ' end' : ''}`} onClick={call.live ? call.stop : call.start}>
                    <Phone />{call.live ? 'Hang up' : 'Call'}
                  </button>
                  <p className={`state${call.live ? ' on' : ''}`} aria-live="polite"><i />{call.state}</p>
                </div>
                <h2 id="call-h">Ring {o.business.name}</h2>
                <p className="who">A sample firm in {o.business.area}. You are the customer; the receptionist works for {o.business.owner}, the owner. Speak, or type if you have no mic.</p>
                <div className="calltry">
                  <b>Things to say</b>
                  <div className="chips">
                    {TRY.map((t) => (
                      <button key={t} className="chip" onClick={() => (call.live ? call.say(t) : setTyped(t))}>{t}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="phone" data-ui>
                  <div className="head"><b>Live transcript</b><span>Whisper hears, Qwen answers, both in a TEE</span></div>
                  <div className="log" ref={logRef} aria-live="polite">
                    {call.lines.length === 0 && <p className="empty">Press Call. The greeting arrives in a second or two, spoken and written here.</p>}
                    {call.lines.map((l, i) => <div key={i} className={`bubble ${l.who}`}>{l.text}</div>)}
                  </div>
                  <form className="typed" onSubmit={(e) => { e.preventDefault(); if (call.say(typed)) setTyped(''); }}>
                    <label className="vh" htmlFor="typed">Type instead of speaking</label>
                    <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={call.live ? 'Type instead of speaking' : 'Start the call first'} autoComplete="off" />
                    <button className="btn small ink" disabled={!call.live}>Send</button>
                  </form>
                </div>
                {call.link && (
                  <div className="deposit stk">
                    <p>Visit booked. The deposit link is ready.</p>
                    <a className="btn ink small" href={call.link} target="_blank" rel="noreferrer">Pay the deposit</a>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </header>

      <main>
        <section className="field how" id="how">
          <div className="grow">
            <div className="heading reveal">
              <h2>One call, three jobs done</h2>
              <p className="lead">The model does the talking. Code decides every price, every discount and every deposit, from the owner’s file.</p>
            </div>
            <div className="stage s1 reveal">
              <div className="tile photo">
                <img src="/img/elwood-street-highbury.jpg" alt="A Victorian end-of-terrace house on Elwood Street, Highbury" width="1050" height="1400" loading="lazy" />
                <div className="frag" data-ui>
                  <div className="bubble caller" style={{ maxWidth: '100%', animation: 'none' }}>Hi, I need a new kitchen.</div>
                  <div className="bubble agent" style={{ maxWidth: '100%', marginTop: 8, animation: 'none' }}>Happy to help. Roughly what size is the room? <span className="pill ok">TEE-signed</span></div>
                </div>
              </div>
              <h3>It answers</h3>
              <p>Whisper turns speech into text and Qwen writes the reply, each inside a TEE on NEAR AI Cloud. Every reply’s signature is checked.</p>
            </div>
            <div className="stage s2 reveal">
              <div className="tile photo">
                <img src="/img/claw-hammer.jpg" alt="A claw hammer on a wooden plank" width="1400" height="1050" loading="lazy" />
                <div className="frag" data-ui>
                  <div className="row"><b>quote_job</b><span className="pill warn">Refused</span></div>
                  <div className="row"><span>Kitchen, medium, 30% off</span><span>{usd(kitchen)}</span></div>
                  <div className="row"><span>Owner’s limit</span><b>Max discount is {o.rules.max_discount_pct}%</b></div>
                </div>
              </div>
              <h3>It quotes within the rules</h3>
              <p>Ask for 30% off and the tool refuses before the model can agree. The limit lives in owner.yaml, not in the prompt.</p>
            </div>
            <div className="stage s3 reveal">
              <div className="tile photo">
                <img src="/img/kenwood-house-scaffolded.jpg" alt="Kenwood House in Hampstead wrapped in scaffolding" width="1400" height="787" loading="lazy" />
                <div className="frag" data-ui>
                  <div className="row"><span>Deposit for your kitchen fitting</span><span className="pill wait">Waiting</span></div>
                  <div className="big">{usd(deposit)}</div>
                  <div className="row"><span>Pay with</span><b>Any token, any chain</b></div>
                  <div className="row"><span>Owner receives</span><b>{usd(deposit)} in {o.payout}</b></div>
                  <div className="row"><span>Route</span><b>NEAR Intents 1Click</b></div>
                </div>
              </div>
              <h3>It books and bills</h3>
              <p>The visit is booked and a deposit link goes out ({o.rules.deposit_pct}% of the quote here). The customer pays in what they hold; the owner gets exact {o.payout}.</p>
            </div>
          </div>
        </section>

        <Haggle max={o.rules.max_discount_pct} services={o.services} />

        <div className="band" aria-hidden="true">
          <div className="track">
            {[0, 1].map((n) => (
              <span key={n}>
                {['NEAR AI Cloud', 'Intel TDX', 'NVIDIA confidential GPUs', 'Qwen', 'Whisper', 'NEAR Intents', '1Click', 'USDC on NEAR', 'WhatsApp calls'].map((t) => <span key={t}>{t}</span>)}
              </span>
            ))}
          </div>
        </div>
        <section className="runs reveal">
          <h2>What a call runs on</h2>
          <p>Speech-to-text and the language model run in trusted execution environments on NEAR AI Cloud, so the call stays private and each reply carries a signature from the enclave. Deposits route through NEAR Intents 1Click. Calls come in from the browser or from WhatsApp.</p>
        </section>

        <section className="field faq" id="questions">
          <div className="qhead">
            <h2>Fair questions</h2>
            <figure>
              <img src="/img/mozart-terrace.jpg" alt="Mozart Terrace on Ebury Road, Belgravia: brick terraced houses with green shutters" width="1400" height="1050" loading="lazy" />
              <figcaption>Mozart Terrace, Ebury Road: the kind of street the sample firm works on.</figcaption>
            </figure>
          </div>
          <div className="list reveal">
            {faq(o).map(([q, a], i) => (
              <details key={q} name="faq" open={i === 0}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="foot reveal">
        <div className="t1"><p>callhand is a NEAR hackathon entry. The business on this page is a sample set in owner.yaml.</p><small>MIT licence · 2026. Pictures: <a href="https://commons.wikimedia.org/w/index.php?curid=105321989">Elwood Street, Highbury</a> by Jim Osley (CC BY-SA 2.0); <a href="https://www.flickr.com/photos/159630537@N08/28918563378">claw hammer</a> by Homedust (CC BY 2.0); <a href="https://commons.wikimedia.org/w/index.php?curid=106415915">Kenwood House scaffolded</a> by Peter O'Connor (CC BY-SA 2.0); <a href="https://commons.wikimedia.org/w/index.php?curid=3581977">Mozart Terrace</a> by Oosoom (CC BY-SA 3.0), via Wikimedia Commons and Flickr.</small></div>
        <div className="t2"><ul><li><a href="#call">Call now</a></li><li><a href="#how">How it works</a></li><li><a href="#haggle">The {o.rules.max_discount_pct}% rule</a></li><li><a href="#questions">Questions</a></li></ul></div>
        <LondonTime />
        <div className="t4"><span>Calls also arrive on WhatsApp, with the same agent and the same rules.</span><span>Setup in the README</span></div>
        <div className="t5"><Wordmark /></div>
        <a className="t6" href="/dashboard"><span>See the owner’s side</span>
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true"><path d="M14 50 50 14M22 14h28v28" /></svg>
        </a>
      </footer>
    </>
  );
}

function LondonTime() {
  const [t, setT] = useState('');
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }));
    f(); const i = setInterval(f, 30000); return () => clearInterval(i);
  }, []);
  return <div className="t3"><span>In London now</span><b>{t || '--:--'}</b></div>;
}

const faq = (o: O): [string, string][] => [
  ['Can the AI give away the business?', `No. Prices come from a tool that reads owner.yaml. Discounts above ${o.rules.max_discount_pct}% are refused in code, deposits are held between $${o.rules.min_deposit_usd} and $${o.rules.max_deposit_usd}, and a kill switch turns the agent into a message-taker.`],
  ['Who hears the call?', 'The audio is transcribed by Whisper and answered by Qwen, both running in TEEs on NEAR AI Cloud. The dashboard checks each reply’s signature against the enclave’s attested key.'],
  ['How does the customer pay?', 'The deposit link opens a page where they pick a token and chain they already hold. NEAR Intents 1Click quotes it and gives a one-off deposit address. Nobody holds the money in between.'],
  ['What does the owner receive?', `Exactly the deposit in ${o.payout}, to their NEAR account. The swap is quoted as exact output, so price moves land on the customer’s side of the quote.`],
  ['Does it work on a real phone line?', 'Yes, through WhatsApp: customers call the business number and the same agent picks up. Browser calls like the one above use the same code.'],
  ['What doesn’t it do yet?', 'On WhatsApp you can’t interrupt it while it speaks. The attestation check confirms the signing key and nonce are bound in the TDX quote but does not verify Intel’s signature on the quote itself.'],
];

function Haggle({ max, services }: { max: number; services: O['services'] }) {
  const [text, setText] = useState('Kitchen, medium, 30% off');
  const [res, setRes] = useState<any>(null);
  const parsed = parse(text, services);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/price?service=${parsed.service}&size=${parsed.size}&discount=${parsed.discount}`, { signal: c.signal })
        .then((r) => r.json()).then(setRes).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); c.abort(); };
  }, [parsed.service, parsed.size, parsed.discount]);
  const r = res?.result;
  const name = services.find((s) => s.id === parsed.service)?.name ?? parsed.service;
  return (
    <section className="field haggle" id="haggle" aria-labelledby="haggle-h">
      <h2 id="haggle-h" className="ask">Try to haggle with it</h2>
      <input id="haggle-in" aria-labelledby="haggle-h" data-ui value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" />
      <div className="answer stk" data-ui aria-live="polite">
        {!r ? <p>Checking the owner’s rules…</p> : r.ok ? (
          <>
            <p className="verdict">Allowed</p>
            <div className="row"><span>{name}, {parsed.size}</span><span>{usd(r.priceUsd)}</span></div>
            <div className="row"><span>Discount</span><span>{r.discountPct}%</span></div>
            <div className="row"><span>Deposit to book</span><b>{usd(r.depositUsd)}</b></div>
          </>
        ) : (
          <>
            <p className="verdict">Refused</p>
            <p>{r.reason}{r.priceUsd ? ` The list price stays ${usd(r.priceUsd)}.` : ''}</p>
          </>
        )}
      </div>
      <div className="chips">
        {['Bathroom, small, 10% off', 'Extension, large', `Kitchen, large, ${max + 5}% off`, 'Repair'].map((t) => (
          <button key={t} className="chip" onClick={() => setText(t)}>{t}</button>
        ))}
      </div>
    </section>
  );
}

function parse(text: string, services: O['services']) {
  const t = text.toLowerCase();
  const s = services.find((x) => t.includes(x.id) || x.name.toLowerCase().split(/\W+/).some((w) => w.length > 4 && t.includes(w)));
  const size = t.includes('small') ? 'small' : t.includes('large') || t.includes('big') ? 'large' : 'medium';
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  return { service: s?.id ?? 'kitchen', size, discount: m ? Number(m[1]) : 0 };
}

// Staggered entrance for each section's parts, once, as it scrolls in. Content stays visible without script.
function useReveal() {
  useEffect(() => {
    document.documentElement.classList.add('js');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
