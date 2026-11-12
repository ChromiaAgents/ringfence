// The live panel: a fallback screen for a WhatsApp call when WhatsApp messages cannot reach the caller (Meta blocks
// messages from an unverified business number, but calls work). Each WhatsApp call gets a random 6-digit code; links
// and Approve cards that WhatsApp failed to deliver go to /live, where the caller types the code.
// Memory only: a code lives for the call and 10 minutes after it, then it is gone. Never holds a transcript or a PIN,
// and the JSON never carries the phone number or the approval token.
import { randomInt, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from './config.ts';

type Panel = { code: string; callId: string; phone: string; endedAt?: number; links: { label: string; url: string }[];
  approval: { id: string; body: string; token: string } | null; told: boolean; startedAt: number };
const AFTER_MS = 10 * 60_000;
// A code never outlives this, even if the call never ended cleanly (no terminate webhook, a crash mid-setup).
const MAX_LIFE_MS = 2 * 60 * 60_000;
const byCode = new Map<string, Panel>();
const byCall = new Map<string, Panel>();

const gone = (p: Panel, now: number) => (p.endedAt != null && now > p.endedAt + AFTER_MS) || now > p.startedAt + MAX_LIFE_MS;
function drop(p: Panel) { byCode.delete(p.code); if (byCall.get(p.callId) === p) byCall.delete(p.callId); }
function prune(now = Date.now()) { for (const p of byCode.values()) if (gone(p, now)) drop(p); }

/** A WhatsApp call started: a fresh code, unique among active codes. */
export function startLive(callId: string, phone: string): string {
  prune();
  let code: string;
  do code = String(randomInt(0, 1_000_000)).padStart(6, '0'); while (byCode.has(code));
  const p: Panel = { code, callId, phone, links: [], approval: null, told: false, startedAt: Date.now() };
  byCode.set(code, p); byCall.set(callId, p);
  return code;
}
/** The call ended: the code keeps working for 10 more minutes, then it is deleted. */
export function endLive(callId: string, now = Date.now()) {
  const p = byCall.get(callId);
  if (!p || p.endedAt != null) return;
  p.endedAt = now;
  setTimeout(() => { if (gone(p, Date.now())) drop(p); }, AFTER_MS + 1000).unref?.();
}
export const hasLive = (callId: string) => { const p = byCall.get(callId); return !!p && !gone(p, Date.now()); };

/** What the agent says, once per call, the first time something lands on the panel; '' after that. */
function tellOnce(p: Panel): string {
  if (p.told) return '';
  p.told = true;
  const d = p.code.split('').join(', ');
  return `I can't text you right now. Open ringfence dot evalengine dot ai slash live and enter code ${d}. Again, the code is ${d}.`;
}
/** A link WhatsApp could not deliver. Returns the line to say ('' when already said), or null when this call has no panel. */
export function liveLink(callId: string, link: { label: string; url: string }): string | null {
  const p = byCall.get(callId);
  if (!p || gone(p, Date.now())) return null;
  if (!p.links.some((l) => l.url === link.url)) p.links.push({ label: link.label, url: link.url });
  return tellOnce(p);
}
/** An Approve card WhatsApp could not deliver. Same return as liveLink. */
export function liveApproval(callId: string, body: string, token: string): string | null {
  const p = byCall.get(callId);
  if (!p || gone(p, Date.now())) return null;
  p.approval = { id: randomBytes(8).toString('hex'), body, token };
  return tellOnce(p);
}

export type LiveView = { state: 'live' | 'ended'; links: { label: string; url: string }[]; approval: { body: string; id: string } | null };
export function liveView(code: string, now = Date.now()): LiveView | null {
  const p = byCode.get(code);
  if (!p || gone(p, now)) return null;
  return { state: p.endedAt != null ? 'ended' : 'live', links: p.links.map((l) => ({ label: l.label, url: l.url })), approval: p.approval && { body: p.approval.body, id: p.approval.id } };
}

/** The same handler a WhatsApp button tap runs (onButton in src/desks/wallet.ts), passed in by the caller. */
export type TapHandler = (from: string, id: string) => Promise<string>;
export async function liveTap(code: string, id: string, action: string, onTap: TapHandler): Promise<string | null> {
  const p = byCode.get(code);
  if (!p || gone(p, Date.now()) || !p.approval || p.approval.id !== id || !['approve', 'cancel', 'reject'].includes(action)) return null;
  const { token } = p.approval;
  p.approval = null;
  return onTap(p.phone, `${action}:${token}`);
}

// ---- HTTP: GET /api/live/:code, POST /api/live/:code/tap ----
const hits = new Map<string, { at: number; n: number; wrong: number }>();
// LIMIT is far above the panel's own poll rate (one GET every 2 s = 30 a minute), so a real user never hits it;
// wrong codes have their own, much smaller budget.
const LIMIT = 180, WRONG = 5, WINDOW = 60_000;
// Across all IPs: a botnet gets at most this many wrong codes a minute in total (1 in 10^6 each).
const WRONG_ALL = 300;
let wrongAll = { at: 0, n: 0 };
export const ipOf = (req: IncomingMessage) => {
  const a = req.socket.remoteAddress ?? '';
  // Behind the local reverse proxy the socket is loopback: then the proxy's forwarded address is the caller.
  return /^(::1|127\.|::ffff:127\.)/.test(a) ? String(req.headers['x-forwarded-for'] ?? a).split(',')[0].trim() : a;
};
function bucket(ip: string, now: number) {
  let b = hits.get(ip);
  if (!b || now - b.at > WINDOW) { b = { at: now, n: 0, wrong: 0 }; hits.set(ip, b); }
  if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.at > WINDOW) hits.delete(k);
  return b;
}
export const resetLiveLimitsForTest = () => hits.clear();

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

async function readJson(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 2000) throw new Error('too big'); }
  return JSON.parse(s || '{}');
}

/** Handles /api/live/*; returns false for any other path. */
export async function handleLive(req: IncomingMessage, res: ServerResponse, onTap: TapHandler): Promise<boolean> {
  const m = /^\/api\/live\/([^/]*)(\/tap)?$/.exec((req.url ?? '/').split('?')[0]);
  if (!m) return false;
  const now = Date.now(), b = bucket(ipOf(req), now);
  if (now - wrongAll.at > WINDOW) wrongAll = { at: now, n: 0 };
  if (++b.n > LIMIT || b.wrong >= WRONG || wrongAll.n >= WRONG_ALL) { json(res, 429, { error: 'Too many tries. Wait a minute.' }); return true; }
  const code = m[1];
  const found = /^\d{6}$/.test(code) ? liveView(code, now) : null;
  if (m[2]) {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST only' }); return true; }
    if (req.headers.origin !== new URL(env.publicUrl).origin) { json(res, 403, { error: 'Forbidden' }); return true; }
    if (!found) { b.wrong++; wrongAll.n++; json(res, 404, { error: 'Not found' }); return true; }
    const body = await readJson(req).catch(() => null);
    const said = body && (await liveTap(code, String(body.id ?? ''), String(body.action ?? ''), onTap));
    if (!said) { json(res, 409, { error: 'That approval is not valid any more.' }); return true; }
    json(res, 200, { ok: true, message: said });
    return true;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'GET only' }); return true; }
  if (!found) { b.wrong++; wrongAll.n++; json(res, 404, { error: 'Not found' }); return true; }
  json(res, 200, found);
  return true;
}
