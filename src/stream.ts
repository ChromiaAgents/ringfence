// Live-stream gifts: NEAR sent to a streamer's account, shown on the overlay (/stream/<account>) and the room
// (/room/<account>). Two sources: sends made on a Ringfence call (pushed here as they happen, a held first payment
// shows as "landing" first) and transfers from any wallet, read from the chain while a room is being watched.
// Kept in db.gifts (last 500), so a restart keeps the feed and the leaderboard.
import { db, save } from './store.ts';

export type Gift = { to: string; near: number; from: string; at: number; url?: string; tx?: string; via: 'call' | 'chain'; landsAt?: number };
const all = (): Gift[] => ((db as any).gifts ??= []);

/** A sender as shown on a public stream: never a full phone number. */
export const maskFrom = (phone?: string, name?: string) => name || (phone ? `+${phone.slice(0, 2)}•••${phone.slice(-3)}` : 'someone');

let saveT: ReturnType<typeof setTimeout> | undefined;
export function pushGift(g: Gift) {
  const list = all();
  if (g.tx && list.some((x) => x.tx === g.tx)) return; // the same transfer seen twice (call + chain)
  list.push(g);
  if (list.length > 500) list.splice(0, list.length - 500);
  clearTimeout(saveT); saveT = setTimeout(save, 1000);
}
/** A held gift went out: it stops showing "landing". */
export function landGift(to: string, from: string, near: number, url?: string) {
  const g = [...all()].reverse().find((x) => x.to === to && x.from === from && x.near === near && x.landsAt);
  if (g) { delete g.landsAt; g.url = url ?? g.url; g.at = Date.now(); clearTimeout(saveT); saveT = setTimeout(save, 1000); }
}
export const giftsTo = (account: string, since = 0) => all().filter((g) => g.to === account && g.at > since).slice(-30);
export function topGifters(account: string, n = 5) {
  const m = new Map<string, number>();
  for (const g of all()) if (g.to === account && !g.landsAt) m.set(g.from, (m.get(g.from) ?? 0) + g.near);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([from, near]) => ({ from, near: Math.round(near * 1e4) / 1e4 }));
}
export const totalTo = (account: string) => Math.round(all().filter((g) => g.to === account && !g.landsAt).reduce((s, g) => s + g.near, 0) * 1e4) / 1e4;

// ---- transfers from any wallet, read from the chain while someone watches the room ----
const watched: Map<string, { seenUntil: number; since: number; busy?: boolean }> = ((globalThis as any).__rfWatched ??= new Map());
/** Called by the feed endpoint: keep reading this account's incoming transfers for the next minute. */
export function watch(account: string) {
  const w = watched.get(account);
  if (w) { w.seenUntil = Date.now() + 60_000; return; }
  watched.set(account, { seenUntil: Date.now() + 60_000, since: Date.now() - 10 * 60_000 });
}
async function poll() {
  for (const [acct, w] of watched) {
    if (Date.now() > w.seenUntil) { watched.delete(acct); continue; }
    if (w.busy) continue; w.busy = true;
    try {
      const r: any = await fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(acct)}/txns-only?per_page=15&order=desc`, { signal: AbortSignal.timeout(8000) }).then((x) => x.json());
      for (const t of r?.txns ?? []) {
        const at = Number(BigInt(t.block_timestamp ?? 0) / 1_000_000n), dep = Number(t.actions_agg?.deposit ?? 0) / 1e24;
        if (t.receiver_account_id !== acct || t.signer_account_id === acct || !(dep >= 0.001) || at <= w.since || !t.outcomes?.status) continue;
        if (!(t.actions ?? []).some((a: any) => a.action === 'TRANSFER')) continue;
        pushGift({ to: acct, near: Math.round(dep * 1e4) / 1e4, from: t.signer_account_id, at, tx: t.transaction_hash, url: `https://nearblocks.io/txns/${t.transaction_hash}`, via: 'chain' });
      }
      w.since = Math.max(w.since, Date.now() - 2 * 60_000);
    } catch {} finally { w.busy = false; }
  }
}
if (!(globalThis as any).__rfGiftPoll) (globalThis as any).__rfGiftPoll = setInterval(() => { poll().catch(() => {}); }, 8000).unref?.();
