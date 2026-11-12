// Live-stream overlay (add as a browser source in OBS, 1920x1080, transparent):
//   /stream/<streamer>.near                 gifts sent to the streamer by phone call, popping up as they land
//   /stream/<streamer>.near?packet=<id>     plus a money-packet race: the words, shares left, who just opened one
// Viewers gift by calling Ringfence ("send 0.05 NEAR to <streamer>.near") or race to open the packet by saying its words.
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/stream/$account')({
  head: () => ({ meta: [{ title: 'Stream overlay · Ringfence' }, { name: 'robots', content: 'noindex' }] }),
  component: Overlay,
});

type Gift = { to: string; near: number; from: string; at: number };
type Packet = { id: string; near: number; count: number; hint: string | null; expired: boolean; claims: { to: string; near: number; at: number }[] };

function Overlay() {
  const { account } = Route.useParams();
  const [pop, setPop] = useState<(Gift & { key: string })[]>([]);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [total, setTotal] = useState(0);
  const since = useRef(Date.now() - 60_000);
  const pid = typeof window === 'undefined' ? '' : new URLSearchParams(location.search).get('packet') ?? '';

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const tick = async () => {
      const r = await fetch(`/api/stream/${encodeURIComponent(account)}?since=${since.current}${pid ? `&packet=${encodeURIComponent(pid)}` : ''}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      if (!r) return;
      setPacket(r.packet);
      const fresh: Gift[] = r.gifts.filter((g: Gift) => g.at > since.current);
      if (fresh.length) {
        since.current = Math.max(...fresh.map((g) => g.at));
        setTotal((t) => t + fresh.reduce((s, g) => s + g.near, 0));
        const add = fresh.map((g) => ({ ...g, key: `${g.at}-${g.from}` }));
        setPop((p) => [...p, ...add].slice(-4));
        for (const g of add) setTimeout(() => setPop((p) => p.filter((x) => x.key !== g.key)), 7000);
      }
    };
    // ?preview=1: sample gifts every 4 s, to place the overlay in OBS before going live (labelled, never real).
    const preview = new URLSearchParams(location.search).has('preview');
    const fake = preview ? setInterval(() => { const g = { to: account, near: [0.01, 0.05, 0.1][Math.floor(Date.now() / 4000) % 3], from: 'Preview viewer', at: Date.now(), key: String(Date.now()) };
      setTotal((t) => t + g.near); setPop((p) => [...p, g].slice(-4)); setTimeout(() => setPop((p) => p.filter((x) => x.key !== g.key)), 7000); }, 4000) : undefined;
    tick(); const t = setInterval(tick, 2000); return () => { clearInterval(t); clearInterval(fake); };
  }, [account, pid]);

  const left = packet ? packet.count - packet.claims.length : 0;
  return (
    <div className="ov">
      <div className="ov-gifts" aria-live="polite">
        {pop.map((g) => (
          <div className="ov-gift" key={g.key}><span className="ov-heart">❤</span><div><b>{g.from}</b> sent <b>{g.near} NEAR</b><small>by phone call · on NEAR</small></div></div>
        ))}
      </div>
      {total > 0 && <div className="ov-total">{total.toFixed(3).replace(/\.?0+$/, '')} NEAR gifted this stream</div>}
      {packet && (
        <div className="ov-packet">
          <p className="ov-k">Money packet · {packet.near} NEAR · {packet.expired ? 'closed' : `${left} of ${packet.count} left`}</p>
          <p className="ov-words">Call Ringfence and say <b>“{packet.hint ?? 'the words'}”</b></p>
          <p className="ov-how">ringfence.evalengine.ai/packet/{packet.id} · tap Call</p>
          <ul>{packet.claims.slice(-3).reverse().map((c) => <li key={c.at + c.to}>🧧 {c.to} got {c.near.toFixed(4)} NEAR</li>)}</ul>
        </div>
      )}
    </div>
  );
}
