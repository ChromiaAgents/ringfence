// A live room, TikTok/Douyin/Twitch style: the stream (any YouTube or Twitch live, or none), gifts popping up, a top
// gifters board, a money packet to grab, and a gift bar. Every gift is real NEAR: tap one and the browser call sends it
// ("send a 0.05 NEAR gift to <account>"), or call on WhatsApp. Gifts from any NEAR wallet show up too (read from chain).
//   /room/liho00.near?yt=<video id>   or   ?twitch=<channel>   [&packet=<id>&words=merry christmas]
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCall } from '../call';

import { Host, type HostHandle } from '../host';
import { WaIcon } from '../ui';

export const Route = createFileRoute('/room/$account')({
  head: ({ params }) => ({ meta: [{ title: `${params.account} live · Ringfence` }, { name: 'description', content: `Send ${params.account} real NEAR gifts by phone call, grab money packets live, and watch the AI host thank you.` }, { property: 'og:title', content: `${params.account} is live on Ringfence` }, { property: 'og:description', content: 'Gift real NEAR by phone call. Grab the money packet. On NEAR mainnet.' }] }),
  component: Room,
});

type Gift = { to: string; near: number; from: string; at: number; via: 'call' | 'chain'; landsAt?: number; url?: string };
type Packet = { id: string; near: number; count: number; hint: string | null; expired: boolean; claims: { to: string; near: number; at: number }[] };
const GIFTS = [
  { name: 'NEAR', icon: '💖', img: '/brand/near-mark-light.svg', near: 0.01, tab: 'Popular', tag: 'NEAR' }, { name: 'Heart', icon: '💖', near: 0.01, tab: 'Popular' }, { name: 'Duck', icon: '🐥', near: 0.02, tab: 'Popular' }, { name: 'Kiss', icon: '😘', near: 0.03, tab: 'Popular', tag: 'Hot' }, { name: 'Star', icon: '🌟', near: 0.05, tab: 'Popular', tag: 'Combo' },
  { name: 'Rose', icon: '🌹', near: 0.01, tab: 'Popular' }, { name: 'Ice cream', icon: '🍦', near: 0.02, tab: 'Popular' }, { name: 'Cake', icon: '🎂', near: 0.05, tab: 'Popular', tag: 'Party' }, { name: 'Red packet', icon: '🧧', near: 0.05, tab: 'Lucky', tag: 'Lucky' }, { name: 'Gold ingot', icon: '🪙', near: 0.08, tab: 'Lucky' }, { name: 'Lotus', icon: '🪷', near: 0.1, tab: 'Lucky', tag: 'New' },
  { name: 'Hoot', icon: '🦉', img: '/brand/justhoot.png', near: 0.05, tab: 'Lucky', tag: 'JustHoot' }, { name: 'Sports car', icon: '🏎️', near: 0.5, tab: 'Luxury' }, { name: 'Rocket', icon: '🚀', near: 0.2, tab: 'Luxury' }, { name: 'Crown', icon: '👑', near: 0.3, tab: 'Luxury', tag: 'Top' }, { name: 'Castle', icon: '🏰', near: 1, tab: 'Luxury' },
];
const TABS = ['Popular', 'Lucky', 'Luxury'];
const iconOf = (n: number) => [...GIFTS].sort((a, b) => b.near - a.near).find((g) => n >= g.near)?.icon ?? '💖';

function Room() {
  const { account } = Route.useParams();
  const qs = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const yt = qs.get('yt'), twitch = qs.get('twitch'), pid = qs.get('packet') ?? '', words = qs.get('words');
  const [feed, setFeed] = useState<Gift[]>([]);
  const [pop, setPop] = useState<(Gift & { key: string })[]>([]);
  const [top, setTop] = useState<{ from: string; near: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [now, setNow] = useState(Date.now());
  const seen = useRef(new Set<string>());
  const call = useCall('auto');
  // The red packet, opened inside the room: a packet call to that packet, paying the account typed here.
  const [env, setEnv] = useState<'closed' | 'envelope' | 'opening' | 'result'>('closed');
  const [acct, setAcct] = useState(() => { try { return localStorage.getItem('rf-acct') ?? ''; } catch { return ''; } });
  const pcall = useCall('auto', packet?.id || undefined, acct || undefined);
  const saidWords = useRef(false);
  const got = [...pcall.lines].reverse().find((l) => l.who === 'agent' && /\d+(\.\d+)?\s*NEAR/.test(l.text) && /(got|opened|yours|share)/i.test(l.text))?.text;
  const gotNear = got?.match(/(\d+\.\d+|\d+)\s*NEAR/)?.[1];
  const liveRef = useRef(false);
  useEffect(() => { liveRef.current = call.live; if (call.live) lastTalk.current = Date.now(); }, [call.live]); // on a call the agent talks, the host only moves its lips
  const queued = useRef<string | null>(null);
  const host = useRef<HostHandle>(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState('Popular');
  const [pick, setPick] = useState('Heart');
  const [follow, setFollow] = useState(false);
  const [confirm, setConfirm] = useState<(typeof GIFTS)[number] | null>(null);
  const [chatText, setChatText] = useState('');
  const [pin, setPin] = useState('');
  const pendingPin = useRef<string | null>(null);
  const [chats, setChats] = useState<{ name: string; text: string; at: number }[]>([]);
  const [burst, setBurst] = useState<(Gift & { key: string }) | null>(null);
  const chatBox = useRef<HTMLDivElement>(null);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const idleN = useRef(0), lastTalk = useRef(Date.now());
  // The host keeps talking: thanks every gift as it pops, and says an idle line after 25 s of quiet.
  useEffect(() => {
    const t = setInterval(() => {
      if (!soundRef.current || liveRef.current || Date.now() - lastTalk.current < 25_000) return;
      lastTalk.current = Date.now();
      host.current?.speak(`/api/stream/${encodeURIComponent(account)}/voice?idle=${idleN.current++}`);
    }, 3000);
    return () => clearInterval(t);
  }, [account]);

  useEffect(() => {
    const tick = async () => {
      const r = await fetch(`/api/stream/${encodeURIComponent(account)}?since=0${pid ? `&packet=${encodeURIComponent(pid)}` : ''}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (!r) return;
      setTop(r.top ?? []); setTotal(r.total ?? 0); setPacket(r.packet); setFeed(r.gifts); setChats(r.chat ?? []);
      for (const g of r.gifts as Gift[]) {
        const key = `${g.at}-${g.from}-${g.near}-${g.landsAt ? 'l' : 'c'}`;
        if (seen.current.has(key)) continue;
        const first = seen.current.size === 0 && Date.now() - g.at > 15_000;
        seen.current.add(key);
        if (first || Date.now() - g.at > 60_000) continue; // history: in the feed, not popped
        setPop((p) => [...p, { ...g, key }].slice(-3));
        if (!g.landsAt) { setBurst({ ...g, key }); setTimeout(() => setBurst((b) => (b?.key === key ? null : b)), 2600); }
        if (soundRef.current && !liveRef.current) { lastTalk.current = Date.now(); host.current?.speak(`/api/stream/${encodeURIComponent(account)}/voice?gift=${encodeURIComponent(`${g.at}-${g.from}`)}`); }
        setTimeout(() => setPop((p) => p.filter((x) => x.key !== key)), 6000);
      }
    };
    tick(); const t = setInterval(tick, 2000), c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [account, pid]);

  // A tapped gift waits for the call to connect, then is said for the caller.
  useEffect(() => {
    if (env === 'opening' && pcall.live && !saidWords.current) { saidWords.current = true; setTimeout(() => pcall.say(words || packet?.hint || ''), 900); }
  }, [env, pcall.live]);
  useEffect(() => { if (env === 'opening' && gotNear) { setEnv('result'); setTimeout(() => pcall.stop(), 4000); } }, [gotNear, env]);
  // The socket opens a moment after the call goes live: keep the request until it is really sent.
  useEffect(() => { if (call.live && queued.current && call.say(queued.current)) queued.current = null; }, [call.live, call.state]);
  // The agent's line streams in, so watch its text, not just the line count.
  const agentLast = [...call.lines].reverse().find((l) => l.who === 'agent')?.text ?? '';
  useEffect(() => {
    if (!pendingPin.current || !/\bPIN\b/i.test(agentLast)) return;
    const p = pendingPin.current; pendingPin.current = null;
    setTimeout(() => { if (!call.say(p)) pendingPin.current = p; }, 400);
  }, [agentLast, call.state]);
  function gift(near: number) {
    const line = `Send a ${near} NEAR gift to ${account}.`;
    if (call.live) call.say(line); else { queued.current = line; call.start(); }
  }
  const firstSeen = useRef<number[]>([]);
  const seenAt = (i: number) => (firstSeen.current[i] ??= Date.now());
  useEffect(() => { if (!call.live) firstSeen.current = []; }, [call.live]);
  // Mic off after a quiet minute on a call: no speech either way. Say so in the chat.
  const [idleNote, setIdleNote] = useState('');
  const lastAct = useRef(Date.now());
  useEffect(() => { lastAct.current = Date.now(); }, [call.lines.length, call.state]);
  useEffect(() => {
    if (!call.live) return;
    setIdleNote('');
    const t = setInterval(() => { if (Date.now() - lastAct.current > 60_000) { call.stop(); setIdleNote('Mic off after a quiet minute. Tap 🎙 to talk again.'); } }, 5000);
    return () => clearInterval(t);
  }, [call.live]);
  const left = packet ? packet.count - packet.claims.length : 0;
  // One chat column: gifts, viewers' messages and the agent, in time order.
  const stream = [
    ...feed.map((g) => ({ kind: 'gift' as const, at: g.at, from: g.from, near: g.near, landing: !!g.landsAt, text: '' })),
    ...chats.map((c) => ({ kind: 'chat' as const, at: c.at, from: c.name, near: 0, landing: false, text: c.text })),
    ...call.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.who === 'agent').map(({ l, i }) => ({ kind: 'agent' as const, at: seenAt(i), from: 'Ringfence', near: 0, landing: false, text: l.text })),
  ].sort((a, b) => a.at - b.at).slice(-60);
  // Follow new messages only when the reader is already at the bottom; scrolling up to read history is left alone.
  useEffect(() => { const b = chatBox.current; if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 80) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, [stream.length]);
  const lastAgent = [...call.lines].reverse().find((l) => l.who === 'agent')?.text;

  return (
    <div className="lr">
      <div className="lr-phone">
        <div className="lr-stage">
          {yt ? <iframe title="Live stream" src={`https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1`} allow="autoplay; encrypted-media" allowFullScreen />
            : twitch ? <iframe title="Live stream" src={`https://player.twitch.tv/?channel=${encodeURIComponent(twitch)}&parent=${typeof location !== 'undefined' ? location.hostname : 'ringfence.evalengine.ai'}&muted=true`} allowFullScreen />
            : null}
          <Host ref={host} className={yt || twitch ? 'lr-host small' : 'lr-host'} onTap={() => { host.current?.unlock(); if (!soundRef.current) { setSound(true); soundRef.current = true; } if (!liveRef.current) { lastTalk.current = Date.now(); host.current?.speak(`/api/stream/${encodeURIComponent(account)}/voice?idle=${idleN.current++}`); } }} />
          <div className="lr-top">
            <div className="lr-anchor">
              <span className="lr-ava">{account[0]?.toUpperCase()}</span>
              <div><b>{account.replace(/\.near$/, '')}</b><small>{total} NEAR gifted today</small></div>
              <button type="button" className={`lr-follow ${follow ? 'on' : ''}`} onClick={() => setFollow((f) => !f)}>{follow ? 'Following' : 'Follow'}</button>
            </div>
            <div className="lr-right">
              <div className="lr-fans">{top.slice(0, 3).map((t, i) => <span key={t.from} title={t.from} style={{ zIndex: 3 - i }}>{t.from[0]?.toUpperCase()}</span>)}</div>
              <span className="lr-count">{Math.max(1, top.length)}</span>
              <a className="lr-x" href="/" aria-label="Leave">✕</a>
            </div>
          </div>
          <div className="lr-row2">
            <a className="lr-chip brand" href="/proof" title="Built on NEAR"><img src="/brand/near-mark-light.svg" alt="" width="14" height="14" />Built on NEAR</a>
            <a className="lr-chip right" href="/whatsapp"><WaIcon size={15} /> Call on WhatsApp ›</a>
          </div>
          {packet && !packet.expired && left > 0 && (
            <a className="lr-event" href={`/packet/${packet.id}`} onClick={(e) => { e.preventDefault(); setEnv('envelope'); }}>
              <div><small>Money packet</small><b>{packet.claims.length}/{packet.count}</b></div><span>🧧</span>
              <p>Tap to open a share</p>
            </a>
          )}
          <div className="lr-stack"><p className="lr-howto">{call.live ? <>🎙 She is listening: “send a 0.01 NEAR gift to {account}”, “open the money packet”, “top up 1 dollar of USDT”… <b>PIN 4821</b></> : <>She <b>is</b> the Ringfence agent. Tap 🎙 to talk, or WhatsApp-call +1 555-144-4220: same agent.</>}</p>
          {!sound && !call.live && <button type="button" className="lr-sound" onClick={() => { host.current?.unlock(); setSound(true); soundRef.current = true; lastTalk.current = 0; }}>🔊 Tap to hear the host</button>}</div>
          <div className="lr-pops" aria-live="polite">
            {pop.map((g) => (
              <div className={`lr-pop ${g.landsAt ? 'landing' : ''}`} key={g.key}>
                <span className="lr-pop-ico">{iconOf(g.near)}</span>
                <div><b>{g.from}</b><small>{g.landsAt ? `sending · lands in ${Math.max(0, Math.ceil((g.landsAt - now) / 1000))}s` : g.via === 'chain' ? 'sent from a wallet' : 'sent by phone call'}</small></div>
                <em>x{g.near}</em>
              </div>
            ))}
          </div>
          {burst && <div className="lr-burst" key={burst.key} aria-hidden="true"><span>{iconOf(burst.near)}</span><b>{burst.from}</b><em>{burst.near} NEAR</em></div>}
          {(call.link || call.approval || call.choices.length > 0) && (
            <div className="lr-cards">
              {call.approval && (
                <div className="lr-card approve"><p>{call.approval.body}</p>
                  <div><button type="button" className="go" onClick={() => call.tap('approve')}>Approve</button><button type="button" onClick={() => call.tap('cancel')}>Cancel</button><button type="button" onClick={() => call.tap('reject')}>Not me</button></div></div>
              )}
              {call.link && <a className="lr-card link" href={call.link.url} target="_blank" rel="noreferrer"><span>{call.link.label}</span><b>Open</b></a>}
              {call.choices.length > 0 && <div className="lr-choices">{call.choices.map((c) => <button key={c} type="button" onClick={() => call.say(c)}>{c}</button>)}</div>}
            </div>
          )}
          <div className="lr-chat" ref={chatBox}>
            <p className="lr-sys">Welcome! Ringfence never asks for your seed phrase or for money outside a call with your PIN. Beware of scams.</p>
            {idleNote && <p className="lr-sys">{idleNote}</p>}
            {stream.map((m, i) => m.kind === 'gift'
              ? <p key={i} className="lr-msg"><span className="lv">{Math.min(99, Math.ceil(m.near * 100))}</span><b>{m.from}:</b> sent {iconOf(m.near)} {m.near} NEAR{m.landing ? ' (landing)' : ''}</p>
              : <p key={i} className={`lr-msg ${m.kind}`}><span className="lv">{m.kind === 'agent' ? 'AI' : '1'}</span><b>{m.from}:</b> {m.text}</p>)}
          </div>
          <form className="lr-bar" onSubmit={async (e) => {
            e.preventDefault(); const t = chatText.trim(); if (!t) return;
            if (call.live) call.say(t); // on a call, typing talks to the agent
            else await fetch(`/api/stream/${encodeURIComponent(account)}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'viewer', text: t }) }).catch(() => {});
            setChatText('');
          }}>
            <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder={call.live ? 'Type to the agent…' : 'Say something…'} maxLength={120} aria-label="Chat" />
            <button type="button" className={`ico mic ${call.live ? 'on' : ''}`} onClick={() => { host.current?.unlock(); call.live ? call.stop() : call.start(); }} aria-label={call.live ? 'Hang up' : 'Talk to her'}>{call.live ? '⏹' : '🎙'}</button>
            <button type="button" className="ico" onClick={() => { const g = GIFTS[0]; setPick(g.name); setConfirm(g); setSheet(true); }} aria-label="Send a heart">💖</button>
            <button type="button" className="ico" onClick={() => setSheet(true)} aria-label="Gifts">🎁</button>
            <button type="button" className="ico share" onClick={() => { const u = location.href; (navigator as any).share ? (navigator as any).share({ title: `${account} is live`, url: u }).catch(() => {}) : navigator.clipboard?.writeText(u); }} aria-label="Share">↗</button>
          </form>
        </div>
        {env !== 'closed' && packet && (
          <div className="rp-wrap" role="dialog" aria-label="Money packet">
            <div className={`rp ${env}`}>
              <button type="button" className="rp-x" aria-label="Close" onClick={() => { setEnv('closed'); pcall.stop(); saidWords.current = false; }}>✕</button>
              <span className="rp-ava">{account[0]?.toUpperCase()}</span>
              <p className="rp-from">@{account.replace(/\.near$/, '')}'s money packet</p>
              {env === 'result' ? (<>
                <p className="rp-amt">{gotNear}<small> NEAR</small></p>
                <p className="rp-sub">Sent to {acct} on NEAR mainnet</p>
                <ul className="rp-list">{[...packet.claims].reverse().slice(0, 5).map((c) => <li key={c.at + c.to}><span>{c.to}</span><b>{c.near.toFixed(4)} NEAR</b></li>)}</ul>
              </>) : (<>
                <p className="rp-title">{packet.near} NEAR · {left} of {packet.count} left</p>
                <p className="rp-sub">Words: “{words || packet.hint || '…'}”</p>
                <label className="rp-acct">Your NEAR account<input value={acct} onChange={(e) => setAcct(e.target.value.trim().toLowerCase())} placeholder="you.near" autoComplete="off" /></label>
                <button type="button" className="rp-open" disabled={env === 'opening' || !/^[a-z0-9_.-]+\.near$|^[0-9a-f]{64}$/.test(acct)} onClick={() => { try { localStorage.setItem('rf-acct', acct); } catch {} saidWords.current = false; setEnv('opening'); pcall.start(); }}>{env === 'opening' ? '…' : 'Open'}</button>
                <p className="rp-note">{env === 'opening' ? (pcall.live ? 'Saying the words for you…' : 'Connecting…') : 'A short call says the words and pays your share on chain.'}</p>
              </>)}
            </div>
          </div>
        )}
        {sheet && <button type="button" className="lr-backdrop" aria-label="Close gifts" onClick={() => setSheet(false)} />}
        {sheet && (
          <div className="lr-sheet" role="dialog" aria-label="Gifts">
            <div className="lr-tabs">
              {TABS.map((t) => <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
              <span className="lr-bal" title="Your gifts are real NEAR">Ⓝ NEAR</span>
              <button type="button" className="lr-close" onClick={() => setSheet(false)} aria-label="Close">✕</button>
            </div>
            <div className="lr-banner"><span>💖</span><div><b>Every gift is real NEAR</b><small>{call.live ? `On the call · ${call.state}. Say your PIN when asked (demo PIN 4821).` : 'Tap a gift, then Send: a phone call sends it on mainnet.'}</small></div>
              {call.live ? <button type="button" onClick={call.stop}>Hang up</button> : <a href="/whatsapp">WhatsApp</a>}</div>
            <div className="lr-grid">
              {GIFTS.filter((g) => g.tab === tab).map((g) => (
                <button key={g.name} type="button" className={`lr-gift ${pick === g.name ? 'on' : ''}`} onClick={() => setPick(g.name)}>
                  {g.tag && <i>{g.tag}</i>}
                  <span>{(g as any).img ? <img src={(g as any).img} alt="" className={g.name === 'NEAR' ? 'near' : ''} /> : g.icon}</span>
                  {pick === g.name ? <><small>{g.near} NEAR</small><b className="lr-send" onClick={(e) => { e.stopPropagation(); setConfirm(g); }}>Send</b></> : <><b>{g.name}</b><small>{g.near} NEAR</small></>}
                </button>
              ))}
            </div>
            {confirm && (
              <div className="lr-confirm" role="alertdialog" aria-label="Confirm gift">
                <span>{confirm.icon}</span>
                <p>Send a <b>{confirm.name}</b>, <b>{confirm.near} NEAR</b>, to {account}?<small>Real NEAR on mainnet. A short call sends it; your PIN confirms it.</small></p>
                <label className="lr-pin">PIN <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" placeholder="••••" aria-label="Your 4-digit PIN" /><button type="button" onClick={() => setPin('4821')}>Use demo PIN 4821</button></label>
                <div><button type="button" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="go" disabled={pin.length !== 4} onClick={() => { pendingPin.current = pin; gift(confirm.near); setConfirm(null); setPin(''); setSheet(false); }}>Send {confirm.near} NEAR</button></div>
              </div>
            )}
            <p className="lr-credit">Gifts go to {account}. Gifts from any NEAR wallet show too. Coins launch on <a href="https://justhoot.fun" target="_blank" rel="noreferrer">JustHoot</a>; AI on NEAR AI Cloud via <a href="https://nearon.dev" target="_blank" rel="noreferrer">NEARON</a>. Host: open VRM sample (© pixiv Inc., VRM Public License 1.0).</p>
          </div>
        )}
      </div>
    </div>
  );
}
