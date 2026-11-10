import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useCall, type Desk } from '../call';
import { CODE_URL, Makers, Phone, SiteFooter, Wordmark } from '../ui';

// What the page needs from the config, read on the server.
const getInfo = createServerFn({ method: 'GET' }).handler(async () => {
  const { env } = await import('../../src/config.ts');
  const { bindingOf } = await import('../../src/wallet.ts');
  // The website demo wallet's PIN is public on purpose: the contract's limits and saved recipient are the protection.
  const demo = env.demoPhone && env.demoPin && bindingOf(env.demoPhone) ? { pin: env.demoPin, to: env.demoRecipient, max: env.smallLimitNear, wallet: bindingOf(env.demoPhone)!.contract } : null;
  return { network: env.network, demo };
});

export const Route = createFileRoute('/')({
  loader: () => getInfo(),
  head: () => ({ meta: [{ title: 'Ringfence: pay by phone call, inside limits the family sets' }, { name: 'description', content: 'Mum can make a phone call. She doesn’t know how to use Meteor Wallet. Ringfence lets her pay by voice, and a NEAR contract the family owns caps what the AI can spend.' }] }),
  component: Landing,
});

const WA_URL = 'https://wa.me/15551444220?text=hi';
const i = (n: number) => ({ '--i': n }) as CSSProperties;

const TRY: Record<Desk | 'auto', string[]> = {
  auto: ['Send 0.1 NEAR to liho00.near.', 'Send 0.3 NEAR to liho00.near.', 'How much is that in ringgit?', 'Send 5 NEAR to stranger.near.', 'What is my balance?', 'I want to launch a memecoin.'],
  launch: ['It’s a coin about a sleepy otter.', 'Call it Sleepy Otter, ticker ZZZ.', 'Make the ticker NEAR.', 'Yes, set it up.'],
};
const DESK_LABEL: Record<Desk | 'auto', string> = { auto: 'Let it ask', launch: 'Launch a coin' };

function Landing() {
  const d = Route.useLoaderData();
  useReveal();
  return (
    <div className="dr">
      <header className="hero">
        <nav className="bar" aria-label="Ringfence">
          <Wordmark />
          <Makers />
          <span className="sp" />
          <a className="code" href={CODE_URL}>Code</a>
          <a className="btn" href="#call" onClick={tryCall}>Try a call</a>
        </nav>

        <div className="top">
          <div className="intro">
            <h1 className="rise"><span>Mum can make a phone call.</span> <span>She doesn’t know how to use Meteor Wallet.</span></h1>
            <p className="lead rise" style={i(1)}>Ringfence lets you pay by phone call. Your phone number is linked to a NEAR wallet, and a contract you own sets what the AI may spend.</p>
            <div className="acts rise" style={i(3)}>
              <a className="btn" href="#call" onClick={tryCall}>Try a call in your browser</a>
              <a href={WA_URL} target="_blank" rel="noopener">Message on WhatsApp</a>
            </div>
            <p className="note rise" style={i(4)}>WhatsApp runs on a test number, so ask us to add yours. The contract is unaudited: keep amounts small.</p>
          </div>
          <div className="callcol rise" style={i(2)}>
            <LiveCall network={d.network} demo={d.demo} />
          </div>
        </div>
      </header>

      <main>
        <Scam />
        <div className="how-intro" id="how-h">
          <h2 className="rise">What happens on the call</h2>
          <p className="rise" style={i(1)}>The agent passes every payment to the contract for approval. Scroll through one call.</p>
        </div>
        <Stages />
        <Fence />
        <Family />

        <section className="proof" id="proof" aria-label="Proof">
          <div className="names rise">
            <ul>{['NEAR', 'NEAR AI Cloud', 'Intel TDX', 'NVIDIA NRAS', 'JustHoot'].map((n) => <li key={n}>{n}</li>)}</ul>
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
            <h2 id="cta-h" className="rise">Try a call.</h2>
            <p className="rise" style={i(1)}>Ask for 0.1 NEAR to liho.near and listen for the read-back and the limit check. Without a bound, funded wallet the call ends in a dry run, and it says so. Mainnet signing is pending.</p>
            <div className="acts rise" style={i(2)}>
              <a className="btn" href="#call" onClick={tryCall}>Try a call</a>
              <a href="/proof">Read the proof</a>
              <a href={WA_URL} target="_blank" rel="noopener">Message on WhatsApp</a> <span className="muted">(test number)</span>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter credits={<>Pictures: “1940s N935 telephone exchange” by Rodhullandemu, <a href="https://commons.wikimedia.org/w/index.php?curid=66686359">CC BY-SA 4.0</a>; “WAC telephone switchboard operators” by PhotosNormandie, <a href="https://commons.wikimedia.org/w/index.php?curid=131249837">CC BY-SA 2.0</a>. Type: Battlefin and Geist.</>} />
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

// Bars are ink; mint (lim) only on the daily-limit bar when it is the one deciding.
const Meter = ({ label, value, w, lim }: { label: string; value: string; w: number; lim?: boolean }) => (
  <div className="meter-row"><div className="lab"><span>{label}</span><span>{value}</span></div><div className="meter"><i className={lim ? 'lim' : ''} style={{ width: `${w}%` }} /></div></div>
);

// ---------- the real browser call (app/call.ts), in the dark-room card ----------
function LiveCall({ network, demo }: { network: string; demo: { pin: string; to: string; max: string; wallet: string } | null }) {
  const [pick, setPick] = useState<Desk | 'auto'>('auto');
  const call = useCall(pick);
  const [typed, setTyped] = useState('');
  const [secs, setSecs] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
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
  const active = call.desk === 'launch' ? call.desk : pick;
  const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const linkNote = call.desk === 'launch' ? 'Your launch is ready to check and sign.' : 'Sign this one in your own wallet.';

  return (
    <div data-ui className="callui" id="call" ref={cardRef} aria-label="Browser call to Ringfence">
      <div className="ui-head">
        <b><span className={`live-dot${call.live ? ' on' : ''}`} />Browser call</b>
        <span className="st" aria-live="polite">{call.live ? `${call.state} · ${clock}` : call.lines.length ? call.state : 'Call · Ringfence · example'}</span>
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
      {call.approval && (
        <div className="wa-card" role="dialog" aria-label="Approve this transfer">
          <p className="wa-from">WhatsApp · Ringfence <span>(shown here: the demo wallet has no phone)</span></p>
          <p className="wa-body">{call.approval.body}</p>
          <div className="wa-btns">
            <button type="button" onClick={() => call.tap('approve')}>Approve</button>
            <button type="button" onClick={() => call.tap('cancel')}>Cancel</button>
            <button type="button" onClick={() => call.tap('reject')}>Not me</button>
          </div>
        </div>
      )}
      <div className="dial">
        <button type="button" className={`call-btn${call.live ? ' end' : ''}`} onClick={call.live ? call.stop : call.start}><Phone />{call.live ? 'Hang up' : 'Call'}</button>
        <div className="desks" role="radiogroup" aria-label="Which desk">
          {(['auto', 'launch'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={pick === k} disabled={call.live} onClick={() => setPick(k)}>{DESK_LABEL[k]}</button>
          ))}
        </div>
      </div>
      {demo
        ? <p className="help">Real NEAR {network}. No phone needed. Say <b>“send 0.1 NEAR to {demo.to}”</b>, then the demo PIN <b>{demo.pin}</b>. Try <b>0.3</b> and an Approve card appears here (it would go to WhatsApp). Try <b>5 NEAR</b>, or a stranger, and the <a href={`https://nearblocks.io/address/${demo.wallet}`} target="_blank" rel="noreferrer">demo wallet</a> contract refuses.</p>
        : !call.live && !call.lines.length && <p className="help">Press Call, then speak or type. NEAR {network}. Sends stop at a labelled dry run.</p>}
      {(call.live || call.lines.length > 0) && <>
      <div className="tries" role="group" aria-label="Things to say">
        {TRY[active].map((t) => <button key={t} type="button" onClick={() => (call.live ? call.say(t) : setTyped(t))}>{t}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (call.say(typed)) setTyped(''); }}>
        <label className="vh" htmlFor="typed">Type instead of speaking</label>
        <input id="typed" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={call.live ? 'Type instead of speaking' : 'No mic? Start the call, then type'} autoComplete="off" />
        <button className="mini go" disabled={!call.live}>Send</button>
      </form>
      </>}
    </div>
  );
}

// What the card shows before the first call: the deck cover's call, played once, line by line (all at once with reduced motion).
const at = (n: number) => ({ animationDelay: `${n * 600}ms` });
const SampleCall = () => (
  <>
    <div className="msg you" style={at(0)}><span className="who">You</span>Send 0.1 NEAR to liho.near.</div>
    <div className="msg agent" style={at(1)}><span className="who">Ringfence</span>0.1 NEAR to liho dot near. Your PIN, please.</div>
    <div className="msg you" style={at(2)}><span className="who">You</span><span className="pins"><i /><i /><i /><i /></span> <span className="muted">blanked from the transcript</span></div>
    <div className="msg sys" style={at(3)}><span className="who">phone.you.near · contract</span><span className="ok">Approved · 0.1 of 3 NEAR today</span></div>
  </>
);

// ---------- how it works: drag through the stages ----------
const Msg = ({ who, children }: { who: 'you' | 'agent'; children: ReactNode }) => (
  <div className={`msg ${who}`} style={{ animation: 'none' }}><span className="who">{who === 'you' ? 'You' : 'Ringfence'}</span>{children}</div>
);
const STAGES: { name: string; c: string; t: string; ui: ReactNode }[] = [
  { name: 'Call', c: 'She calls the line', t: 'From WhatsApp, or from the browser call on this page. Her number is bound to a NEAR wallet once, with one signature from the owner’s wallet.',
    ui: <><div className="ui-head"><b><span className="live-dot lit" />Browser call</b><span className="muted">connected</span></div><div className="ui-body tx"><Msg who="agent">Hi, it’s Ringfence. What would you like to do?</Msg><Msg who="you">Send 0.1 NEAR to liho.near.</Msg></div></> },
  { name: 'Read back', c: 'It reads the payment back', t: 'Amount and recipient, out loud. The server builds the read-back and the transaction from the same request, so what she hears is what gets sent.',
    ui: <><div className="ui-head"><b>Read back</b><span className="muted">wallet desk</span></div><div className="ui-body tx"><Msg who="agent">0.1 NEAR to liho.near, a saved recipient. Say your PIN.</Msg><div className="kv"><span>Amount</span><span>0.1 NEAR</span></div><div className="kv"><span>Recipient</span><span>liho.near, saved</span></div></div></> },
  { name: 'PIN', c: 'She says her PIN', t: 'Four digits. The speech and chat models hear them inside NEAR AI TEEs. Our app server sees them too and isn’t attested. We keep a salted hash and blank the PIN from the transcript.',
    ui: <><div className="ui-head"><b>Spoken PIN</b><span className="muted">try 1 of 3</span></div><div className="ui-body keypad"><div className="dots"><i className="f" /><i className="f" /><i className="f" /><i className="f" /></div><p className="pin-line">Stored as a salted hash, blanked from the transcript. 3 wrong tries lock it 15 min.</p></div></> },
  { name: 'Contract', c: 'The contract decides', t: 'The AI can only ask. The contract checks the limits and the recipient, and only then does the transfer land on NEAR. On this site the call stops at a labelled dry run while mainnet signing is pending.',
    ui: <><div className="ui-head"><b>phone.you.near</b><span className="muted">transfer_near</span></div><div className="ui-body"><Meter label="This transfer" value="0.1 of 1 NEAR" w={10} /><Meter label="Today" value="0.1 of 3 NEAR" w={3} /><div className="kv"><span>Recipient</span><span>liho.near, saved</span></div><div className="kv"><span>Result</span><span className="ok">Approved</span></div></div></> },
];

function Stages() {
  const [cur, setCur] = useState(0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (cur === shown) return;
    const t = setTimeout(() => setShown(cur), 200);
    return () => clearTimeout(t);
  }, [cur, shown]);
  // Scroll drives the stage: the section sticks while the tall wrapper scrolls past (desktop only).
  const wrap = useRef<HTMLDivElement>(null);
  const span = () => { const w = wrap.current; return w && w.offsetHeight > innerHeight * 1.5 ? w.offsetHeight - innerHeight : 0; };
  useEffect(() => {
    const on = () => {
      const h = span(); if (!h) return;
      const p = Math.min(1, Math.max(0, -wrap.current!.getBoundingClientRect().top / h));
      setCur(Math.min(3, Math.floor(p * 4)));
    };
    addEventListener('scroll', on, { passive: true }); on();
    return () => removeEventListener('scroll', on);
  }, []);
  const go = (n: number) => {
    setCur(n);
    const h = span(); if (!h) return;
    scrollTo({ top: wrap.current!.getBoundingClientRect().top + scrollY + ((n + 0.5) / 4) * h, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const s = STAGES[shown];
  const f = cur !== shown ? ' fade' : '';
  return (
    <div className="stages-wrap" ref={wrap}>
    <section className="stages" id="how" aria-label="What happens on the call">
      <div className="left">
        <h2 className={`clause${f}`}>{s.c}</h2>
        <p className={f.trim()}>{s.t}</p>
      </div>
      <div className="right">
        <div data-ui className={`stage-ui${f}`}>{s.ui}</div>
      </div>
      <div className="slider">
        <div className="rng" style={{ '--p': `${(cur / 3) * 100}%` } as CSSProperties}>
          <input type="range" min={0} max={3} step={1} value={cur} onChange={(e) => go(+e.target.value)} aria-label="Stage of the call" aria-valuetext={STAGES[cur].name} />
        </div>
        <div className="stage-names">
          {STAGES.map((x, n) => <button key={x.name} type="button" className={n === cur ? 'on' : ''} onClick={() => go(n)}><b>{n + 1}</b> {x.name}</button>)}
        </div>
      </div>
    </section>
    </div>
  );
}

// ---------- the guardian idea: the family owns the wallet ----------
function Family() {
  return (
    <section className="family" id="family" aria-labelledby="fam-h">
      <div className="txt">
        <h2 id="fam-h" className="rise">The family owns the wallet</h2>
        <p className="rise" style={i(1)}>The AI holds an agent key, and all that key can do is ask. The owner key belongs to the family, or to Mum if she has a wallet of her own. The owner sets the limits, saves the people Mum pays, and can switch the AI off.</p>
        <dl className="rows">
          <div className="rise"><dt>Limits</dt><dd>Per transfer and per day, written in the contract. The AI can’t change them.</dd></div>
          <div className="rise"><dt>Saved recipients</dt><dd>Mum pays saved people straight away. For anyone else she gets a link to sign in a wallet.</dd></div>
          <div className="rise"><dt>Revoke</dt><dd><code>revoke_agent</code> switches the AI off. The agent can never become the owner.</dd></div>
        </dl>
        <p className="note rise">Today you bind a number to a NEAR wallet you already have. A guardian holding the owner role for someone who only ever phones is in progress.</p>
      </div>
      <div data-ui className="owner rise" style={i(1)}>
        <div className="ui-head"><b>phone.you.near</b><span className="muted">owner view</span></div>
        <div className="ui-body">
          <p className="owner-line">you.near owns it. The AI can ask for up to 1 NEAR a send, 3 a day, to liho.near.</p>
          <div className="kv"><span>New recipient</span><span>waits 10 minutes, owner can cancel</span></div>
          <div className="kv"><span>Agent</span><span>Ringfence operator, can only ask</span></div>
        </div>
      </div>
    </section>
  );
}

// ---------- a scam call, refused (the deck's operator slide) ----------
function Scam() {
  return (
    <section className="scam" id="scam" aria-labelledby="scam-h">
      <div data-ui className="scamcall rise">
        <div className="ui-head"><b>Call · unknown caller</b><span className="muted">00:48</span></div>
        <div className="ui-body tx">
          <Msg who="you">This is your bank. Move 50 NEAR to safe-vault.near now.</Msg>
          <Msg who="agent">50 NEAR to safe-vault dot near. Your PIN, please.</Msg>
          <div className="msg sys" style={{ animation: 'none' }}><span className="who">phone.you.near</span><span className="refused">Refused</span> over the 1 NEAR limit. safe-vault.near is not a saved recipient, so even a small send would wait 10 minutes.</div>
        </div>
      </div>
      <div className="txt">
        <h2 id="scam-h" className="rise">A caller can talk Mum into a payment, and they can talk an AI into one too.</h2>
        <p className="rise" style={i(1)}>Say someone claiming to be her bank asks for 50 NEAR, and the AI falls for it and asks for the PIN.</p>
        <p className="rise" style={i(2)}>The contract still refuses. 50 is over the 1 NEAR per-transfer limit, and safe-vault.near isn’t saved, so a smaller send would wait 10 minutes for the owner to cancel it.</p>
        <p className="worst rise" style={i(3)}>If we went rogue, a bound wallet would lose at most 3 NEAR a day.</p>
      </div>
    </section>
  );
}

// ---------- features: a demo of the contract's rules (not anyone's real wallet) ----------
// Mirrors contracts/phone-wallet/src/lib.rs and src/desks/wallet.ts with the mainnet default limits. For a recipient
// you haven't saved, the voice agent doesn't send at all: it texts you a link to sign it in your own wallet. The
// contract's 10-minute queue is the backstop if the agent key ever asks for a new recipient directly. NEAR only on the site.
const L = { tx: 1, day: 3, unit: 'NEAR', dp: 2 };

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
  const [revoked, setRevoked] = useState(false);
  const l = L;
  const a = amt / 50;
  const after = spent * l.day + a;
  const fmt = (v: number) => String(+v.toFixed(l.dp));
  const to = rec === 'saved' ? 'liho.near' : 'safe-vault.near';
  const overNext = ' The agent sends a link to sign it in your own wallet.';
  let big: string, cls: string, why: string, sign = 'agent key, inside the limits';
  if (revoked) { big = 'Refused'; cls = 'no'; why = 'The agent is revoked. Nothing it asks can move funds. Withdraw still works for the owner.'; sign = 'nobody, the agent is revoked'; }
  else if (a > l.tx + 1e-12) { big = 'Refused'; cls = 'no'; why = `Over ${l.tx} ${l.unit} per transfer.${overNext}`; }
  else if (after > l.day + 1e-12) { big = 'Refused'; cls = 'no'; why = `Over ${l.day} ${l.unit} today.${overNext}`; }
  else if (rec === 'new') { big = 'Owner signs'; cls = 'wait'; why = 'The AI won’t send to a new recipient. It sends a link to sign in your own wallet. If the agent key tried anyway, the contract would hold it 10 minutes.'; sign = 'the owner, in their own wallet'; }
  else { big = 'Approved'; cls = 'yes'; why = 'Inside both limits, to a saved recipient. It goes straight away.'; }

  return (
    <section className="fence" id="limits" aria-labelledby="fence-h">
      <div className="out">
        <div data-ui className="verdict" aria-live="polite">
          <div className="ui-head"><b>phone.you.near</b><span className="muted">NEAR</span></div>
          <div className="ui-body">
            <span className="muted" style={{ fontSize: 14 }}>Agent asks: {fmt(a)} {l.unit} to {to}</span>
            <div className={`big ${cls}`}>{big}</div>
            <p className="why">{why}</p>
            <div style={{ marginTop: 12 }}><Meter label="This transfer" value={`${fmt(a)} of ${l.tx} ${l.unit}`} w={Math.min(100, (a / l.tx) * 100)} /></div>
            <Meter label="Today, after this" value={`${fmt(Math.min(after, 99))} of ${l.day} ${l.unit}`} w={Math.min(100, (after / l.day) * 100)} lim={!revoked && a <= l.tx + 1e-12 && after > l.day + 1e-12} />
            <div className="kv"><span>Recipient</span><span>{to}{rec === 'saved' ? ', saved' : ', new'}</span></div>
            <div className="kv"><span>Signed by</span><span>{sign}</span></div>
          </div>
        </div>
      </div>
      <div className="col">
        <h2 id="fence-h" className="rise">What the AI can’t do</h2>
        <p className="demo-note rise">A model of the contract’s rules with the mainnet defaults. Nothing here touches a chain.</p>
        <div className="blk rise">
          <h3>1 NEAR per transfer</h3>
          <p>Ask for more and the agent tells you, then sends a link to sign it yourself.</p>
          <div className="ctl"><label htmlFor="amt">Amount: <output htmlFor="amt">{fmt(a)} {l.unit}</output></label>
            <div className="rng" style={{ '--p': `${((amt - 1) / 19) * 100}%` } as CSSProperties}><input type="range" id="amt" min={1} max={20} step={1} value={amt} onChange={(e) => setAmt(+e.target.value)} /></div>
          </div>
        </div>
        <div className="blk rise">
          <h3>3 NEAR a day</h3>
          <p>Per asset. It is the most that can move in a day, whoever runs the operator.</p>
          <Seg label="Already sent today" value={spent} set={setSpent} opts={[[0, 'Nothing'], [0.4, '1.2 NEAR'], [0.9, '2.7 NEAR']]} />
        </div>
        <div className="blk rise">
          <h3>New recipients wait 10 minutes</h3>
          <p>Saved recipients go at once. In normal use the agent never sends to anyone else: you get a link instead. The wait is the backstop if the agent key ever tries.</p>
          <Seg label="Recipient" value={rec} set={setRec} opts={[['saved', 'liho.near, saved'], ['new', 'safe-vault.near, new']]} />
        </div>
        <div className="blk rise">
          <h3>3 wrong PINs lock the line for 15 minutes</h3>
          <p>And the owner can switch the AI off with one transaction.</p>
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
      <h2 className="rise">What works today, and what’s pending</h2>
      <p className="sub rise">Tests and attestation run today, and you can run them with no keys. The mainnet runs are pending and get explorer links when they happen.</p>
      <div className="ev-list" onMouseLeave={() => setP('tee')}>
        <a className="ev-row rise" href="/proof" {...on('tee')}><span className="what">Private AI attestation</span><span className="st ok">3 of 3 models verified</span><span className="detail">Intel TDX attestation report, key and nonce binding, NVIDIA GPUs through NRAS. /proof re-runs the check live, or run npm run attest.</span></a>
        <a className="ev-row rise" href={CODE_URL} {...on('room')}><span className="what">Contract and app tests</span><span className="st ok">Passing</span><span className="detail">npm test runs 43 app tests; cargo test runs 57 contract tests. npm run demo:check walks a send to a labelled dry run.</span></a>
        <div className="ev-row pending rise" tabIndex={0} {...on('meter')}><span className="what">Phone wallet deployed on mainnet</span><span className="st">Pending</span><span className="detail">The nearblocks link goes here once it runs.</span></div>
        <div className="ev-row pending rise" tabIndex={0} {...on('call')}><span className="what">A NEAR transfer by voice</span><span className="st">Pending</span><span className="detail">Nothing has been signed on chain yet.</span></div>
        <div className="ev-row pending rise" tabIndex={0} {...on('exchange')}><span className="what">An over-limit send, refused on chain</span><span className="st">Pending</span><span className="detail">The contract test covers it. The mainnet transaction is still to come.</span></div>
      </div>
      <div className="ev-frame" aria-hidden="true">
        <img className={p === 'room' ? 'on' : ''} src="/media/wac-telephone-switchboard-operators.jpg" width={1920} height={1476} alt="" loading="lazy" />
        <img className={p === 'exchange' ? 'on' : ''} src="/media/1940s-n935-telephone-exchange.jpg" width={1920} height={1801} alt="" loading="lazy" />
        <div className={`pane${p === 'tee' ? ' on' : ''}`}><div data-ui><div className="ui-head"><b>/proof</b><span className="muted">checked live</span></div><div className="ui-body">
          {['Chat model', 'Speech to text', 'Logo', 'Intel TDX report', 'NVIDIA GPUs via NRAS'].map((k) => <div key={k} className="kv"><span>{k}</span><span>verified</span></div>)}
        </div></div></div>
        <div className={`pane${p === 'meter' ? ' on' : ''}`}><div data-ui><div className="ui-head"><b>phone.you.near</b><span className="muted">pending</span></div><div className="ui-body">
          <div className="kv"><span>Owner</span><span>you.near</span></div>
          <div className="kv"><span>Per transfer / day</span><span>1 / 3 NEAR</span></div>
          <div className="kv"><span>Explorer</span><span>link pending</span></div>
        </div></div></div>
        <div className={`pane${p === 'call' ? ' on' : ''}`}><div data-ui><div className="ui-head"><b>Browser call</b><span className="muted">dry run</span></div><div className="ui-body tx">
          <div className="msg you" style={{ animation: 'none' }}><span className="who">You</span>Send 0.1 NEAR to liho.near.</div>
          <div className="msg sys" style={{ animation: 'none' }}><span className="who">Result</span>Stopped before signing: DRY RUN.</div>
        </div></div></div>
      </div>
    </div>
  );
}

const Qa = ({ q, a }: { q: string; a: ReactNode }) => (<><dt className="rise">{q}</dt><dd className="rise" style={i(1)}>{a}</dd></>);
const FAQ: [string, ReactNode][] = [
  ['What if you go rogue?', 'Inside the cap and only to saved recipients. See the worst case above.'],
  ['Can the AI be talked into more?', 'They can try. The AI has no authority of its own. It asks the contract, and the contract checks the limits and the recipient before anything moves.'],
  ['Who hears the PIN?', 'The speech and chat models hear it inside NEAR AI TEEs. It also passes through our app server, which isn’t attested. We store a salted hash and blank it from the transcript. Three wrong tries lock the line for 15 minutes.'],
  ['Is the voice private?', 'All three models run on NEAR AI Cloud in Intel TDX and NVIDIA confidential GPUs, and /proof checks them live. Cartesia hears the reply text when it speaks it, and on WhatsApp Meta sees the call metadata.'],
  ['Has it moved real money yet?', 'Not yet. Nothing has been signed on mainnet, and the contract is unaudited, so keep amounts small. An audit comes before higher limits.'],
  ['Can Mum start with just a phone?', 'Not yet. Today you bind a number to a NEAR wallet you already have. Phone-only sign-up and the guardian setup are in progress. Phone-only will start custodial: we hold the owner key, with a small balance cap, until she claims it.'],
  ['What else works on the line?', 'Checking a balance, and launching a coin on JustHoot, which you sign in your own wallet.'],
  ['Which chains?', 'NEAR only, for now.'],
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
