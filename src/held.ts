// The first payment to an account a phone-only wallet has never paid is not sent at once. The wallet contract itself
// holds it (its new-recipient queue, new_recipient_delay_sec), then the agent runs it, and the owner's key saves the
// recipient so the next payment is instant. A scammer on the line can't get money out in a hurry, and the caller can
// stop it by saying "cancel" or tapping Not me. Phone-only (custodial) wallets only: an owner with their own wallet
// signs a first payment themselves. ponytail: the list is in the one JSON db and checked every 15 s; a job queue if it grows.
import { db, save, log } from './store.ts';
import { bindingOf, runQueued, cancelQueued, saveRecipient } from './wallet.ts';
import { notify } from './notify.ts';
import { startRefundLoop } from './packets.ts';

export type Held = { id: number; phone: string; contract: string; to: string; what: string; readyAt: number; callId?: string; tries?: number };

export function hold(h: Held) { db.held.push(h); save(); }
const drop = (h: Held) => { db.held = db.held.filter((x) => x !== h); save(); };
export const minutes = (sec: number) => (sec < 90 ? `${sec} seconds` : `${Math.round(sec / 60)} minutes`);

/** Runs every held payment whose wait is over. */
export async function runDue(now = Date.now(), d = { run: runQueued, allow: saveRecipient }) {
  for (const h of db.held.filter((x) => now >= x.readyAt)) {
    const b = bindingOf(h.phone);
    if (!b || b.contract !== h.contract) { drop(h); continue; }
    if (b.frozenUntil && now < b.frozenUntil) continue; // Not me was tapped: nothing leaves while the wallet is locked
    const r = await d.run(b, h.id).catch((e) => e as Error);
    if (r instanceof Error) {
      h.tries = (h.tries ?? 0) + 1;
      // The chain's clock decides when the wait is over; a few seconds early is tried again.
      if (/waiting period/.test(r.message) && h.tries < 20) { h.readyAt = now + 15_000; save(); continue; }
      drop(h);
      log({ kind: 'refused', desk: 'wallet', callId: h.callId, detail: `held payment ${h.what} from ${h.contract} did not go: ${r.message.slice(0, 160)}` });
      notify(h.phone, `Your payment of ${h.what} did not go through, and nothing left your wallet. Call again to retry.`);
      continue;
    }
    drop(h);
    log({ kind: 'wallet', desk: 'wallet', callId: h.callId, detail: `${h.what} from ${h.contract}, after the new-recipient wait: ${r.url}` });
    const saved = await d.allow(b, h.to).then(() => true, () => false);
    notify(h.phone, `Sent: ${h.what}. ${r.url}${saved ? `\n${h.to} is now a saved recipient, so next time it goes at once.` : ''}`);
  }
}

/** Stops every payment this phone has waiting. Returns what was stopped. */
export async function cancelHeld(phone: string, d = { cancel: cancelQueued }): Promise<string[]> {
  const b = bindingOf(phone), out: string[] = [];
  for (const h of db.held.filter((x) => x.phone === phone)) {
    if (b) await d.cancel(b, h.id).catch((e) => console.error('cancel held', h.id, (e as Error).message.slice(0, 120)));
    drop(h);
    out.push(h.what);
    log({ kind: 'wallet', desk: 'wallet', callId: h.callId, detail: `held payment cancelled before it went out: ${h.what} from ${h.contract}` });
  }
  return out;
}

/** The server's background loop: held payments every 15 s, and expired money packets sent back every minute. */
export const startHeldLoop = () => { startRefundLoop(); return setInterval(() => runDue().catch((e) => console.error('held payments', e)), 15_000).unref(); };
