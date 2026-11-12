// Live-stream overlay data: gifts sent by phone call to a streamer's NEAR account, and a money packet raced live.
// In memory (ponytail: a restart clears the feed; the money itself is on chain). Shared across bundles via globalThis.
export type Gift = { to: string; near: number; from: string; at: number; url?: string };
const gifts: Gift[] = ((globalThis as any).__rfGifts ??= []);

/** A sender as shown on a public stream: never the full number. */
export const maskFrom = (phone?: string, name?: string) => name || (phone ? `+${phone.slice(0, 2)}•••${phone.slice(-3)}` : 'someone');

export function pushGift(g: Gift) {
  gifts.push(g);
  if (gifts.length > 500) gifts.splice(0, gifts.length - 500);
}
export const giftsTo = (account: string, since = 0) => gifts.filter((g) => g.to === account && g.at > since).slice(-30);
