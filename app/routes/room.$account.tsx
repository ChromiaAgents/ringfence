// A live room, TikTok/Douyin/Twitch style: the stream (any YouTube or Twitch live, or none), gifts popping up, a top
// gifters board, a money packet to grab, and a gift bar. Every gift is real NEAR: tap one and the browser call sends it
// ("send a 0.05 NEAR gift to <account>"), or call on WhatsApp. Gifts from any NEAR wallet show up too (read from chain).
//   /room/liho00.near?yt=<video id>   or   ?twitch=<channel>   [&packet=<id>&words=merry christmas]
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCall } from '../call';

import { Host, type HostHandle } from '../host';

export const Route = createFileRoute('/room/$account')({
  head: () => ({ meta: [{ title: 'Live room · Ringfence' }] }),
  component: Room,
});

type Gift = { to: string; near: number; from: string; at: number; via: 'call' | 'chain'; landsAt?: number; url?: string };
type Packet = { id: string; near: number; count: number; hint: string | null; expired: boolean; claims: { to: string; near: number; at: number }[] };
const GIFTS = [
  { name: 'Heart', icon: '💖', near: 0.01, tab: 'Popular' }, { name: 'Duck', icon: '🐥', near: 0.02, tab: 'Popular' }, { name: 'Kiss', icon: '😘', near: 0.03, tab: 'Popular', tag: 'Hot' }, { name: 'Star', icon: '🌟', near: 0.05, tab: 'Popular', tag: 'Combo' },
  { name: 'Rose', icon: '🌹', near: 0.01, tab: 'Popular' }, { name: 'Red packet', icon: '🧧', near: 0.05, tab: 'Lucky', tag: 'Lucky' }, { name: 'Gold ingot', icon: '🪙', near: 0.08, tab: 'Lucky' }, { name: 'Lotus', icon: '🪷', near: 0.1, tab: 'Lucky', tag: 'New' },
  { name: 'Sports car', icon: '🏎️', near: 0.5, tab: 'Luxury' }, { name: 'Rocket', icon: '🚀', near: 0.2, tab: 'Luxury' }, { name: 'Crown', icon: '👑', near: 0.3, tab: 'Luxury', tag: 'Top' }, { name: 'Castle', icon: '🏰', near: 1, tab: 'Luxury' },
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
  const queued = useRef<string | null>(null);
  const host = useRef<HostHandle>(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState('Popular');
  const [pick, setPick] = useState('Heart');
  const [follow, setFollow] = useState(false);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const idleN = useRef(0), lastTalk = useRef(Date.now());
  // The host keeps talking: thanks every gift as it pops, and says an idle line after 25 s of quiet.
  useEffect(() => {
    const t = setInterval(() => {
      if (!soundRef.current || Date.now() - lastTalk.current < 25_000) return;
      lastTalk.current = Date.now();
      host.current?.speak(`/api/stream/${encodeURIComponent(account)}/voice?idle=${idleN.current++}`);
    }, 3000);
    return () => clearInterval(t);
  }, [account]);

  useEffect(() => {
    const tick = async () => {
      const r = await fetch(`/api/stream/${encodeURIComponent(account)}?since=0${pid ? `&packet=${encodeURIComponent(pid)}` : ''}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (!r) return;
      setTop(r.top ?? []); setTotal(r.total ?? 0); setPacket(r.packet); setFeed(r.gifts);
      for (const g of r.gifts as Gift[]) {
        const key = `${g.at}-${g.from}-${g.near}-${g.landsAt ? 'l' : 'c'}`;
        if (seen.current.has(key)) continue;
        const first = seen.current.size === 0 && Date.now() - g.at > 15_000;
        seen.current.add(key);
        if (first || Date.now() - g.at > 60_000) continue; // history: in the feed, not popped
        setPop((p) => [...p, { ...g, key }].slice(-3));
        if (soundRef.current) { lastTalk.current = Date.now(); host.current?.speak(`/api/stream/${encodeURIComponent(account)}/voice?gift=${encodeURIComponent(`${g.at}-${g.from}`)}`); }
        setTimeout(() => setPop((p) => p.filter((x) => x.key !== key)), 6000);
      }
    };
    tick(); const t = setInterval(tick, 2000), c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [account, pid]);

  // A tapped gift waits for the call to connect, then is said for the caller.
  useEffect(() => { if (call.live && queued.current) { call.say(queued.current); queued.current = null; } }, [call.live]);
  function gift(near: number) {
    const line = `Send a ${near} NEAR gift to ${account}.`;
    if (call.live) call.say(line); else { queued.current = line; call.start(); }
  }
  const left = packet ? packet.count - packet.claims.length : 0;
  const lastAgent = [...call.lines].reverse().find((l) => l.who === 'agent')?.text;

  return (
    <div className="lr">
      <div className="lr-phone">
        <div className="lr-stage">
          {yt ? <iframe title="Live stream" src={`https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1`} allow="autoplay; encrypted-media" allowFullScreen />
            : twitch ? <iframe title="Live stream" src={`https://player.twitch.tv/?channel=${encodeURIComponent(twitch)}&parent=${typeof location !== 'undefined' ? location.hostname : 'ringfence.evalengine.ai'}&muted=true`} allowFullScreen />
            : null}
          <Host ref={host} className={yt || twitch ? 'lr-host small' : 'lr-host'} />
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
            <span className="lr-chip">Hourly rank</span>
            <a className="lr-chip right" href="/whatsapp">Call on WhatsApp ›</a>
          </div>
          {packet && !packet.expired && left > 0 && (
            <a className="lr-event" href={`/packet/${packet.id}`} target="_blank" rel="noreferrer">
              <div><small>Money packet</small><b>{packet.claims.length}/{packet.count}</b></div><span>🧧</span>
              <p>Say “{words || packet.hint || 'the words'}” · tap to grab</p>
            </a>
          )}
          {!sound && <button type="button" className="lr-sound" onClick={() => { setSound(true); soundRef.current = true; lastTalk.current = 0; }}>🔊 Tap to hear the host</button>}
          <div className="lr-feed" aria-live="polite">
            {pop.map((g) => (
              <div className={`lr-pop ${g.landsAt ? 'landing' : ''}`} key={g.key}>
                <span className="lr-pop-ico">{iconOf(g.near)}</span>
                <div><b>{g.from}</b><small>{g.landsAt ? `sending · lands in ${Math.max(0, Math.ceil((g.landsAt - now) / 1000))}s` : g.via === 'chain' ? 'sent from a wallet' : 'sent by phone call'}</small></div>
                <em>x{g.near}</em>
              </div>
            ))}
            {feed.slice(-4).map((g, i) => <p key={i} className="lr-msg"><span>{iconOf(g.near)}</span> <b>{g.from}</b> {g.landsAt ? 'is sending' : 'sent'} {g.near} NEAR</p>)}
            {call.live && lastAgent && <p className="lr-msg agent"><b>Ringfence</b> {lastAgent}</p>}
          </div>
          {!sheet && <button type="button" className="lr-giftbtn" onClick={() => setSheet(true)} aria-label="Send a gift">🎁</button>}
        </div>
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
                  <span>{g.icon}</span>
                  {pick === g.name ? <><small>{g.near} NEAR</small><b className="lr-send" onClick={(e) => { e.stopPropagation(); gift(g.near); }}>Send</b></> : <><b>{g.name}</b><small>{g.near} NEAR</small></>}
                </button>
              ))}
            </div>
            <p className="lr-credit">Gifts go to {account}. Gifts from any NEAR wallet show too. Host: open VRM sample (© pixiv Inc., VRM Public License 1.0).</p>
          </div>
        )}
      </div>
    </div>
  );
}
