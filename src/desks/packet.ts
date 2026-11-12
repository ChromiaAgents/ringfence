// The packet desk: someone with a money packet's link or id says the packet's words and gets a share.
// The chat model never knows the words: this code checks what the caller actually said (their own last turns),
// then asks the packets contract to pay. Funding a packet is the wallet desk's prepare_packet (PIN, limits, Approve).
import { env } from '../config.ts';
import { log, type Call } from '../store.ts';
import { bindingOf } from '../wallet.ts';
import { findPacket, openPacket, publicPacket, packetUrl } from '../packets.ts';
import { parseRecipient } from './wallet.ts';
import type { DeskDef } from './types.ts';

const tools = [
  { type: 'function', function: { name: 'open_packet', description: 'Open the caller\'s share of a money packet. The tool itself checks whether the caller said the words; you never pass the words. Call it again after they say the words or give an account.', parameters: { type: 'object', properties: { packet_id: { type: 'string', description: 'the id from the packet link, e.g. 3fa9c2d1, as the caller gave it (spelled out or a pasted link is fine). Leave empty if they have not given one: the tool says how to guide them.' }, account: { type: 'string', description: 'browser calls only: the NEAR account to pay, e.g. alice.near' } } } } },
  { type: 'function', function: { name: 'get_packet', description: 'A money packet\'s status: who sent it, how many shares are left, when it expires.', parameters: { type: 'object', properties: { packet_id: { type: 'string' } }, required: ['packet_id'] } } },
];

const MAX_TRIES = 5;
const tries = new Map<string, number>(); // call:packet -> wrong tries
const linkOf = new Map<string, { url: string; label: string }>();
/** call:packet -> how the words were accepted on this call, so they are not asked again once the account is given. */
const said = new Map<string, 'exact' | 'ai'>();

/** Who gets a share on this call: the caller's phone wallet on WhatsApp, the account typed on the page or said aloud in a browser. */
function payee(call: Call, account?: unknown): { to: string | null; reason?: string } {
  if (call.channel === 'whatsapp') {
    const b = bindingOf(call.from);
    return b ? { to: b.contract } : { to: null, reason: 'This number has no wallet yet. They text "create a wallet" first (one minute), then open the packet again.' };
  }
  return { to: account ? parseRecipient(String(account), 'near') : call.payTo ?? null };
}
const opened = new Map<string, object>(); // call:packet -> the share paid on this call

/** On a call that is about one packet, what the caller just said is checked here, before the model answers: whether
 *  the model decides to call the tool or not ("What? Ah!" for "huat ah" reads like a question), saying the words works.
 *  Returns what happened for the model to tell them, or null when the words were not said (the call just goes on). */
export async function autoOpen(call: Call): Promise<unknown | null> {
  const id = call.packetId;
  if (!id || !findPacket(id) || opened.has(`${call.id}:${id}`)) return null;
  const last = [...call.turns].reverse().find((t) => t.who === 'caller');
  if (!last || last.text === '[PIN]') return null;
  const who = payee(call), key = `${call.id}:${id}`;
  if (who.reason) return null;
  const r = await openPacket(id, who.to, [last.text], call.id, said.get(key));
  if (r.ok) { opened.set(key, r); linkOf.set(call.id, { url: r.url ?? packetUrl(id), label: r.url ? 'Your share, on chain' : 'The money packet' }); return { tool: 'open_packet', ...r }; }
  if (r.need === 'account' && r.how) { said.set(key, r.how); return { tool: 'open_packet', ...r }; }
  return null;
}

/** How to name a packet when the call did not start from its page: said back to the caller, step by step. */
const GUIDE = 'I need to know which packet. Guide them: open the packet link the sender gave you, and tap Call on that page (easiest, it knows the packet). Or read me the 8 characters at the end of the link, after "packet slash", letter by letter, like "8 b b 9 7 7 8 d". On WhatsApp you can also type it on the live panel. Never guess an id, and never look a packet up by its words.';
const HEXWORD: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', bee: 'b', be: 'b', see: 'c', sea: 'c', dee: 'd', ee: 'e', eff: 'f', ef: 'f', ay: 'a', eh: 'a' };
/** An id as given: "8bb9778d", a pasted link, or spelled out ("8 b b 9 7 7 8 d", "eight bee bee nine..."). */
function packetIdFrom(x: unknown): string {
  const t = String(x ?? '').toLowerCase();
  const link = t.match(/packet\/([0-9a-z-]{4,40})/)?.[1];
  if (link) return link;
  const joined = t.split(/[^0-9a-z]+/).map((w) => HEXWORD[w] ?? w).join('');
  return joined.match(/[0-9a-f]{8}/)?.[0] ?? t.trim();
}
/** The caller's last two turns, in case they said or typed the id before the model passed it. */
const spokenId = (call: Call) => {
  for (const t of call.turns.slice(-4).reverse()) if (t.who === 'caller') { const id = packetIdFrom(t.text); if (findPacket(id)) return id; }
  return '';
};

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const id = packetIdFrom(a.packet_id) || call.packetId || spokenId(call) || '';
  const p = findPacket(id);
  if (p && !call.packetId) call.packetId = p.id; // from here on, this call is about that packet
  if (!p) return { ok: false, need: 'packet', reason: id ? `There is no money packet with that id (${id}). Ask them to read it again from the link, letter by letter. ${GUIDE}` : GUIDE };
  if (name === 'get_packet') { const v = publicPacket(p); return { ok: true, from: v.from, total_near: v.near, shares: v.count, opened: v.claims.length, lucky_split: v.lucky, expired: v.expired, dryRun: v.dryRun || undefined }; }
  if (name !== 'open_packet') return { error: 'unknown tool' };
  const key = `${call.id}:${id}`;
  if ((tries.get(key) ?? 0) >= MAX_TRIES) return { ok: false, reason: 'Too many wrong tries on this call. They can call again later.' };
  // Who gets it: on WhatsApp, the caller's own phone wallet; on a browser call, the NEAR account they name.
  const who = payee(call, a.account);
  if (who.reason) return { ok: false, reason: who.reason };
  const to = who.to;
  // Already paid on this call (the check runs before the model answers): the same result again, never a second share.
  if (opened.has(key)) return { ...opened.get(key), linkSent: true, next: 'Their share was already paid on this call: tell them the amount.' };
  if (a.account && !to && call.channel !== 'whatsapp') return { ok: false, need: 'account', reason: `That is not a NEAR ${env.network} account. Ask again: it looks like alice dot ${env.network === 'mainnet' ? 'near' : 'testnet'}.` };
  // Only what the caller said themselves counts, never what the model passes.
  const heard = call.turns.filter((t) => t.who === 'caller' && t.text !== '[PIN]').slice(-3).map((t) => t.text);
  const r = await openPacket(id, to, heard, call.id, said.get(key));
  if (!r.ok) {
    if (r.need === 'account' && r.how) said.set(key, r.how);
    if (r.need === 'words') { tries.set(key, (tries.get(key) ?? 0) + 1); log({ kind: 'refused', desk: 'packet', callId: call.id, detail: `money packet ${id}: the words were not said (try ${tries.get(key)})` }); }
    return r;
  }
  opened.set(key, r);
  linkOf.set(call.id, { url: r.url ?? packetUrl(id), label: r.url ? 'Your share, on chain' : 'The money packet' });
  return { ...r, linkSent: true, next: `Tell them how much they got${r.left ? ` and that ${r.left} share${r.left === 1 ? ' is' : 's are'} left for others` : ''}.${r.dryRun ? ' Say it is a dry run: no real money moved.' : ''}` };
}

export const packetDesk: DeskDef = {
  id: 'packet',
  greeting: () => 'There\'s a money packet waiting for you. Say the words to open it.',
  system: (call) => `Opening a money packet: someone who has a packet's link or id says its words to open a share. Call open_packet with the packet id${call.packetId ? ` (this call came from the page of packet ${call.packetId}: use that id, don't ask for it)` : ''}. If they want to open a packet but you have no id, call open_packet anyway (with what they said, or empty): it returns how to guide them. You do not know the words and must never guess or hint at them; the tool checks what the caller actually said. If it answers need "words", ask them to say the words; need "account", ask which NEAR account should get it.${call.payTo ? ` This caller already typed their account on the page (${call.payTo}): don't ask for it.` : ''} When it pays, tell them the amount with some warmth.`,
  tools,
  run,
  link: (call) => linkOf.get(call.id) ?? null,
};
