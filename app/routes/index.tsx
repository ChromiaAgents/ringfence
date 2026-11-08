import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useCall, type Desk } from '../call';
import { CODE_URL, Phone, SiteFooter, Wordmark } from '../ui';

// What the page needs from the config, read on the server.
const getInfo = createServerFn({ method: 'GET' }).handler(async () => {
  const { owner, env } = await import('../../src/config.ts');
  return { business: owner().business.name, network: env.network };
});

export const Route = createFileRoute('/')({
  loader: () => getInfo(),
  head: () => ({ meta: [{ title: 'Ringfence: call to pay, inside your limits' }, { name: 'description', content: 'Call one number and say "send 0.5 NEAR to alice.near". Confirm with a spoken PIN. A NEAR contract you own decides what the AI may spend, on NEAR and Base.' }] }),
  component: Landing,
});

const WA_URL = 'https://wa.me/15551444220?text=hi';
const WA_SHORT = '(test number: ask us to add yours).';
const i = (n: number) => ({ '--i': n }) as CSSProperties;

const TRY: Record<Desk | 'auto', string[]> = {
  auto: ['Send 0.5 NEAR to alice.near.', 'What is my balance?', 'I want to launch a memecoin.', 'I need a new kitchen.'],
  launch: ['It’s a coin about a sleepy otter.', 'Call it Sleepy Otter, ticker ZZZ.', 'Make the ticker NEAR.', 'Yes, set it up.'],
  business: ['Hi, I need a new kitchen.', 'My name is Sam Lee, postcode E1 6AN.', 'Can you do 30% off?', 'OK, book it for Tuesday.'],
};
const DESK_LABEL: Record<Desk | 'auto', string> = { auto: 'Let it ask', launch: 'Launch a coin', business: 'Builder' };

function Landing() {
  const d = Route.useLoaderData();
  useReveal();
  // The dial loops only when motion is welcome; under reduced motion it stays on its poster.
  const vidRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = vidRef.current, mq = matchMedia('(prefers-reduced-motion: reduce)');
    if (!v) return;
    const sync = () => { if (mq.matches) v.pause(); else v.play().catch(() => {}); };
    sync(); mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return (
    <div className="dr">
      <header className="hero">
        <nav className="bar rise" aria-label="Ringfence">
          <Wordmark />
          <span className="live">Live: browser call</span>
          <span className="sp" />
          <a className="code" href={CODE_URL}>Code</a>
          <a className="btn" href="#call" onClick={tryCall}>Try a call</a>
        </nav>

        <div className="title">
          <h1 className="rise">Call to pay. Your contract caps the AI.</h1>
          <div className="lede">
            <p className="rise" style={i(1)}>Say “send 0.5 NEAR to alice.near” on a call. An AI reads it back and takes your spoken PIN, and a NEAR contract you own decides what it may spend, on NEAR and Base.</p>
            <p className="worst rise" style={i(2)}><b>Worst case, even if we misbehave:</b> your daily limit, to saved recipients only. One <code>revoke_agent</code> ends it.</p>
            <div className="acts rise" style={i(3)}>
              <a className="btn" href="#call" onClick={tryCall}>Try a call in your browser</a>
              <span>Built at the NEAR hackathon</span>
            </div>
            <p className="wa-note rise" style={i(4)}><a href={WA_URL} target="_blank" rel="noopener">Message on WhatsApp</a> {WA_SHORT}</p>
          </div>
        </div>

        <div className="sheet">
          <div className="run c2 rise">
            <span className="cap">The call</span>
            <LiveCall network={d.network} business={d.business} />
          </div>
          <div className="run c1 rise" style={i(2)}>
            <span className="cap">Your PIN</span>
            <Keypad />
          </div>
          <div className="run c2 rise" style={i(3)}>
            <span className="cap">Your contract, example day</span>
            <div data-ui>
              <div className="ui-head"><b>phone.you.near</b><span className="muted">mainnet defaults</span></div>
              <div className="ui-body">
                <Meter label="This transfer" value="0.5 of 1 NEAR" w={50} />
                <Meter label="Today" value="1.5 of 3 NEAR" w={50} gold />
                <div className="kv"><span>Base, per transfer / day</span><span>0.0005 / 0.002 ETH</span></div>
                <div className="kv"><span>New recipients</span><span>you sign; contract holds 600 s</span></div>
                <div className="kv"><span>Owner can</span><span>withdraw, revoke_agent</span></div>
              </div>
            </div>
          </div>
          <div className="run c2 rise" style={i(4)}>
            <span className="cap">Base, read from the bytes</span>
            <div data-ui>
              <div className="ui-head"><b>Unsigned EIP-1559 transfer</b><span className="muted">checked</span></div>
              <div className="ui-body">
                <div className="kv"><span>Chain id</span><span>8453, Base, allowed</span></div>
                <div className="kv"><span>To</span><span>0x1111…2222</span></div>
                <div className="kv"><span>Value</span><span>0.0001 of 0.0005 ETH</span></div>
                <div className="kv"><span>Calldata, access list</span><span>none</span></div>
                <div className="kv"><span>Then</span><span className="ok">Chain Signatures signs</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="say-sec" id="say" aria-labelledby="say-h">
          <figure className="rise">
            <video ref={vidRef} muted loop playsInline poster="/media/rotary-dial-dialing-back-with-leds-poster.jpg" width={1280} height={720} aria-label="A rotary dial turning back after a digit">
              <source src="/media/rotary-dial-dialing-back-with-leds.webm" type="video/webm" />
            </video>
            <figcaption>A rotary dial returning after each digit.</figcaption>
          </figure>
          <div className="txt">
            <h2 id="say-h" className="rise">Things to say on the line</h2>
            <ul>
              {SAY.map(([t, s], n) => <li key={t} className="rise" style={i(n + 1)}>{t}<span>{s}</span></li>)}
            </ul>
          </div>
        </section>

        <Stages />
        <Fence />

        <section className="proof" id="proof" aria-label="Proof">
          <div className="names rise">
            <h2>It runs on</h2>
            <ul>{['NEAR', 'Chain Signatures', 'NEAR AI Cloud', 'Intel TDX', 'NVIDIA NRAS', 'Base'].map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
          <Evidence />
        </section>

        <section className="faq" id="faq" aria-labelledby="faq-h">
          <h2 id="faq-h" className="rise">Fair questions</h2>
          <dl>
            {FAQ.map(([q, a]) => <Qa key={q} q={q} a={a} />)}
          </dl>
        </section>

        <section className="cta" aria-labelledby="cta-h">
          <div className="say">
            <h2 id="cta-h" className="rise">Open the line in your browser and ask it to send 0.5 NEAR.</h2>
            <div className="acts rise" style={i(1)}>
              <a className="btn" href="#call" onClick={tryCall}>Try a call</a>
              <a href="/proof">Read the proof</a>
              <a href={WA_URL} target="_blank" rel="noopener">Message on WhatsApp</a>
            </div>
            <p className="wa-note rise" style={i(2)}>WhatsApp is on a test number for now: ask us to add yours.</p>
          </div>
          <figure className="rise" style={i(2)}><img src="/media/concourse.jpg" width={1600} height={1000} alt="A dark concourse with escalators rising toward lit glass" loading="lazy" /></figure>
        </section>
      </main>

      <SiteFooter credits={<>Pictures: “1940s N935 telephone exchange” by Rodhullandemu, <a href="https://commons.wikimedia.org/w/index.php?curid=66686359">CC BY-SA 4.0</a>; “WAC telephone switchboard operators” by PhotosNormandie, <a href="https://commons.wikimedia.org/w/index.php?curid=131249837">CC BY-SA 2.0</a>; “Rotary Dial, Dialing Back with LEDs” by Mark Fickett, <a href="https://commons.wikimedia.org/wiki/File:Rotary_Dial,_Dialing_Back_with_LEDs.ogv">CC BY 3.0</a>; concourse by Erez Attias, Unsplash licence. Type: Switzer by Indian Type Foundry.</>} />
    </div>
  );
}

// "Try a call": bring the call card into view and start it (the click is the user gesture the mic prompt needs).
function tryCall(e: MouseEvent) {
  e.preventDefault();
  const el = document.getElementById('call');
  el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el?.dispatchEvent(new CustomEvent('ringfence:start'));
}

const Meter = ({ label, value, w, gold }: { label: string; value: string; w: number; gold?: boolean }) => (
  <div className="meter-row"><div className="lab"><span>{label}</span><span>{value}</span></div><div className="meter"><i className={gold ? 'gold' : ''} style={{ width: `${w}%` }} /></div></div>
);

// ---------- the real browser call (app/call.ts), in the dark-room card ----------
function LiveCall({ network, business }: { network: string; business: string }) {
  const [pick, setPick] = useState<Desk | 'auto'>('auto');
  const call = useCall(pick);
  const [typed, setTyped] = useState('');
  const [secs, setSecs] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const startRef = useRef(call.start);
  startRef.current = call.live ? async () => {} : call.start;
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [call.lines, call.link]);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const go = () => startRef.current();
    el.addEventListener('ringfence:start', go);
    return () => el.removeEventListener('ringfence:start', go);
  }, []);
  useEffect(() => {
    if (!call.live) return;
    const t0 = Date.now();
    setSecs(0);
    const t = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [call.live]);
  const active = call.desk === 'launch' || call.desk === 'business' ? call.desk : pick;
  const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const linkNote = call.desk === 'launch' ? 'Your launch is ready to check and sign.' : call.desk === 'business' ? 'Visit booked. The deposit link is ready.' : 'Sign this one in your own wallet.';

  return (
    <div data-ui className="callui" id="call" ref={cardRef} aria-label="Browser call to Ringfence">
      <div className="ui-head">
        <b><span className={`live-dot${call.live ? ' on' : ''}`} />Browser call</b>
        <span className="st" aria-live="polite">{call.live ? `${call.state} · ${clock}` : call.lines.length ? call.state : 'Sample call · 00:02'}</span>
      </div>
      <div className="ui-body tx" ref={logRef} aria-live="polite">
        {call.lines.length === 0 && !call.live && <SampleCall />}
        {call.lines.map((l, n) => (
          <div key={n} className={`msg ${l.who === 'caller' ? 'you' : l.who === 'agent' ? 'agent' : 'sys'}`}>
            <span className="who">{l.who === 'caller' ? 'You' : l.who === 'agent' ? 'Ringfence' : 'Line'}</span>{l.text}
          </div>
        ))}
      </div>
      {call.link && (
        <div className="signlink"><span>{linkNote}</span><a href={call.link.url} target="_blank" rel="noreferrer">{call.link.label}</a></div>
      )}
      <div className="dial">
        <button type="button" className={`call-btn${call.live ? ' end' : ''}`} onClick={call.live ? call.stop : call.start}><Phone />{call.live ? 'Hang up' : 'Call'}</button>
        <div className="desks" role="radiogroup" aria-label="Which desk">
          {(['auto', 'launch', 'business'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={pick === k} disabled={call.live} onClick={() => setPick(k)}>{k === 'business' ? business : DESK_LABEL[k]}</button>
          ))}
        </div>
      </div>
      {!call.live && !call.lines.length && <p className="help">Press Call, then speak or type. NEAR {network}; sends stop at a labelled dry run.</p>}
      {(call.live || call.lines.length > 0) && <>
      <div className="tries" role="group" aria-label="Things to say">
        {TRY[active].map((t) => <button key={t} type="button" onClick={() => (call.live ? call.say(t) : setTyped(t))}>{t}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (call.say(typed)) setTyped(''); }}>
        <label className="vh" htmlFor="typed">Type instead of speaking</label>
        <input id="typed" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={call.live ? 'Type instead of speaking' : 'No mic? Start the call, then type'} autoComplete="off" />
        {active !== 'launch' && (
          <>
            <input ref={fileRef} className="vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; if (f) call.sendPhoto(f); e.target.value = ''; }} />
            <button type="button" className="mini" disabled={!call.live} onClick={() => fileRef.current?.click()}>Photo</button>
          </>
        )}
        <button className="mini go" disabled={!call.live}>Send</button>
      </form>
      </>}
    </div>
  );
}

// What the card shows before the first call: the call it will make, played out (as in the approved design).
const SampleCall = () => (
  <>
    <div className="msg you" style={{ animation: 'none' }}><span className="who">You</span>Send 0.5 NEAR to alice.near.</div>
    <div className="msg agent" style={{ animation: 'none' }}><span className="who">Ringfence</span>0.5 NEAR to alice.near, a saved recipient. Say your PIN to confirm.</div>
    <div className="msg you" style={{ animation: 'none' }}><span className="who">You</span><span className="pins"><i /><i /><i /><i /></span> <span className="muted">PIN blanked from the transcript</span></div>
    <div className="msg sys" style={{ animation: 'none' }}><span className="who">phone.you.near</span>Within 1 NEAR per transfer and 3 per day. <code>transfer_near</code> sends; the explorer link follows.</div>
  </>
);

// The PIN pad: an illustration of the spoken PIN (keys light in a loop; nothing here is typed or sent).
function Keypad() {
  const [lit, setLit] = useState<{ n: number; key: string | null }>({ n: 0, key: null });
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pin = ['7', '3', '9', '1'];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (f: () => void, ms: number) => timers.push(setTimeout(f, ms));
    let k = 0;
    const tick = () => {
      if (k < 4) { setLit({ n: k + 1, key: pin[k] }); k++; later(() => setLit((l) => ({ ...l, key: null })), 380); later(tick, 500); }
      else later(() => { k = 0; setLit({ n: 0, key: null }); later(tick, 900); }, 5000);
    };
    later(() => { setLit({ n: 0, key: null }); tick(); }, 2400);
    return () => timers.forEach(clearTimeout);
  }, []);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''];
  return (
    <div data-ui className="keypad" aria-label="Illustration of a spoken 4-digit PIN">
      <div className="ui-head"><b>Spoken PIN</b></div>
      <div className="ui-body">
        <div className="dots">{[0, 1, 2, 3].map((n) => <i key={n} className={n < lit.n ? 'f' : ''} />)}</div>
        <div className="keys" aria-hidden="true">{keys.map((k, n) => <span key={n} className={k && k === lit.key ? 'hit' : ''}>{k}</span>)}</div>
        <p className="note">3 wrong tries lock it for 15 minutes.</p>
      </div>
    </div>
  );
}

const SAY: [string, string][] = [
  ['Send 0.5 NEAR to alice.near', 'Read back, PIN, then your contract checks it.'],
  ['Send 0.0001 ETH on Base to 0x…', 'The contract reads the transaction bytes first.'],
  ['What’s my balance?', 'Read only; nothing is signed.'],
  ['Launch a coin about my cat', 'On JustHoot, signed in your own wallet.'],
  ['I need a new kitchen', 'A sample builder’s desk quotes from a photo.'],
];

// ---------- how it works: drag through the stages ----------
const Msg = ({ who, children }: { who: 'you' | 'agent'; children: ReactNode }) => (
  <div className={`msg ${who}`} style={{ animation: 'none' }}><span className="who">{who === 'you' ? 'You' : 'Ringfence'}</span>{children}</div>
);
const STAGES: { name: string; c: string; t: string; ui: ReactNode }[] = [
  { name: 'Call', c: 'First, you call the line', t: 'From WhatsApp, or from the browser on this page. You bind your NEAR account to your number once, signing with your own wallet.',
    ui: <><div className="ui-head"><b><span className="live-dot on" />Browser call</b><span className="muted">connected</span></div><div className="ui-body tx"><Msg who="agent">Hi, it’s Ringfence. What would you like to do?</Msg><Msg who="you">Send 0.5 NEAR to alice.near.</Msg></div></> },
  { name: 'Read back', c: 'Then it reads it back', t: 'Amount, asset, chain and recipient, out loud. If anything is wrong you say so before a single digit of your PIN.',
    ui: <><div className="ui-head"><b>Read back</b><span className="muted">wallet desk</span></div><div className="ui-body tx"><Msg who="agent">0.5 NEAR to alice.near, a saved recipient. Say your PIN to confirm.</Msg><div className="kv"><span>Amount</span><span>0.5 NEAR</span></div><div className="kv"><span>Recipient</span><span>alice.near, saved</span></div></div></> },
  { name: 'PIN', c: 'Next, you say your PIN', t: 'Four digits, heard only inside NEAR AI TEEs, stored as a salted hash and blanked from the transcript. Three wrong tries lock it for 15 minutes.',
    ui: <><div className="ui-head"><b>Spoken PIN</b><span className="muted">try 1 of 3</span></div><div className="ui-body keypad"><div className="dots"><i className="f" /><i className="f" /><i className="f" /><i className="f" /></div><div className="kv"><span>Stored as</span><span>salted scrypt hash</span></div><div className="kv"><span>In the transcript</span><span>blanked</span></div><div className="kv"><span>After 3 wrong tries</span><span>locked 15 min</span></div></div></> },
  { name: 'Contract', c: 'Last, your contract decides', t: 'The AI only asks. Your phone-wallet contract checks the limits and the recipient, then sends; the explorer link arrives in the call.',
    ui: <><div className="ui-head"><b>phone.you.near</b><span className="muted">transfer_near</span></div><div className="ui-body"><Meter label="This transfer" value="0.5 of 1 NEAR" w={50} /><Meter label="Today" value="0.5 of 3 NEAR" w={17} gold /><div className="kv"><span>Recipient</span><span>alice.near, saved</span></div><div className="kv"><span>Result</span><span>sent, link in the call</span></div></div></> },
];

function Stages() {
  const [cur, setCur] = useState(0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (cur === shown) return;
    const t = setTimeout(() => setShown(cur), 200);
    return () => clearTimeout(t);
  }, [cur, shown]);
  const s = STAGES[shown];
  const f = cur !== shown ? ' fade' : '';
  return (
    <section className="stages" id="how" aria-label="How a call becomes a transfer">
      <div className="left">
        <h2 className={`clause rise${f}`}>{s.c}</h2>
        <p className={`rise${f}`} style={i(1)}>{s.t}</p>
      </div>
      <div className="right">
        <div data-ui className={`stage-ui${f}`}>{s.ui}</div>
      </div>
      <div className="slider">
        <div className="rng" style={{ '--p': `${(cur / 3) * 100}%` } as CSSProperties}>
          <input type="range" min={0} max={3} step={1} value={cur} onChange={(e) => setCur(+e.target.value)} aria-label="Stage of the call" aria-valuetext={STAGES[cur].name} />
        </div>
        <div className="stage-names">
          {STAGES.map((x, n) => <button key={x.name} type="button" className={n === cur ? 'on' : ''} onClick={() => setCur(n)}>{x.name}</button>)}
        </div>
      </div>
    </section>
  );
}

// ---------- features: a demo of the contract's rules (not anyone's real wallet) ----------
// Mirrors contracts/phone-wallet/src/lib.rs and src/desks/wallet.ts with the mainnet default limits. For a recipient
// you haven't saved, the voice agent doesn't send at all: on NEAR it texts you a link to sign it in your own wallet,
// on Base it asks you to save the address first. The contract's 600 s queue is the backstop if the agent key ever
// asks for a new recipient directly.
const LIM = { near: { tx: 1, day: 3, unit: 'NEAR', dp: 1 }, base: { tx: 0.0005, day: 0.002, unit: 'ETH', dp: 4 } };
type Chain = keyof typeof LIM;

function Seg<T extends string | number>({ label, value, set, opts }: { label: string; value: T; set: (v: T) => void; opts: [T, string][] }) {
  return (
    <div className="ctl"><span className="lbl">{label}</span><div className="seg" role="group" aria-label={label}>
      {opts.map(([v, t]) => <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => set(v)}>{t}</button>)}
    </div></div>
  );
}

function Fence() {
  const [amt, setAmt] = useState(5);
  const [spent, setSpent] = useState(0);
  const [rec, setRec] = useState<'saved' | 'new'>('saved');
  const [chain, setChain] = useState<Chain>('near');
  const [revoked, setRevoked] = useState(false);
  const l = LIM[chain];
  const a = chain === 'near' ? amt / 10 : amt * 0.0001;
  const after = spent * l.day + a;
  const fmt = (v: number) => String(+v.toFixed(l.dp));
  const to = rec === 'saved' ? (chain === 'near' ? 'alice.near' : '0x1111…2222') : (chain === 'near' ? 'bob.near' : '0x9999…0001');
  const overNext = chain === 'near' ? ' The agent texts you a link to sign it yourself.' : ' Raise the limit on your wallet page if you mean it.';
  let big: string, cls: string, why: string, sign: string;
  sign = chain === 'near' ? 'agent key, inside your limits' : 'Chain Signatures, after the bytes check';
  if (revoked) { big = 'Refused'; cls = 'no'; why = 'The agent is revoked. Nothing it asks can move funds; withdraw still works for you.'; sign = 'nobody: the agent is revoked'; }
  else if (a > l.tx + 1e-12) { big = 'Refused'; cls = 'no'; why = `Over ${l.tx} ${l.unit} per transfer.${overNext}`; }
  else if (after > l.day + 1e-12) { big = 'Refused'; cls = 'no'; why = `Over ${l.day} ${l.unit} today.${overNext}`; }
  else if (rec === 'new' && chain === 'near') { big = 'You sign it'; cls = 'wait'; why = 'The AI won’t send to a new recipient. It texts you a link to sign it in your own wallet; the contract would hold an agent transfer here 600 s anyway.'; sign = 'you, in your own wallet'; }
  else if (rec === 'new') { big = 'Refused'; cls = 'no'; why = 'Not on your saved list. Save the address on your wallet page first; the contract would hold it 600 s anyway.'; }
  else { big = 'Allowed'; cls = 'yes'; why = chain === 'near' ? 'Inside both limits, to a saved recipient. Sent now.' : 'Chain, recipient and value read from the transaction bytes match what you heard. Signed and sent.'; }

  return (
    <section className="fence" id="limits" aria-labelledby="fence-h">
      <div className="out">
        <div data-ui className="verdict" aria-live="polite">
          <div className="ui-head"><b>phone.you.near</b><span className="muted">{chain === 'near' ? 'NEAR' : 'Base, chain 8453'}</span></div>
          <div className="ui-body">
            <span className="muted" style={{ fontSize: 14 }}>Agent asks: {fmt(a)} {l.unit} to {to}</span>
            <div key={big} className={`big ${cls} pulse`}>{big}</div>
            <p className="why">{why}</p>
            <div style={{ marginTop: 12 }}><Meter label="This transfer" value={`${fmt(a)} of ${l.tx} ${l.unit}`} w={Math.min(100, (a / l.tx) * 100)} /></div>
            <Meter label="Today, after this" value={`${fmt(Math.min(after, 99))} of ${l.day} ${l.unit}`} w={Math.min(100, (after / l.day) * 100)} gold />
            <div className="kv"><span>Recipient</span><span>{to}{rec === 'saved' ? ', saved' : ', new'}</span></div>
            <div className="kv"><span>Signed by</span><span>{sign}</span></div>
          </div>
        </div>
      </div>
      <div className="col">
        <h2 id="fence-h" className="rise">Set your own fence.</h2>
        <p className="demo-note rise">A demo of the contract’s rules with mainnet defaults. Nothing here touches a chain.</p>
        <div className="blk rise">
          <h3>Every transfer has a ceiling.</h3>
          <p>The mainnet default is 1 NEAR per transfer. Over it, the agent says so and texts you a link to sign it yourself.</p>
          <div className="ctl"><label htmlFor="amt">Amount: <output htmlFor="amt">{fmt(a)} {l.unit}</output></label>
            <div className="rng" style={{ '--p': `${((amt - 1) / 19) * 100}%` } as CSSProperties}><input type="range" id="amt" min={1} max={20} step={1} value={amt} onChange={(e) => setAmt(+e.target.value)} /></div>
          </div>
        </div>
        <div className="blk rise">
          <h3>Every day has one too.</h3>
          <p>3 NEAR a day per asset. If we, the operator, ever misbehaved, this is the most that could move.</p>
          <Seg label="Already sent today" value={spent} set={setSpent} opts={[[0, 'Nothing'], [0.4, 'Some'], [0.9, 'Nearly all']]} />
        </div>
        <div className="blk rise">
          <h3>Strangers need your signature.</h3>
          <p>Saved recipients go instantly. For a new one the AI texts you a link to sign in your own wallet; the contract would hold it 600 seconds anyway.</p>
          <Seg label="Recipient" value={rec} set={setRec} opts={[['saved', `${chain === 'near' ? 'alice.near' : '0x1111…2222'} (saved)`], ['new', `${chain === 'near' ? 'bob.near' : '0x9999…0001'} (new)`]]} />
        </div>
        <div className="blk rise">
          <h3>Base, checked byte by byte.</h3>
          <p>Before NEAR Chain Signatures signs, the contract reads chain, recipient and value from the unsigned EIP-1559 transaction itself. Only what you heard read back can be signed.</p>
          <Seg label="Chain" value={chain} set={setChain} opts={[['near', 'NEAR'], ['base', 'Base']]} />
        </div>
        <div className="blk rise">
          <h3>One transaction switches the AI off.</h3>
          <p><code>revoke_agent</code> ends it. <code>withdraw</code> always works, and the AI can never be the owner.</p>
          <div className="ctl"><label className="switch"><input type="checkbox" checked={revoked} onChange={(e) => setRevoked(e.target.checked)} /> Call revoke_agent</label></div>
        </div>
      </div>
    </section>
  );
}

// ---------- proof: index with preview ----------
function Evidence() {
  const [p, setP] = useState('tee');
  const on = (k: string) => ({ onMouseEnter: () => setP(k), onFocus: () => setP(k) });
  return (
    <div className="evidence">
      <h2 className="rise">What is verified, and what is not yet.</h2>
      <p className="sub rise">The pending rows fill in as mainnet transactions land.</p>
      <div className="ev-list" onMouseLeave={() => setP('tee')}>
        <a className="ev-row rise" href="/proof" {...on('tee')}><span className="what">Private AI attestation</span><span className="st ok">4/4 models fully verified</span><span className="detail">Intel TDX quote, key and nonce binding, NVIDIA GPUs through NRAS, checked live on /proof.</span></a>
        <a className="ev-row rise" href={CODE_URL} {...on('room')}><span className="what">Contract and app tests</span><span className="st ok">Passing</span><span className="detail">23 contract unit tests and a sandbox test; 27 app tests; a 9-step dry run with no keys.</span></a>
        <div className="ev-row pending rise" tabIndex={0} {...on('meter')}><span className="what">Phone wallet created on mainnet</span><span className="st">Pending</span><span className="detail">The nearblocks link goes here once the team runs it.</span></div>
        <div className="ev-row pending rise" tabIndex={0} {...on('call')}><span className="what">A NEAR transfer by voice and PIN</span><span className="st">Pending</span><span className="detail">Nothing has been signed on chain yet. The page will show the transaction, not a promise.</span></div>
        <div className="ev-row pending rise" tabIndex={0} {...on('exchange')}><span className="what">A Base transfer through Chain Signatures</span><span className="st">Pending</span><span className="detail">The nearblocks and basescan links go here together.</span></div>
        <div className="ev-row pending rise" tabIndex={0} {...on('tee')}><span className="what">A coin launched on JustHoot</span><span className="st">Pending</span><span className="detail">Token and RHEA pool in one call, about 0.1 NEAR, signed in your own wallet.</span></div>
      </div>
      <div className="ev-frame" aria-hidden="true">
        <img className={p === 'room' ? 'on' : ''} src="/media/wac-telephone-switchboard-operators.jpg" width={1920} height={1476} alt="" loading="lazy" />
        <img className={p === 'exchange' ? 'on' : ''} src="/media/1940s-n935-telephone-exchange.jpg" width={1920} height={1801} alt="" loading="lazy" />
        <div className={`pane${p === 'tee' ? ' on' : ''}`}><div data-ui><div className="ui-head"><b>/proof</b><span className="muted">checked live</span></div><div className="ui-body">
          {['Chat model', 'Speech to text', 'Vision', 'Image', 'Intel TDX quote', 'NVIDIA GPUs via NRAS'].map((k) => <div key={k} className="kv"><span>{k}</span><span>verified</span></div>)}
        </div></div></div>
        <div className={`pane${p === 'meter' ? ' on' : ''}`}><div data-ui><div className="ui-head"><b>phone.you.near</b><span className="muted">pending</span></div><div className="ui-body">
          <div className="kv"><span>Owner</span><span>you.near</span></div>
          <div className="kv"><span>Per transfer / day</span><span>1 / 3 NEAR</span></div>
          <div className="kv"><span>Explorer</span><span>link pending</span></div>
        </div></div></div>
        <div className={`pane${p === 'call' ? ' on' : ''}`}><div data-ui><div className="ui-head"><b>Browser call</b><span className="muted">dry run</span></div><div className="ui-body tx">
          <div className="msg you" style={{ animation: 'none' }}><span className="who">You</span>Send 1 NEAR to bob.near.</div>
          <div className="msg sys" style={{ animation: 'none' }}><span className="who">Result</span>Stopped before signing: DRY RUN.</div>
        </div></div></div>
      </div>
    </div>
  );
}

const Qa = ({ q, a }: { q: string; a: ReactNode }) => (<><dt className="rise">{q}</dt><dd className="rise" style={i(1)}>{a}</dd></>);
const FAQ: [string, ReactNode][] = [
  ['What’s the worst case if you misbehave?', <>We hold the agent key, so we could spend without your PIN, but only up to your daily limit, to recipients you saved. The AI won’t send to a new recipient: you sign that in your own wallet, and the contract holds any agent attempt for 600 s so you can cancel it. One <code>revoke_agent</code> ends it, and <code>withdraw</code> always works.</>],
  ['Can the AI be talked into more?', 'It can only ask. The contract checks the limits, the chain and the recipient, and for Base it reads the transaction bytes itself before anything is signed.'],
  ['Who hears my PIN?', 'Speech-to-text and the model, inside NEAR AI TEEs. It is stored only as a salted hash and blanked from the transcript. Three wrong tries lock it for 15 minutes. Our app server itself is not attested.'],
  ['Is my voice private?', 'Chat, speech-to-text, vision and image models run on NEAR AI Cloud in Intel TDX and NVIDIA confidential GPUs; /proof checks all four live. The reply text leaves the TEE when Cartesia is the voice, and on WhatsApp Meta sees call metadata.'],
  ['Has it moved real money yet?', 'Not yet. The contract is an unaudited prototype, so keep small amounts in it. The evidence above fills in as the first mainnet transfers are signed.'],
  ['What else can I do on the line?', 'Launch a coin on JustHoot, tradable at once in a RHEA pool for about 0.1 NEAR, signed in your own wallet. Or ask a builder’s desk for a quote from a photo and pay the deposit in almost any token; NEAR Intents settles it as USDC on NEAR.'],
  ['Which chains?', 'NEAR, and Base by default. One derived address works on every Ethereum-style chain you allow, each with its own limits. Bitcoin and Solana are not supported.'],
];

// Entrances, once, as each part scrolls in. Content stays visible without script.
function useReveal() {
  useEffect(() => {
    document.documentElement.classList.add('js');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.dr .rise').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
