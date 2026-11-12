// A live room, TikTok/Douyin/Twitch style: the stream (any YouTube or Twitch live, or none), gifts popping up, a top
// gifters board, a money packet to grab, and a gift bar. Every gift is real NEAR: tap one and the browser call sends it
// ("send a 0.05 NEAR gift to <account>"), or call on WhatsApp. Gifts from any NEAR wallet show up too (read from chain).
//   /room/liho00.near?yt=<video id>   or   ?twitch=<channel>   [&packet=<id>&words=merry christmas]
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCall } from '../call';
import { Wordmark, WaIcon } from '../ui';
import { Host, type HostHandle } from '../host';

export const Route = createFileRoute('/room/$account')({
  head: () => ({ meta: [{ title: 'Live room · Ringfence' }] }),
  component: Room,
});

type Gift = { to: string; near: number; from: string; at: number; via: 'call' | 'chain'; landsAt?: number; url?: string };
type Packet = { id: string; near: number; count: number; hint: string | null; expired: boolean; claims: { to: string; near: number; at: number }[] };
const GIFTS = [{ name: 'Rose', icon: '🌹', near: 0.01 }, { name: 'Heart', icon: '💖', near: 0.02 }, { name: 'Packet', icon: '🧧', near: 0.05 }, { name: 'Rocket', icon: '🚀', near: 0.1 }];
const iconOf = (n: number) => [...GIFTS].reverse().find((g) => n >= g.near)?.icon ?? '🌹';

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
    <div className="room">
      <div className="room-stage">
        {yt ? <iframe title="Live stream" src={`https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1`} allow="autoplay; encrypted-media" allowFullScreen />
          : twitch ? <iframe title="Live stream" src={`https://player.twitch.tv/?channel=${encodeURIComponent(twitch)}&parent=${typeof location !== 'undefined' ? location.hostname : 'ringfence.evalengine.ai'}&muted=true`} allowFullScreen />
          : null}
        <Host ref={host} className={yt || twitch ? 'room-host3d small' : 'room-host3d'} />
        {!sound && <button type="button" className="room-sound" onClick={() => { setSound(true); soundRef.current = true; lastTalk.current = 0; }}>🔊 Tap to hear the host</button>}
        <div className="room-top">
          <div className="room-host"><span className="room-ava">{account[0]?.toUpperCase()}</span><div><b>{account}</b><small>{total} NEAR in gifts</small></div></div>
          <span className="room-live">LIVE</span>
        </div>
        <div className="room-pops" aria-live="polite">
          {pop.map((g) => (
            <div className={`room-pop ${g.landsAt ? 'landing' : ''}`} key={g.key}>
              <span className="room-gico">{iconOf(g.near)}</span>
              <div><b>{g.from}</b><small>{g.landsAt ? `sending ${g.near} NEAR · lands in ${Math.max(0, Math.ceil((g.landsAt - now) / 1000))}s` : `sent ${g.near} NEAR${g.via === 'chain' ? ' from a wallet' : ' by phone call'}`}</small></div>
              <em>x{g.near}</em>
            </div>
          ))}
        </div>
        {packet && !packet.expired && left > 0 && (
          <a className="room-packet" href={`/packet/${packet.id}`} target="_blank" rel="noreferrer">
            <span>🧧</span><b>{packet.near} NEAR</b><small>{left}/{packet.count} left · say “{words || packet.hint || 'the words'}”</small><i>Grab</i>
          </a>
        )}
        <div className="room-chat">
          {feed.slice(-7).map((g, i) => <p key={i}><b>{g.from}</b> {g.landsAt ? 'is sending' : 'sent'} {iconOf(g.near)} {g.near} NEAR</p>)}
          {call.live && lastAgent && <p className="agent"><b>Ringfence</b> {lastAgent}</p>}
        </div>
      </div>
      <aside className="room-side">
        <div className="room-brand"><Wordmark /><span>on NEAR</span></div>
        <h2>Send a gift</h2>
        <div className="room-gifts">
          {GIFTS.map((g) => <button key={g.name} type="button" onClick={() => gift(g.near)}><span>{g.icon}</span><b>{g.name}</b><small>{g.near} NEAR</small></button>)}
        </div>
        <p className="room-callstate">{call.live ? <>On the call · {call.state}. Say your PIN when asked (demo PIN 4821).</> : 'Tap a gift: a call starts and sends it. Real NEAR, on mainnet.'}</p>
        {call.live && <button className="btn small" type="button" onClick={call.stop}>Hang up</button>}
        <a className="room-wa" href="/whatsapp"><WaIcon size={18} /> Or gift by WhatsApp call</a>
        <h2>Top gifters</h2>
        <ol className="room-top3">{top.length ? top.map((t, i) => <li key={t.from}><span>{['🥇', '🥈', '🥉'][i] ?? i + 1}</span><b>{t.from}</b><em>{t.near} NEAR</em></li>) : <li className="muted">Be the first.</li>}</ol>
        <p className="muted small">Every gift is a real NEAR transfer to {account}. Gifts from any wallet show here too. Phone numbers are never shown in full. Host: open-source VRM sample (© pixiv Inc., VRM Public License 1.0), voiced by our agent.</p>
      </aside>
    </div>
  );
}
