import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useCall, type Desk } from '../call';
import { Coin, Phone, Wordmark, usd } from '../ui';

// What the page needs from both desks' config files, read on the server.
const getDesks = createServerFn({ method: 'GET' }).handler(async () => {
  const { owner, launchpad, env } = await import('../../src/config.ts');
  const o = owner(), lp = launchpad();
  return { business: o.business, rules: o.rules, kitchen: o.services.find((s) => s.id === 'kitchen') ?? o.services[0], launch: lp.rules, network: env.network, blockedCount: lp.blocked_tickers.length + lp.blocked_names.length };
});
type D = Awaited<ReturnType<typeof getDesks>>;

export const Route = createFileRoute('/')({
  loader: () => getDesks(),
  head: () => ({ meta: [{ title: 'callhand: one number, two desks' }, { name: 'description', content: 'Call one number. The launch desk sets up your memecoin on meme.cooking for you to sign; the business desk quotes a building job from a photo and takes a deposit in any token. Private AI on NEAR, rules in code.' }] }),
  component: Landing,
});

const TRY: Record<Desk | 'auto', string[]> = {
  auto: ['I want to launch a memecoin.', 'My bathroom tap is leaking.'],
  launch: ['It’s a coin about a sleepy otter.', 'Call it Sleepy Otter, ticker ZZZ.', 'Make the ticker NEAR.', 'Will it 100x?', 'One hour, soft cap 100 NEAR.', 'Give me 25% for the team.'],
  business: ['Hi, I need a new kitchen.', 'Medium size, white units.', "I'm Sam, postcode E8 3QP.", 'Can you do 30% off?', 'OK, book it for Tuesday.'],
};
const DESK_LABEL: Record<Desk | 'auto', string> = { auto: 'Let it ask', launch: 'Launch', business: 'Business' };

function Landing() {
  const d = Route.useLoaderData();
  const [pick, setPick] = useState<Desk | 'auto'>('auto');
  const call = useCall(pick);
  const [typed, setTyped] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [call.lines]);
  useReveal();
  const active = call.desk === 'launch' || call.desk === 'business' ? call.desk : pick;
  const kitchen = Math.round(d.kitchen.from_usd + (d.kitchen.to_usd - d.kitchen.from_usd) * 0.5);

  return (
    <>
      <header className="hero">
        <div className="topbar">
          <span className="left">Private AI on NEAR, rules in code</span>
          <Wordmark />
          <a className="right" href="/dashboard">Dashboard</a>
        </div>
        <h1>One call, two desks</h1>
        <p className="sub">Call it, text it or ring it on WhatsApp. The launch desk sets up your memecoin on meme.cooking for you to sign. The business desk quotes a building job from a photo and takes the deposit in any token.</p>

        <div className="folders">
          <a className="folder f1" href="#launch"><span className="tab">Launch desk</span></a>
          <a className="folder f2" href="#ticker"><span className="tab">Try a ticker</span></a>
          <a className="folder f3" href="#business"><span className="tab">Business desk</span></a>
          <section className="folder front" id="call" aria-labelledby="call-h">
            <span className="tab">Call now</span>
            <div className="call">
              <div>
                <div className="desks" role="radiogroup" aria-label="Which desk">
                  {(['auto', 'launch', 'business'] as const).map((k) => (
                    <button key={k} role="radio" aria-checked={pick === k} className={pick === k ? 'on' : ''} disabled={call.live} onClick={() => setPick(k)}>{DESK_LABEL[k]}</button>
                  ))}
                </div>
                <div className="dial">
                  <button className={`mic stk${call.live ? ' end' : ''}`} onClick={call.live ? call.stop : call.start}>
                    <Phone />{call.live ? 'Hang up' : 'Call'}
                  </button>
                  <p className={`state${call.live ? ' on' : ''}`} aria-live="polite"><i />{call.state}</p>
                </div>
                <h2 id="call-h">{active === 'launch' ? 'Launch a coin by talking' : active === 'business' ? `Ring ${d.business.name}` : 'Say what you need'}</h2>
                <p className="who">{active === 'launch'
                  ? `It runs you through name, ticker, logo, auction and caps, then sends a page you sign with your own wallet, on NEAR ${d.network}.`
                  : active === 'business'
                    ? `A sample building firm in ${d.business.area}. Describe the job or send a photo of it.`
                    : 'The first thing you say picks the desk: a coin launch, or building work. Speak, or type if you have no mic.'}</p>
                <div className="calltry">
                  <b>Things to say</b>
                  <div className="chips">
                    {TRY[active].map((t) => (
                      <button key={t} className="chip" onClick={() => (call.live ? call.say(t) : setTyped(t))}>{t}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="phone" data-ui>
                  <div className="head"><b>Live transcript</b><span>{call.desk ? `${call.desk} desk` : 'Whisper hears, Qwen answers, in a TEE'}</span></div>
                  <div className="log" ref={logRef} aria-live="polite">
                    {call.lines.length === 0 && <p className="empty">Press Call. The greeting arrives in a second or two, spoken and written here.</p>}
                    {call.lines.map((l, i) => <div key={i} className={`bubble ${l.who}`}>{l.text}</div>)}
                  </div>
                  <form className="typed" onSubmit={(e) => { e.preventDefault(); if (call.say(typed)) setTyped(''); }}>
                    <label className="vh" htmlFor="typed">Type instead of speaking</label>
                    <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={call.live ? 'Type instead of speaking' : 'Start the call first'} autoComplete="off" />
                    {active !== 'launch' && (
                      <>
                        <input ref={fileRef} className="vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; if (f) call.sendPhoto(f); e.target.value = ''; }} />
                        <button type="button" className="btn small white" disabled={!call.live} onClick={() => fileRef.current?.click()}>Photo</button>
                      </>
                    )}
                    <button className="btn small ink" disabled={!call.live}>Send</button>
                  </form>
                </div>
                {call.link && (
                  <div className="deposit stk">
                    <p>{call.desk === 'launch' ? 'Your launch is ready to check and sign.' : 'Visit booked. The deposit link is ready.'}</p>
                    <a className="btn ink small" href={call.link.url} target="_blank" rel="noreferrer">{call.link.label}</a>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </header>

      <main>
        <section className="field how" id="launch">
          <div className="grow">
            <div className="heading reveal">
              <h2>The launch desk</h2>
              <p className="lead">Talk a memecoin into existence on meme.cooking, NEAR’s fair-launch launchpad. The model asks the questions, code decides what is allowed, and you sign.</p>
            </div>
            <div className="stage s1 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="bubble caller" style={{ maxWidth: '100%', animation: 'none' }}>Call it Sleepy Otter, ticker ZZZ.</div>
                  <div className="bubble agent" style={{ maxWidth: '100%', marginTop: 8, animation: 'none' }}>Nice. What vibe for the logo? <span className="pill ok">TEE-signed</span></div>
                </div>
              </div>
              <h3>It asks</h3>
              <p>Coin, name, ticker, logo vibe, auction length, soft cap, team share, socials. One question at a time, then it reads the lot back.</p>
            </div>
            <div className="stage s2 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="row"><b>set_coin</b><span className="pill warn">Refused</span></div>
                  <div className="row"><span>Ticker</span><b>$NEAR</b></div>
                  <div className="row"><span>Rule</span><b>Existing asset</b></div>
                  <div className="row"><span>Team share asked</span><b>25%, cap {d.launch.max_team_allocation_pct}%</b></div>
                </div>
              </div>
              <h3>It refuses</h3>
              <p>No tickers of real assets, no brands or celebrities ({d.blockedCount} on the list), no ticker already on meme.cooking, team share at most {d.launch.max_team_allocation_pct}% behind a {d.launch.min_cliff_days}-day cliff. Every refusal is logged.</p>
            </div>
            <div className="stage s3 reveal">
              <div className="tile">
                <Coin className="hero-coin" label="ZZZ" />
                <div className="frag" data-ui>
                  <div className="row"><span>Sleepy Otter · $ZZZ</span><span className="pill wait">Waiting for you</span></div>
                  <div className="row"><span>Auction</span><b>1 hour, soft cap 100 NEAR</b></div>
                  <div className="row"><span>Cost</span><b>Asked from the contract</b></div>
                  <div className="row"><span>Signed by</span><b>Your wallet, not ours</b></div>
                </div>
              </div>
              <h3>You sign</h3>
              <p>A link arrives on WhatsApp or in the call. It shows the logo, the terms and the exact NEAR cost. You sign one transaction with Meteor, HOT, Intear or MyNearWallet.</p>
            </div>
          </div>
        </section>

        <Ticker />

        <section className="field how biz" id="business">
          <div className="grow">
            <div className="heading reveal">
              <h2>The business desk</h2>
              <p className="lead">Same engine, a builder’s rules. The customer sends a photo of the job, and the owner sets the rules by talking.</p>
            </div>
            <div className="stage s1 reveal">
              <div className="tile photo">
                <img src="/img/elwood-street-highbury.jpg" alt="A Victorian end-of-terrace house on Elwood Street, Highbury" width="1050" height="1400" loading="lazy" />
                <div className="frag" data-ui>
                  <div className="row"><b>Photo</b><span className="pill ok">Read in a TEE</span></div>
                  <p style={{ margin: '6px 0 0' }}>Bathroom, cracked tiles behind a dripping tap. Looks small.</p>
                </div>
              </div>
              <h3>Photo to quote</h3>
              <p>A vision model in a TEE describes the job. The photo stays on this server.</p>
            </div>
            <div className="stage s2 reveal">
              <div className="tile photo">
                <img src="/img/claw-hammer.jpg" alt="A claw hammer on a wooden plank" width="1400" height="1050" loading="lazy" />
                <div className="frag" data-ui>
                  <div className="row"><b>quote_job</b><span className="pill warn">Refused</span></div>
                  <div className="row"><span>Kitchen, medium, 30% off</span><span>{usd(kitchen)}</span></div>
                  <div className="row"><span>Owner’s limit</span><b>Max {d.rules.max_discount_pct}% off</b></div>
                </div>
              </div>
              <h3>Prices come from code</h3>
              <p>Discounts, deposits and refused work live in owner.yaml. The deposit link takes any token through NEAR Intents, and the owner gets USDC.</p>
            </div>
            <div className="stage s3 reveal">
              <div className="tile photo">
                <img src="/img/kenwood-house-scaffolded.jpg" alt="Kenwood House in Hampstead wrapped in scaffolding" width="1400" height="787" loading="lazy" />
                <div className="frag" data-ui>
                  <div className="bubble caller" style={{ maxWidth: '100%', animation: 'none' }}>Max 15% off from now, and no roofs.</div>
                  <div className="row" style={{ marginTop: 8 }}><span>max discount</span><b>{d.rules.max_discount_pct} → 15</b></div>
                  <div className="row"><span>work refused</span><b>+ roofs</b></div>
                  <div className="row"><span>Hard bounds</span><b>0–30% off, 10–50% deposit</b></div>
                </div>
              </div>
              <h3>The owner talks, the file changes</h3>
              <p>From the owner’s WhatsApp or the dashboard. The agent proposes a diff, code checks it against hard bounds, the owner says yes, and owner.yaml is rewritten.</p>
            </div>
          </div>
        </section>

        <div className="band" aria-hidden="true">
          <div className="track">
            {[0, 1].map((n) => (
              <span key={n}>
                {['NEAR AI Cloud', 'Intel TDX', 'NVIDIA confidential GPUs', 'Qwen', 'Whisper', 'Qwen3-VL', 'FLUX.2', 'meme.cooking', 'Wallet Selector', 'NEAR Intents', 'WhatsApp calls'].map((t) => <span key={t}>{t}</span>)}
              </span>
            ))}
          </div>
        </div>
        <section className="runs reveal">
          <h2>What a call runs on</h2>
          <p>Speech-to-text, the language model, the photo reader and the logo model run in trusted execution environments on NEAR AI Cloud. Each reply carries a signature from the enclave, checked here. Launches go to the meme.cooking contract on NEAR, signed in your own wallet. Deposits route through NEAR Intents 1Click.</p>
        </section>

        <section className="field faq" id="questions">
          <div className="qhead">
            <h2>Fair questions</h2>
            <figure>
              <img src="/img/mozart-terrace.jpg" alt="Mozart Terrace on Ebury Road, Belgravia: brick terraced houses with green shutters" width="1400" height="1050" loading="lazy" />
              <figcaption>Mozart Terrace, Ebury Road: the kind of street the sample building firm works on.</figcaption>
            </figure>
          </div>
          <div className="list reveal">
            {faq(d).map(([q, a], i) => (
              <details key={q} name="faq" open={i === 0}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="foot reveal">
        <div className="t1"><p>callhand is a NEAR hackathon entry. The building firm is a sample set in owner.yaml.</p><small>MIT licence · 2026. Pictures: <a href="https://commons.wikimedia.org/w/index.php?curid=105321989">Elwood Street, Highbury</a> by Jim Osley (CC BY-SA 2.0); <a href="https://www.flickr.com/photos/159630537@N08/28918563378">claw hammer</a> by Homedust (CC BY 2.0); <a href="https://commons.wikimedia.org/w/index.php?curid=106415915">Kenwood House scaffolded</a> by Peter O'Connor (CC BY-SA 2.0); <a href="https://commons.wikimedia.org/w/index.php?curid=3581977">Mozart Terrace</a> by Oosoom (CC BY-SA 3.0).</small></div>
        <div className="t2"><ul><li><a href="#call">Call now</a></li><li><a href="#launch">Launch desk</a></li><li><a href="#ticker">Try a ticker</a></li><li><a href="#business">Business desk</a></li><li><a href="#questions">Questions</a></li></ul></div>
        <div className="t3"><span>Launches go to</span><b>{d.network}</b></div>
        <div className="t4"><span>Memecoins are risky and most lose value. The launch desk never promises returns.</span><span>Rules in launchpad.yaml</span></div>
        <div className="t5"><Wordmark /></div>
        <a className="t6" href="/dashboard"><span>See every call and refusal</span>
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true"><path d="M14 50 50 14M22 14h28v28" /></svg>
        </a>
      </footer>
    </>
  );
}

const faq = (d: D): [string, string][] => [
  ['Does callhand hold my wallet or my money?', 'No. The launch desk prepares a transaction and you sign it in your own wallet on the launch page. The server has no keys. Building deposits go from the customer through NEAR Intents to the owner.'],
  ['Can someone launch $NEAR or an Elon coin?', `No. Tickers of real assets, brand and celebrity names, and tickers already on meme.cooking are refused in code before a launch can be prepared. So are team allocations above ${d.launch.max_team_allocation_pct}%, cliffs under ${d.launch.min_cliff_days} days and vesting under ${d.launch.min_vesting_days} days. Each refusal goes to the ledger on the dashboard.`],
  ['Will it tell me my coin will go up?', 'No. The prompt forbids it, and a filter replaces any reply that promises returns before it is spoken. The replacement is logged. Most memecoins lose value.'],
  ['Who hears the call, and who sees my photo?', 'Whisper transcribes, Qwen answers, Qwen3-VL reads photos and FLUX draws logos, all in TEEs on NEAR AI Cloud. Photos are kept on this server only. The dashboard checks each reply’s signature against the enclave’s attested key.'],
  ['What does a launch cost?', 'The exact NEAR the meme.cooking contract asks for, read from its create_meme_storage_cost view for your account, plus a one-off registration if you are new to it, plus gas. You see it before you sign.'],
  ['Testnet or mainnet?', `This server launches on NEAR ${d.network}. Mainnet is one setting (NETWORK=mainnet). Funding a launch from another chain uses NEAR Intents and works on mainnet only.`],
  ['What doesn’t it do yet?', 'On WhatsApp you can’t interrupt it while it speaks. Without an IPFS key the coin’s description and links stay on our launch page instead of on-chain metadata. The attestation check binds the signing key and our nonce in the TDX quote but does not verify Intel’s signature on the quote itself.'],
];

// The launch desk's ticker rule as a headline you can type into. Same code as the set_coin tool.
function Ticker() {
  const [text, setText] = useState('$NEAR');
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/ticker?ticker=${encodeURIComponent(text)}`, { signal: c.signal }).then((r) => r.json()).then(setRes).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); c.abort(); };
  }, [text]);
  const r = res?.result;
  return (
    <section className="field haggle" id="ticker" aria-labelledby="ticker-h">
      <h2 id="ticker-h" className="ask">Try to launch a ticker</h2>
      <input id="ticker-in" aria-labelledby="ticker-h" data-ui value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" maxLength={16} />
      <div className="answer stk" data-ui aria-live="polite">
        {!r ? <p>Checking the launch desk’s rules…</p> : r.ok ? (
          <>
            <p className="verdict">Allowed</p>
            <div className="row"><span>Ticker</span><b>${r.ticker}</b></div>
            <div className="row"><span>Checked against</span><span>{res.indexed ? `${res.indexed.toLocaleString('en-US')} meme.cooking memes` : 'the blocklist (indexer unreachable)'}</span></div>
          </>
        ) : (
          <>
            <p className="verdict">Refused</p>
            <p>{r.reason}</p>
          </>
        )}
      </div>
      <div className="chips">
        {['$ZZZ', 'USDC', 'ELONCAT', 'otter-2', 'A'].map((t) => (
          <button key={t} className="chip" onClick={() => setText(t)}>{t}</button>
        ))}
      </div>
    </section>
  );
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
