// NEAR AI Cloud keys: a primary (NEARAI_API_KEY, e.g. a NEARON org paid from staking rewards) and a fallback
// (NEARAI_API_KEY_FALLBACK). If the primary answers "no balance", "unauthorised", "rate limited", a server error
// or does not answer, the same request is retried on the fallback, and the primary is skipped for a while.
import { env } from './config.ts';

const BREAK_MS = 10 * 60_000; // ponytail: one global breaker; per-endpoint breakers if one model fails alone
let primaryDownUntil = 0;
let fallbackDead = false; // a fallback key that answered 401/403 is invalid: stop sending it

export const hasAiKey = () => !!(env.nearAiKey || env.nearAiKeyFallback);

/** Which key served a request, by position, so the signature check can use the same org without storing the key. */
export type KeySlot = 0 | 1;
export const keyOf = (slot: KeySlot) => (slot === 0 ? env.nearAiKey : env.nearAiKeyFallback) || env.nearAiKey || env.nearAiKeyFallback;

const retryable = (status: number) => status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;

/** Run `f` with the primary key, falling back on a retryable failure. Returns the response and the slot used. */
/** The API base for a key: the fallback may live on another NEAR AI endpoint (NEARON keys: cloud-stg-api.near.ai). */
export const baseOf = (slot: KeySlot) => (slot === 1 ? env.nearAiBaseFallback : env.nearAiBase) || 'https://cloud-api.near.ai/v1';

export async function withAiKey(f: (key: string, base: string) => Promise<Response>): Promise<{ r: Response; slot: KeySlot }> {
  const slots: KeySlot[] = [];
  if (env.nearAiKey && Date.now() >= primaryDownUntil) slots.push(0);
  if (env.nearAiKeyFallback && !fallbackDead) slots.push(1);
  if (!slots.length) slots.push(0); // only a primary, and it is in its break: try it anyway
  let last: unknown;
  let primaryFailed = false;
  for (const [i, slot] of slots.entries()) {
    const more = i < slots.length - 1;
    try {
      const r = await f(keyOf(slot), baseOf(slot));
      if (slot === 1 && (r.status === 401 || r.status === 403)) { fallbackDead = true; console.log('[ai] fallback key rejected, not using it again'); }
      if (!retryable(r.status)) {
        // Skip the primary for a while only when the fallback really answered.
        if (slot === 1 && primaryFailed) { primaryDownUntil = Date.now() + BREAK_MS; console.log('[ai] primary key failed, using the fallback for 10 minutes'); }
        return { r, slot };
      }
      if (!more) return { r, slot };
      await r.body?.cancel().catch(() => {});
    } catch (e: any) {
      if (e?.name === 'AbortError' || !more) throw e; // a timeout is a TimeoutError: falls through to the next key
      last = e;
    }
    if (slot === 0) primaryFailed = true;
  }
  throw last ?? new Error('no NEAR AI key answered');
}

/** A slot that stalled mid-answer: skip the primary for a while (the fallback is never benched, it is the last resort). */
export const markSlowSlot = (slot: KeySlot) => { if (slot === 0 && env.nearAiKeyFallback) { primaryDownUntil = Date.now() + BREAK_MS; console.log('[ai] primary stalled, using the fallback for 10 minutes'); } };

/** For tests. */
export const resetAiKeys = () => { primaryDownUntil = 0; fallbackDead = false; };
