// "Request WhatsApp access": while Meta verification is pending, only numbers added by hand in the Meta dashboard
// can call the test line. A visitor leaves a number here; the owner sees it on the dashboard and adds it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, save } from './store.ts';
import { env } from './config.ts';
import { ipOf } from './live.ts';

const hits = new Map<string, { at: number; n: number }>();
const LIMIT = 5, WINDOW = 60 * 60_000; // ponytail: 5 requests per IP per hour, in memory

/** Digits only, 8 to 15 long (E.164 without the plus), or null. */
export function cleanPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/[\s().+-]/g, '');
  return /^\d{8,15}$/.test(d) ? d : null;
}

export async function handleAccess(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if ((req.url ?? '').split('?')[0] !== '/api/whatsapp-access') return false;
  const send = (code: number, o: object) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (req.method !== 'POST') { send(405, { error: 'POST only' }); return true; }
  if (req.headers.origin !== new URL(env.publicUrl).origin) { send(403, { error: 'Forbidden' }); return true; }
  const ip = ipOf(req); // the real caller behind the local reverse proxy
  const now = Date.now(); let b = hits.get(ip);
  if (!b || now - b.at > WINDOW) { b = { at: now, n: 0 }; hits.set(ip, b); }
  if (++b.n > LIMIT) { send(429, { error: 'Too many requests. Try again later.' }); return true; }
  let body = '';
  for await (const c of req) { body += c; if (body.length > 2000) { send(413, { error: 'Too large' }); return true; } }
  let o: any = {}; try { o = JSON.parse(body || '{}'); } catch {}
  const phone = cleanPhone(o.phone);
  if (!phone) { send(400, { error: 'Enter your WhatsApp number with the country code, for example +60 12 345 6789.' }); return true; }
  const name = String(o.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
  db.access ??= [];
  if (!db.access.some((a) => a.phone === phone)) { db.access.push({ phone, name, at: now }); db.access = db.access.slice(-200); save(); }
  console.log('[access] new WhatsApp access request'); // never the number in logs
  send(200, { ok: true });
  return true;
}
