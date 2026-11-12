// The top-up page: a refund address is a long string nobody can say on a call. The agent sends a link to
// /topup/:id (WhatsApp text, or the live panel code); the caller pastes their refund address there and the page
// shows the 1Click deposit address. This server never holds the funds: the caller sends them straight to 1Click.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { env } from './config.ts';
import { quoteTopup, topupLive } from './fund.ts';
import { ipOf } from './live.ts';

type Pending = { usd: number; token: string; recipient: string; demo: boolean; at: number; tries: number };
const pending = new Map<string, Pending>();
const LIFE_MS = 30 * 60_000; // ponytail: in memory; a restart drops open top-up links, the caller asks again

/** A top-up link for this call. */
export function newTopup(p: Omit<Pending, 'at' | 'tries'>): string {
  const id = randomBytes(6).toString('hex');
  pending.set(id, { ...p, at: Date.now(), tries: 0 });
  for (const [k, v] of pending) if (Date.now() - v.at > LIFE_MS) pending.delete(k);
  return id;
}

export async function handleTopup(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const m = (req.url ?? '').split('?')[0].match(/^\/api\/topup\/([0-9a-f]{12})$/);
  if (!m) return false;
  const send = (code: number, o: object) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  const p = pending.get(m[1]);
  if (!p || Date.now() - p.at > LIFE_MS) { send(404, { error: 'This top-up link has expired. Ask the agent again.' }); return true; }
  const info = { usd: p.usd, token: p.token, recipient: p.recipient, demo: p.demo, live: topupLive() };
  if (req.method === 'GET') { send(200, info); return true; }
  if (req.method !== 'POST') { send(405, { error: 'GET or POST' }); return true; }
  if (req.headers.origin !== new URL(env.publicUrl).origin) { send(403, { error: 'Forbidden' }); return true; }
  if (++p.tries > 8) { send(429, { error: 'Too many tries on this link. Ask the agent again.' }); return true; }
  let body = '';
  for await (const c of req) { body += c; if (body.length > 2000) { send(413, { error: 'Too large' }); return true; } }
  let o: any = {}; try { o = JSON.parse(body || '{}'); } catch {}
  const refund = String(o.refund ?? '').trim();
  if (!/^[A-Za-z0-9:._-]{20,120}$/.test(refund)) { send(400, { error: 'Paste your full address on that chain.' }); return true; }
  const q = await quoteTopup({ usd: p.usd, origin: p.token, recipient: p.recipient, refundTo: refund, live: topupLive() });
  if (!q.ok) { send(400, { error: (q as any).reason ?? 'No quote right now.' }); return true; }
  console.log(`[topup] page quote from ${ipOf(req) ? 'a visitor' : 'unknown'}: ${p.usd} USD of ${p.token}`); // no addresses in logs
  send(200, { ...info, quote: q, status: (q as any).depositAddress ? `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent((q as any).depositAddress)}` : null });
  return true;
}
