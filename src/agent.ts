// One engine, several desks. The runtime (history, tool loop, TEE-signed replies, output filter) is shared;
// each desk brings its own config file, prompt and tools, and its rules live in those tools' code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chat, type Msg } from './ai.ts';
import { describePhoto } from './image.ts';
import { db, save, id, log, type Call, type Desk } from './store.ts';
import type { DeskDef } from './desks/types.ts';
import { launchDesk } from './desks/launch.ts';
import { businessDesk } from './desks/business.ts';
import { ownerDesk } from './desks/owner.ts';

export const DESKS: Record<Desk, DeskDef> = { launch: launchDesk, business: businessDesk, owner: ownerDesk };

export const ROUTER_GREETING = 'Hi, this is callhand. Are you calling to launch a memecoin, or about building work?';

/** Picks a desk from what the caller says first. Plain keywords, so the choice is predictable and testable. */
export function route(text: string): Desk | null {
  const t = text.toLowerCase();
  if (/\b(meme ?coins?|coins?|tokens?|tickers?|launch\w*|meme\.?cooking|memes?|pump|degen|crypto)\b/.test(t)) return 'launch';
  if (/\b(kitchen|bathroom|extension|repair\w*|build\w*|roof\w*|plumb\w*|leak\w*|tiles?|quote|renovat\w*|loft|wall|floor\w*|window|door|paint\w*|job|house|flat)\b/.test(t)) return 'business';
  return null;
}

// ---- hooks for channels (WhatsApp sends links as messages) ----
type LinkHook = (call: Call, link: { url: string; label: string }) => void;
let onLink: LinkHook | undefined;
export const setOnLink = (f: LinkHook) => (onLink = f);

const histories = new Map<string, Msg[]>();

export function startCall(channel: Call['channel'], from?: string, desk?: Desk): { call: Call; greeting: string } {
  const call: Call = { id: id(), channel, desk, from, startedAt: Date.now(), turns: [] };
  db.calls.push(call);
  const greeting = desk ? DESKS[desk].greeting() : ROUTER_GREETING;
  call.turns.push({ at: Date.now(), who: 'agent', text: greeting });
  histories.set(call.id, desk ? [{ role: 'system', content: DESKS[desk].system(call) }, { role: 'assistant', content: greeting }] : []);
  save();
  return { call, greeting };
}

function enterDesk(call: Call, desk: Desk) {
  call.desk = desk;
  const h = histories.get(call.id)!;
  h.splice(0, h.length, { role: 'system', content: DESKS[desk].system(call) }, { role: 'assistant', content: ROUTER_GREETING });
  call.turns.push({ at: Date.now(), who: 'tool', text: `routed to the ${desk} desk` });
}

export async function reply(callId: string, text: string): Promise<string> {
  const call = db.calls.find((c) => c.id === callId);
  const h = histories.get(callId);
  if (!call || !h) throw new Error('no such call');
  call.turns.push({ at: Date.now(), who: 'caller', text });
  if (!call.desk) {
    const d = route(text);
    if (!d) {
      const ask = 'Sorry, is that a coin launch, or building work?';
      call.turns.push({ at: Date.now(), who: 'agent', text: ask });
      save();
      return ask;
    }
    enterDesk(call, d);
  }
  const desk = DESKS[call.desk!];
  h[0] = { role: 'system', content: desk.system(call) }; // pick up config changes mid-call
  h.push({ role: 'user', content: text });
  const before = desk.link?.(call)?.url;
  for (let step = 0; step < 6; step++) {
    const { msg, proof } = await chat(h, desk.tools);
    h.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const out = await desk.run(call, tc.function.name, args).catch((e) => ({ ok: false, reason: String(e.message) }));
        call.turns.push({ at: Date.now(), who: 'tool', text: `${tc.function.name}(${JSON.stringify(args)}) → ${JSON.stringify(out)}`, proof });
        h.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      continue;
    }
    let say = (msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const f = desk.filter?.(say);
    if (f?.hit) {
      log({ kind: 'filtered', desk: desk.id, callId: call.id, detail: `reply said "${f.hit}"; replaced before it was spoken` });
      say = f.text;
    }
    call.turns.push({ at: Date.now(), who: 'agent', text: say, proof });
    save();
    const link = desk.link?.(call);
    if (link && link.url !== before) onLink?.(call, link);
    return say;
  }
  save();
  return 'Sorry, give me one moment, could you say that again?';
}

/** A customer photo: kept on this machine only, described by a vision model in a TEE, then handed to the business desk. */
export async function photo(callId: string, img: Buffer): Promise<string> {
  const call = db.calls.find((c) => c.id === callId);
  if (!call) throw new Error('no such call');
  if (!call.desk) enterDesk(call, 'business');
  if (call.desk !== 'business') return 'Photos are for building quotes. For a coin launch, just describe the logo you want.';
  mkdirSync('data/photos', { recursive: true });
  const file = `data/photos/${call.id}-${id()}.jpg`;
  writeFileSync(file, img);
  (call.photos ??= []).push(file);
  const { text, proof } = await describePhoto(img);
  call.turns.push({ at: Date.now(), who: 'tool', text: `photo → ${text}`, proof });
  log({ kind: 'photo', desk: 'business', callId: call.id, detail: text.slice(0, 200) });
  return reply(callId, `[Photo] ${text}`);
}

export function endCall(callId: string) {
  const call = db.calls.find((c) => c.id === callId);
  if (call && !call.endedAt) { call.endedAt = Date.now(); save(); }
  histories.delete(callId);
}

export { priceFor } from './desks/business.ts';
