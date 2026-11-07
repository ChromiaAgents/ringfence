// One engine, several desks. The runtime (history, tool loop, TEE-signed replies, output filter) is shared;
// each desk brings its own config file, prompt and tools, and its rules live in those tools' code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chat, type Msg } from './ai.ts';
import { sentenceSplitter } from './speech.ts';
import { describePhoto } from './image.ts';
import { db, save, id, log, type Call, type Desk, type Timing } from './store.ts';
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

// Qwen3: /no_think (plus enable_thinking:false in the request) skips the reasoning pass; any <think> left is stripped.
const sys = (d: Desk, call: Call) => `${DESKS[d].system(call)}\n/no_think`;

const histories = new Map<string, Msg[]>();

export function startCall(channel: Call['channel'], from?: string, desk?: Desk): { call: Call; greeting: string } {
  const call: Call = { id: id(), channel, desk, from, startedAt: Date.now(), turns: [] };
  db.calls.push(call);
  const greeting = desk ? DESKS[desk].greeting() : ROUTER_GREETING;
  call.turns.push({ at: Date.now(), who: 'agent', text: greeting });
  histories.set(call.id, desk ? [{ role: 'system', content: sys(desk, call) }, { role: 'assistant', content: greeting }] : []);
  save();
  return { call, greeting };
}

function enterDesk(call: Call, desk: Desk) {
  call.desk = desk;
  const h = histories.get(call.id)!;
  h.splice(0, h.length, { role: 'system', content: sys(desk, call) }, { role: 'assistant', content: ROUTER_GREETING });
  call.turns.push({ at: Date.now(), who: 'tool', text: `routed to the ${desk} desk` });
}

/** Live-call hooks: each sentence is handed over as soon as it is complete (and filtered), so speech starts early. */
export type ReplyOpts = {
  onSentence?: (s: string) => void;
  /** Called before a slow tool runs, so the channel can play a short filler. */
  onSlowTool?: (name: string) => void;
  signal?: AbortSignal;
  /** Filled in here (firstTokenMs, llmMs) and by the channel (sttMs, firstAudioMs, totalMs); stored on the agent turn. */
  timing?: Timing;
};
const SLOW_TOOLS = new Set(['make_logo']);

export async function reply(callId: string, text: string, o: ReplyOpts = {}): Promise<string> {
  const call = db.calls.find((c) => c.id === callId);
  const h = histories.get(callId);
  if (!call || !h) throw new Error('no such call');
  const timing = o.timing;
  const t0 = timing?.start ?? Date.now();
  call.turns.push({ at: Date.now(), who: 'caller', text });
  if (!call.desk) {
    const d = route(text);
    if (!d) {
      const ask = 'Sorry, is that a coin launch, or building work?';
      o.onSentence?.(ask);
      call.turns.push({ at: Date.now(), who: 'agent', text: ask, timing });
      save();
      return ask;
    }
    enterDesk(call, d);
  }
  const desk = DESKS[call.desk!];
  h[0] = { role: 'system', content: sys(call.desk!, call) }; // pick up config changes mid-call
  h.push({ role: 'user', content: text });
  const before = desk.link?.(call)?.url;
  const said: string[] = [];
  const split = sentenceSplitter(desk.filter, (hit, s) =>
    log({ kind: 'filtered', desk: desk.id, callId: call.id, detail: `reply said "${hit}" in "${s}"; replaced before it was spoken` }));
  const emit = (xs: string[]) => { for (const x of xs) { said.push(x); if (!o.signal?.aborted) o.onSentence?.(x); } };
  for (let step = 0; step < 6; step++) {
    const { msg, proof } = await chat(h, desk.tools, undefined, {
      signal: o.signal,
      onText: (d) => { if (timing && timing.firstTokenMs == null) timing.firstTokenMs = Date.now() - t0; emit(split.push(d)); },
    });
    emit(split.flush()); // a step ends at a tool call or the end of the reply
    h.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        if (SLOW_TOOLS.has(tc.function.name)) o.onSlowTool?.(tc.function.name);
        const out = await desk.run(call, tc.function.name, args).catch((e) => ({ ok: false, reason: String(e.message) }));
        call.turns.push({ at: Date.now(), who: 'tool', text: `${tc.function.name}(${JSON.stringify(args)}) → ${JSON.stringify(out)}`, proof });
        h.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      continue;
    }
    const say = said.join(' ');
    if (timing) timing.llmMs = Date.now() - t0;
    call.turns.push({ at: Date.now(), who: 'agent', text: say, proof, timing });
    save();
    const link = desk.link?.(call);
    if (link && link.url !== before) onLink?.(call, link);
    return say;
  }
  save();
  const sorry = 'Sorry, give me one moment, could you say that again?';
  o.onSentence?.(sorry);
  return sorry;
}

/** A customer photo: kept on this machine only, described by a vision model in a TEE, then handed to the business desk. */
export async function photo(callId: string, img: Buffer, o: ReplyOpts = {}): Promise<string> {
  const call = db.calls.find((c) => c.id === callId);
  if (!call) throw new Error('no such call');
  if (!call.desk) enterDesk(call, 'business');
  if (call.desk !== 'business') { const m = 'Photos are for building quotes. For a coin launch, just describe the logo you want.'; o.onSentence?.(m); return m; }
  mkdirSync('data/photos', { recursive: true });
  const file = `data/photos/${call.id}-${id()}.jpg`;
  writeFileSync(file, img);
  (call.photos ??= []).push(file);
  o.onSlowTool?.('photo');
  const { text, proof } = await describePhoto(img);
  call.turns.push({ at: Date.now(), who: 'tool', text: `photo → ${text}`, proof });
  log({ kind: 'photo', desk: 'business', callId: call.id, detail: text.slice(0, 200) });
  return reply(callId, `[Photo] ${text}`, o);
}

export function endCall(callId: string) {
  const call = db.calls.find((c) => c.id === callId);
  if (call && !call.endedAt) { call.endedAt = Date.now(); save(); }
  histories.delete(callId);
}

export { priceFor } from './desks/business.ts';
