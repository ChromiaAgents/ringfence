// The packet desk: someone with a red packet's link or id says the packet's words and gets a share.
// The chat model never knows the words: this code checks what the caller actually said (their own last turns),
// then asks the packets contract to pay. Funding a packet is the wallet desk's prepare_packet (PIN, limits, Approve).
import { env } from '../config.ts';
import { log, type Call } from '../store.ts';
import { bindingOf } from '../wallet.ts';
import { findPacket, openPacket, publicPacket, packetUrl } from '../packets.ts';
import { parseRecipient } from './wallet.ts';
import type { DeskDef } from './types.ts';

const tools = [
  { type: 'function', function: { name: 'open_packet', description: 'Open the caller\'s share of a red packet. The tool itself checks whether the caller said the words; you never pass the words. Call it again after they say the words or give an account.', parameters: { type: 'object', properties: { packet_id: { type: 'string', description: 'the id from the packet link, e.g. 3fa9c2d1' }, account: { type: 'string', description: 'browser calls only: the NEAR account to pay, e.g. alice.near' } }, required: ['packet_id'] } } },
  { type: 'function', function: { name: 'get_packet', description: 'A red packet\'s status: who sent it, how many shares are left, when it expires.', parameters: { type: 'object', properties: { packet_id: { type: 'string' } }, required: ['packet_id'] } } },
];

const MAX_TRIES = 5;
const tries = new Map<string, number>(); // call:packet -> wrong tries
const linkOf = new Map<string, { url: string; label: string }>();
/** call:packet -> how the words were accepted on this call, so they are not asked again once the account is given. */
const said = new Map<string, 'exact' | 'ai'>();

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const id = String(a.packet_id || call.packetId || '').trim().toLowerCase();
  const p = findPacket(id);
  if (!p) return { ok: false, reason: 'There is no red packet with that id. Ask them to read the id from the link again.' };
  if (name === 'get_packet') { const v = publicPacket(p); return { ok: true, from: v.from, total_near: v.near, shares: v.count, opened: v.claims.length, lucky_split: v.lucky, expired: v.expired, dryRun: v.dryRun || undefined }; }
  if (name !== 'open_packet') return { error: 'unknown tool' };
  const key = `${call.id}:${id}`;
  if ((tries.get(key) ?? 0) >= MAX_TRIES) return { ok: false, reason: 'Too many wrong tries on this call. They can call again later.' };
  // Who gets it: on WhatsApp, the caller's own phone wallet; on a browser call, the NEAR account they name.
  let to: string | null;
  if (call.channel === 'whatsapp') {
    const b = bindingOf(call.from);
    if (!b) return { ok: false, reason: 'This number has no wallet yet. They text "create a wallet" first (one minute), then open the packet again.' };
    to = b.contract;
  } else to = a.account ? parseRecipient(String(a.account), 'near') : call.payTo ?? null;
  if (a.account && !to && call.channel !== 'whatsapp') return { ok: false, need: 'account', reason: `That is not a NEAR ${env.network} account. Ask again: it looks like alice dot ${env.network === 'mainnet' ? 'near' : 'testnet'}.` };
  // Only what the caller said themselves counts, never what the model passes.
  const heard = call.turns.filter((t) => t.who === 'caller' && t.text !== '[PIN]').slice(-3).map((t) => t.text);
  const r = await openPacket(id, to, heard, call.id, said.get(key));
  if (!r.ok) {
    if (r.need === 'account' && r.how) said.set(key, r.how);
    if (r.need === 'words') { tries.set(key, (tries.get(key) ?? 0) + 1); log({ kind: 'refused', desk: 'packet', callId: call.id, detail: `red packet ${id}: the words were not said (try ${tries.get(key)})` }); }
    return r;
  }
  linkOf.set(call.id, { url: r.url ?? packetUrl(id), label: r.url ? 'Your share, on chain' : 'The red packet' });
  return { ...r, linkSent: true, next: `Tell them how much they got${r.left ? ` and that ${r.left} share${r.left === 1 ? ' is' : 's are'} left for others` : ''}.${r.dryRun ? ' Say it is a dry run: no real money moved.' : ''}` };
}

export const packetDesk: DeskDef = {
  id: 'packet',
  greeting: () => 'There\'s a red packet waiting for you. Say the words to open it.',
  system: (call) => `Opening a red packet: someone who has a packet's link or id says its words to open a share. Call open_packet with the packet id${call.packetId ? ` (this call came from the page of packet ${call.packetId}: use that id, don't ask for it)` : ''}. You do not know the words and must never guess or hint at them; the tool checks what the caller actually said. If it answers need "words", ask them to say the words; need "account", ask which NEAR account should get it.${call.payTo ? ` This caller already typed their account on the page (${call.payTo}): don't ask for it.` : ''} When it pays, tell them the amount with some warmth.`,
  tools,
  run,
  link: (call) => linkOf.get(call.id) ?? null,
};
