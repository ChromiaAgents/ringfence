// The top-up page: a refund address is a long string nobody can say on a call. The agent sends a link to
// /topup/:id (WhatsApp text, or the live panel code); the caller pastes their refund address there and the page
// shows the 1Click deposit address. This server never holds the funds: the caller sends them straight to 1Click.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { env } from './config.ts';
import { quoteTopup, topupLive } from './fund.ts';
import { ipOf } from './live.ts';

type Pending = { usd: number; token: string; recipient: string; demo: boolean; at: number; tries: number; phone?: string; deposit?: string; status?: string; out?: string; tx?: string; inTx?: string; chain?: string };
const pending: Map<string, Pending> = ((globalThis as any).__rfTopups ??= new Map()); // shared across bundles
const LIFE_MS = 2 * 60 * 60_000; // ponytail: in memory; a restart drops open top-up links, the caller asks again

/** A top-up link for this call. */
export function newTopup(p: Omit<Pending, 'at' | 'tries'>): string {
  const id = randomBytes(6).toString('hex');
  pending.set(id, { ...p, at: Date.now(), tries: 0 });
  for (const [k, v] of pending) if (Date.now() - v.at > LIFE_MS) pending.delete(k);
  return id;
}

export async function handleTopup(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const st = (req.url ?? '').split('?')[0].match(/^\/api\/topup\/([0-9a-f]{12})\/status$/);
  if (st) {
    const p = pending.get(st[1]);
    res.writeHead(p ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(p ? { status: p.status ?? (p.deposit ? 'PENDING_DEPOSIT' : null), out: p.out, tx: p.tx, inTx: p.inTx, chain: p.chain, deposit: p.deposit } : { error: 'expired' }));
    return true;
  }
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
  if ((q as any).depositAddress) { p.deposit = (q as any).depositAddress; p.status = 'PENDING_DEPOSIT'; watch(m[1], p, Date.parse((q as any).deadline)); }
  send(200, { ...info, quote: q, status: (q as any).depositAddress ? `https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent((q as any).depositAddress)}` : null });
  return true;
}

/** Follows one deposit on 1Click until it settles; tells the caller's call (and their WhatsApp) when the USDC lands. */
function watch(id: string, p: Pending, deadline: number) {
  const until = (Number.isFinite(deadline) ? deadline : Date.now() + 30 * 60_000) + 30 * 60_000;
  const tick = async () => {
    if (!pending.has(id) || Date.now() > until) return;
    const j: any = await fetch(`https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(p.deposit!)}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
    const was = p.status;
    if (j?.status) p.status = j.status;
    p.inTx ??= j?.swapDetails?.originChainTxHashes?.[0]?.hash;
    p.chain ??= String(p.token).split(' on ')[1];
    if (j?.status === 'SUCCESS') {
      p.out = j.swapDetails?.amountOutFormatted; p.tx = j.swapDetails?.destinationChainTxHashes?.[0]?.hash ?? j.swapDetails?.nearTxHashes?.at(-1);
      if (was !== 'SUCCESS') {
        console.log('[topup] landed');
        const msg = `Your top up landed: about ${Number(p.out).toFixed(2)} USDC is in your wallet on NEAR.`;
        if (p.phone) {
          const { sayOnCall, sendText } = await import('./whatsapp.ts');
          sayOnCall(p.phone, msg, `The caller's top up has landed: ${p.out} USDC arrived in ${p.recipient} (NEAR tx ${p.tx}). Tell them if they ask; get_balance shows it.`);
          sendText(p.phone, `${msg}${p.tx ? ` https://nearblocks.io/txns/${p.tx}` : ''}`).catch(() => {});
        }
      }
      return;
    }
    if (['REFUNDED', 'FAILED'].includes(j?.status)) {
      if (was !== j.status && p.phone) { const { sayOnCall } = await import('./whatsapp.ts'); sayOnCall(p.phone, j.status === 'REFUNDED' ? 'Your top up did not go through and was refunded to your address.' : 'Your top up failed. Check the swap link on the page.'); }
      return;
    }
    setTimeout(tick, 8000);
  };
  setTimeout(tick, 5000);
}
