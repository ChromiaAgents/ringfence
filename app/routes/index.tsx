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
  head: () => ({ meta: [{ title: 'Ringfence: your phone number is a crypto wallet' }, { name: 'description', content: 'Call one number and say what you want: send NEAR or ETH on Base. Confirm with a spoken PIN. A NEAR contract you own sets the spending limits, and the AI cannot change them.' }] }),
  component: Landing,
});

const TRY: Record<Desk | 'auto', string[]> = {
  auto: ['Send 0.5 NEAR to alice.near.', 'What is my balance?', 'I want to launch a memecoin.', 'My bathroom tap is leaking.'],
  launch: ['It’s a coin about a sleepy otter.', 'Call it Sleepy Otter, ticker ZZZ.', 'Make the ticker NEAR.', 'Will it 100x?', 'Logo vibe: an otter asleep on a pillow.', 'Yes, set it up.'],
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
          <span className="left">Spending limits on NEAR. AI in sealed hardware.</span>
          <Wordmark />
          <a className="right" href="/dashboard">Dashboard</a>
        </div>
        <h1>Your phone number is a crypto wallet</h1>
        <p className="sub">Call from WhatsApp or the browser and say “send 0.5 NEAR to alice.near” or “send 0.0001 ETH on Base to 0x…”. Confirm with a spoken PIN and it’s sent, but only within limits set in a NEAR contract you own. Worst case, even if we the operator misbehave: your daily cap, and you can revoke us in one transaction. Nothing has been signed on chain yet; this page runs a labelled dry run.</p>

        <div className="folders">
          <a className="folder f1" href="#wallet"><span className="tab">Phone wallet</span></a>
          <a className="folder f2" href="#launch"><span className="tab">Launch a coin</span></a>
          <a className="folder f3" href="#business"><span className="tab">Builder quotes</span></a>
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
                  ? 'It runs you through name, ticker and logo on JustHoot, then sends a page you sign with your own wallet. JustHoot is mainnet only and costs real NEAR.'
                  : active === 'business'
                    ? `A sample building firm in ${d.business.area}. Describe the job or send a photo of it.`
                    : 'The first thing you say picks the desk: send money, launch a coin, or building work. Here, without an agent key, sends are a labelled dry run. Speak, or type if you have no mic.'}</p>
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
                  <div className="head"><b>Live transcript</b><span>{call.desk ? `${call.desk} desk` : 'Speech and replies run in sealed hardware'}</span></div>
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
                    <p>{call.desk === 'launch' ? 'Your launch is ready to check and sign.' : call.desk === 'business' ? 'Visit booked. The deposit link is ready.' : 'Sign this one in your own wallet.'}</p>
                    <a className="btn ink small" href={call.link.url} target="_blank" rel="noreferrer">{call.link.label}</a>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </header>

      <main>
        <section className="field how" id="wallet">
          <div className="grow">
            <div className="heading reveal">
              <h2>Your phone wallet</h2>
              <p className="lead">Bind your NEAR account to your number once. Then send NEAR, or ETH on Base, by voice. The AI asks for the transfer; a NEAR contract you own decides if it is allowed.</p>
            </div>
            <div className="stage s1 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="bubble caller" style={{ maxWidth: '100%', animation: 'none' }}>Send 0.0001 ETH on Base to 0x1111…2222.</div>
                  <div className="bubble agent" style={{ maxWidth: '100%', marginTop: 8, animation: 'none' }}>0.0001 ETH on Base to address 0x1111 ending 2222. Say your PIN to confirm.</div>
                </div>
              </div>
              <h3>It reads it back</h3>
              <p>Amount, asset, chain and recipient, out loud. You confirm with a 4-digit PIN. The PIN is stored only as a salted hash, and 3 wrong tries lock it for 15 minutes.</p>
            </div>
            <div className="stage s2 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="row"><b>transfer_near</b><span className="pill warn">Refused</span></div>
                  <div className="row"><span>Asked</span><b>5 NEAR</b></div>
                  <div className="row"><span>Your limit</span><b>1 per transfer, 3 per day</b></div>
                  <div className="row"><span>New recipient</span><b>Waits 600 s</b></div>
                </div>
              </div>
              <h3>The contract says no</h3>
              <p>Limits per transfer and per day for each asset, a list of allowed chains and saved recipients, and a wait for new ones, all in a NEAR contract. Over a limit, you get a link to sign it yourself.</p>
            </div>
            <div className="stage s3 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="row"><span>Your EVM address</span><b>Same on every EVM chain</b></div>
                  <div className="row"><span>Signed by</span><b>NEAR Chain Signatures</b></div>
                  <div className="row"><span>Checked first</span><b>Chain, recipient, amount</b></div>
                  <div className="row"><span>On by default</span><b>Base</b></div>
                </div>
              </div>
              <h3>One address on Base and other Ethereum-style chains</h3>
              <p>Before NEAR signs, the contract checks the transaction itself: chain, recipient and amount. So only what you heard read back can be signed, and the operator can’t exceed your caps either. Base is on at bind; you allow other chains yourself. Bitcoin and Solana are not supported.</p>
            </div>
          </div>
        </section>

        <section className="field how" id="launch">
          <div className="grow">
            <div className="heading reveal">
              <h2>Also works for: launching a coin</h2>
              <p className="lead">Talk a coin onto JustHoot: one call creates the coin and makes it tradable on RHEA, a NEAR exchange. The model asks the questions, code decides what is allowed, and you sign. It adds voice to JustHoot, an existing launchpad.</p>
            </div>
            <div className="stage s1 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="bubble caller" style={{ maxWidth: '100%', animation: 'none' }}>Call it Sleepy Otter, ticker ZZZ.</div>
                  <div className="bubble agent" style={{ maxWidth: '100%', marginTop: 8, animation: 'none' }}>Nice. What vibe for the logo? <span className="pill ok">Verified private AI</span></div>
                </div>
              </div>
              <h3>It asks</h3>
              <p>Coin, name, ticker, logo vibe, socials. One question at a time, then it reads the lot back.</p>
            </div>
            <div className="stage s2 reveal">
              <div className="tile">
                <div className="frag" data-ui>
                  <div className="row"><b>set_coin</b><span className="pill warn">Refused</span></div>
                  <div className="row"><span>Ticker</span><b>$NEAR</b></div>
                  <div className="row"><span>Rule</span><b>Existing asset</b></div>
                                  </div>
              </div>
              <h3>It refuses</h3>
              <p>No tickers of real assets, no brands or celebrities ({d.blockedCount} on the list), and no promises that the coin will go up. Every refusal is logged.</p>
            </div>
            <div className="stage s3 reveal">
              <div className="tile">
                <Coin className="hero-coin" label="ZZZ" />
                <div className="frag" data-ui>
                  <div className="row"><span>Sleepy Otter · $ZZZ</span><span className="pill wait">Waiting for you</span></div>
                  <div className="row"><span>Pool</span><b>RHEA, from the first block</b></div>
                  <div className="row"><span>Cost</span><b>Asked from the contract</b></div>
                  <div className="row"><span>Signed by</span><b>Your wallet, not ours</b></div>
                </div>
              </div>
              <h3>You sign</h3>
              <p>A link arrives in the call. It shows the logo, the terms and the exact NEAR cost (about 0.1 NEAR, read from the contract). You sign one transaction with Meteor, HOT, Intear or MyNearWallet.</p>
            </div>
          </div>
        </section>

        <Ticker />

        <section className="field how biz" id="business">
          <div className="grow">
            <div className="heading reveal">
              <h2>Also works for: builder quotes</h2>
              <p className="lead">Same line, a builder’s rules. The customer sends a photo of the job, and the owner sets the rules by talking.</p>
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
              <p>An AI running in sealed hardware describes the job. The photo stays on this server.</p>
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
              <p>Discounts, deposits and refused work live in owner.yaml. Customers can pay the deposit in almost any token. NEAR Intents converts it and the owner receives USDC on NEAR.</p>
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
              <p>From the owner’s WhatsApp or the dashboard. The agent proposes the change, code checks it stays within fixed limits, the owner says yes, and owner.yaml is rewritten.</p>
            </div>
          </div>
        </section>

        <div className="band" aria-hidden="true">
          <div className="track">
            {[0, 1].map((n) => (
              <span key={n}>
                {['NEAR smart contracts', 'Chain Signatures', 'Base', 'NEAR AI Cloud', 'Intel TDX', 'NVIDIA confidential GPUs', 'Qwen', 'Whisper', 'JustHoot', 'Wallet Selector', 'NEAR Intents', 'WhatsApp calls'].map((t) => <span key={t}>{t}</span>)}
              </span>
            ))}
          </div>
        </div>
        <section className="runs reveal">
          <h2>What a call runs on</h2>
          <p>Your voice and photos are processed in sealed hardware on NEAR AI Cloud (trusted execution environments, or TEEs). We check its proof live; see /proof. Checking the signature on each chat and photo reply is built, but the live check is still pending.</p><p>Your spending limits live in a NEAR contract you own, so neither the AI nor we can go past them.</p><p>Sends on Base are signed by NEAR Chain Signatures, after the contract has checked the transaction.</p><p>Known limits: this app server is not itself in sealed hardware, Cartesia (if used as the voice) hears reply text, and on WhatsApp Meta sees call metadata.</p>
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
        <div className="t1"><p>Ringfence is a NEAR hackathon entry. The phone-wallet contract is unaudited: keep small amounts in it. The building firm is a sample set in owner.yaml.</p><small>MIT licence · 2026. Pictures: <a href="https://commons.wikimedia.org/w/index.php?curid=105321989">Elwood Street, Highbury</a> by Jim Osley (CC BY-SA 2.0); <a href="https://www.flickr.com/photos/159630537@N08/28918563378">claw hammer</a> by Homedust (CC BY 2.0); <a href="https://commons.wikimedia.org/w/index.php?curid=106415915">Kenwood House scaffolded</a> by Peter O'Connor (CC BY-SA 2.0); <a href="https://commons.wikimedia.org/w/index.php?curid=3581977">Mozart Terrace</a> by Oosoom (CC BY-SA 3.0).</small></div>
        <div className="t2"><ul><li><a href="#call">Call now</a></li><li><a href="/wallet/bind">Bind your number</a></li><li><a href="#wallet">Phone wallet</a></li><li><a href="#launch">Launch a coin</a></li><li><a href="#ticker">Try a ticker</a></li><li><a href="#business">Builder quotes</a></li><li><a href="#questions">Questions</a></li></ul></div>
        <div className="t3"><span>Network</span><b>{d.network}</b></div>
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
  ['Can the AI empty my wallet?', 'No. Transfers go through a NEAR contract you own, which checks a limit per transfer and per day for each asset, the chains you allowed and your saved recipients. New recipients wait 600 seconds, and you can cancel. The AI can only ask; the contract decides.'],
  ['Who holds the keys?', 'You own the contract and can always withdraw or revoke the agent. This server holds one agent key that can only call your contract. Being honest: we, the operator, could use it without your PIN, inside your limits. The PIN protects against someone else calling from your line, not against us. The contract is unaudited, so keep small amounts in it.'],
  ['Who hears my PIN?', 'Speech-to-text and the language model, both inside NEAR AI TEEs. It is stored only as a salted hash and blanked from the saved transcript and tool log. Three wrong tries lock it for 15 minutes.'],
  ['What if someone steals my number?', 'Your number alone cannot move money. Binding is signed by your NEAR account, and a SIM swap or a spoofed caller ID still needs your PIN. Three wrong tries lock it for 15 minutes, so trying every 4-digit PIN takes about 35 days, and even then only your daily cap, to your saved recipients, could move. Revoke the agent from your own wallet if you lose your phone.'],
  ['Which chains?', 'NEAR, and Ethereum-style (EVM) chains through NEAR Chain Signatures. One address works on all of them. Base is on when you bind; you turn on others yourself. Bitcoin, Solana and ERC-20 tokens are not supported yet.'],
  ['Can someone launch $NEAR or an Elon coin?', 'No. Tickers of real assets, brand and celebrity names, and tickers already on meme.cooking are refused in code before a launch can be prepared. Each refusal goes to the ledger on the dashboard. Replies that promise returns are replaced before they are spoken.'],
  ['What does a launch cost?', 'JustHoot asks about 0.1 NEAR, read from its contract’s views, plus gas. JustHoot is mainnet only, so it is real NEAR whatever network this server is on. You see the cost before you sign.'],
  ['Who sees my photo?', 'Qwen3-VL reads it in a TEE on NEAR AI Cloud. The photo is kept on this server only. This server verifies each enclave’s Intel TDX quote and NVIDIA GPU attestation (see /proof).'],
  ['What doesn’t it do yet?', `Nothing has been signed on chain by this code yet: no real transfer, launch or deposit. On WhatsApp you can’t interrupt it while it speaks. With Cartesia as the voice, reply text goes to Cartesia, which is not a TEE. The attestation check does not yet compare enclave measurements to a published NEAR AI build. This server is on NEAR ${d.network}.`],
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
