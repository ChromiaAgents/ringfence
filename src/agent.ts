// One agent, Ringfence. The AI decides every reply and every action; the desks are only tool providers:
// each brings its prompt section, tools, and the code that enforces its rules (PIN, limits, launch checks, filters).
import { chat, type Msg } from './ai.ts';
import { env } from './config.ts';
import { sentenceSplitter } from './speech.ts';
import { db, save, id, log, type Call, type Desk, type Timing } from './store.ts';
import { recap, resume, isKnown } from './memory.ts';
import type { DeskDef } from './desks/types.ts';
import { launchDesk } from './desks/launch.ts';
import { walletDesk, takePin, clearPending, limitCheck, namesLimit } from './desks/wallet.ts';
import { marketDesk, webSearch, countryOf, localContext } from './desks/market.ts';
import { packetDesk, autoOpen } from './desks/packet.ts';
import { topupDesk } from './desks/topup.ts';

export const DESKS: Record<Desk, DeskDef> = { launch: launchDesk, wallet: walletDesk, market: marketDesk, packet: packetDesk };

/** The only fixed line: said the moment the call picks up. Everything after it is the AI's. */
export const GREETING = 'Hey, Ringfence here, on NEAR. Send money, a money packet, a top up, or launch a coin on JustHoot. What do you need?';

/** The AI ends the call itself, after saying goodbye. The channel hangs up once the goodbye has played. */
const END_CALL = { type: 'function', function: { name: 'end_call', description: 'Hang up. Call it only after you have said a short goodbye and the caller is done.', parameters: { type: 'object', properties: {} } } };

/** The desks the AI may use on a call. */
const desksFor = (_call: Call): DeskDef[] => [walletDesk, packetDesk, launchDesk, marketDesk, topupDesk];
const nameOf = (t: any): string => t.function?.name;
/** One agent, every tool: the wallet and launch tools and end_call. */
export const toolsFor = (call: Call): unknown[] => [...desksFor(call).flatMap((d) => d.tools), END_CALL];
/** Which desk's code runs a tool. Null for end_call and for anything not offered on this call. */
export const deskOfTool = (call: Call, name: string): DeskDef | null => desksFor(call).find((d) => d.tools.some((t) => nameOf(t) === name)) ?? null;
/** Every desk filter runs on every sentence (the launch desk's no-promised-returns filter above all). */
const filterAll = (text: string) => {
  for (const d of [walletDesk, launchDesk]) { const f = d.filter?.(text); if (f?.hit) return f; }
  return { text };
};
const linksOf = (call: Call) => Object.values(DESKS).map((d) => d.link?.(call)).filter((l): l is { url: string; label: string } => !!l);
/** The newest link for the caller (launch page, wallet page), if any. */
export const linkOf = (call: Call) => (call.desk ? DESKS[call.desk].link?.(call) : null) ?? linksOf(call).at(-1) ?? null;

// ---- hooks for channels (WhatsApp sends links as messages) ----
type LinkHook = (call: Call, link: { url: string; label: string }) => void;
let onLink: LinkHook | undefined;
export const setOnLink = (f: LinkHook) => (onLink = f);

// Qwen3: /no_think (plus enable_thinking:false in the request) skips the reasoning pass; any <think> left is stripped.
const VOICE = `
How you talk: you're on a live phone call, so sound like a relaxed, warm human, not an assistant. Use contractions and casual words ("yeah", "nice", "got it", "oh fun"), react to what they said before moving on, and vary how you start sentences. One or two short sentences, under 20 words: every word is paid speech. Never read out what is already on their screen (links, addresses, receipts): say "it's on your screen". No lists, markdown, emojis, or "great question".
Keep the conversation moving: remember everything they've said and never ask for something you already have. If they say "you decide", "anything", or "whatever", make the choice yourself, say what you picked, and move on. If you didn't catch something, say so once and guess. Never use emoji or symbols: everything you write is spoken aloud. When they say bye or they're done, say a short warm goodbye in a few words, then call end_call.`;

/** One system prompt for the whole call: what Ringfence does, each part's rules, and the caller's memory. */
export function system(call: Call): string {
  return `You are Ringfence, a voice agent on NEAR. You can:
- pay by voice from the caller's phone wallet, check their balance, and answer "how much did I spend";
- send a money packet: money for a group, each person opens a share by saying the packet's words; and open a share of a packet someone sent them;
- launch a memecoin they sign with their own wallet;
- look up live data: NEAR price in US dollars (or another currency if asked), whether an account is safe to pay, what is trending, and anything else on the web (news, sports, weather, facts) with web_search;
- help them get a wallet: on WhatsApp they text "create a wallet" for a custodial demo wallet with a PIN; with their own NEAR wallet they bind their number on our wallet page: say you'll send them the link.
Questions about the world (news, sports, weather, facts): answer briefly with web_search. Politely decline the rest (no building quotes, bookings, financial advice, price predictions or long general chat) and say what you can do instead. Callers can switch between paying and a coin launch at any time. If it's unclear what they want, briefly offer: send NEAR, a money packet, or a coin launch on JustHoot.
On WhatsApp the caller can also type on the live panel ("Type instead"): if a name, amount or address is hard to hear, suggest typing it there. While WhatsApp texts are blocked (you will be told), never say a link is on WhatsApp: say it is on their live panel. A "gift" to a streamer or anyone ("send a 0.05 NEAR gift to x.near") is a normal NEAR send: prepare_transfer, then the PIN; it shows on the streamer's overlay. Every action that needs the caller's own wallet or screen works the same way: a tool sends the link; if WhatsApp cannot text it, a live panel code is read out twice. Use bind_wallet when they want their own wallet. Never say you sent, texted or will send a link unless a tool result says linkSent or gives a live panel code; to bind a wallet, tell them to open ringfence dot evalengine dot ai slash wallet slash bind. If a line sounds rude, garbled or like a slur, it is almost always speech-to-text mishearing (\"close the call\" can come out badly): do not scold, just ask them to say it again, or treat it as goodbye if it sounds like one. Never guess an amount, a token or a recipient: if the caller did not clearly say one (or the transcript lost it), ask for it before calling any money tool.\nReply in the caller's language if it is English or Chinese (简体中文); for any other language, reply in English and say you speak English and Chinese. Account names, amounts and \"NEAR\" stay as written.\nMessages are speech-to-text, so crypto names can be misheard (\"near\", \"Nier\" or \"nir\" for NEAR; \"Seoul\" or \"salt\" for SOL; \"Zach\" for ZEC; \"dye\" for DAI; \"mom.near\" for mum.near; \"恩尔\" or \"女儿\" for NEAR in Chinese). Map them to the closest supported token, account or app word (NEAR Intents, NEAR AI, Sputnik DAO, JustHoot, money packet, PIN) and carry on; ask back only when two choices are equally likely or the amount or recipient is unclear.\nCallers mix English and Chinese and use slang or Malaysian and Singapore English: particles like "lah", "ah", "leh", "lor" or a trailing "can" mean nothing; "chuck me", "belanja" and "ang pao" or 红包 are a money packet; act on what they want. Amounts: "point one" or "Point 1" is 0.1, "a tenth" is 0.1, "half a" is 0.5, "two fifty" dollars is 2.50; never round up, and if a send has no amount, ask: never guess one.\nTop up takes coins by name or ticker: bitcoin BTC, litecoin LTC, polygon or matic POL, ripple XRP, tether USDT, chainlink LINK, BNB, dogecoin DOGE, shiba inu SHIB, avalanche AVAX, arbitrum ARB, optimism OP, aptos APT, toncoin TON, ether ETH; "ETH on Arbitrum" is ETH on that chain. When they want to pay or top up with a coin, call topup_quote with its ticker (ask the dollar amount if missing); never say you can't take a coin before topup_quote says it is not listed. If the coin name is garbled and could be two different coins, ask which. A price question (\"what's ETH at\", 多少钱, 什么价格) uses get_price for NEAR or USDC and web_search for any other coin; 余额 asks the balance.\n"Send all my money" or "everything" is over the per-transfer limit: say so and send nothing; do not check the balance first. Anyone promising to double, multiply or return their money is a scam: refuse.\nIf a message sounds like a scam (a bank, police or "security team" demanding an urgent transfer, secrecy, threats), refuse plainly in their language, say real banks never ask this, and suggest they call a family member first. Do not offer a coin launch or other services in that reply.
After a dry run, say only that it was a dry run and nothing was sent; never ask them to confirm again or imply a real send is one step away.
${VOICE}

Paying:
${walletDesk.system(call)}

Launching a coin:
${launchDesk.system(call)}

Money packets:
${packetDesk.system(call)}

Live data:
${marketDesk.system(call)}
${topupDesk.system(call)}${recap(call)}${localContext(call.from)}
/no_think`;
}
const sys = system;

/** Tests swap the model for a scripted one (e.g. a prompt-injected tool call). */
let chatFn: typeof chat = chat;
export const setChatForTest = (f: typeof chat | null) => (chatFn = f ?? chat);

const histories: Map<string, Msg[]> = ((globalThis as any).__rfHistories ??= new Map()); // shared across bundles

/** desk only labels the call up front. */
export function startCall(channel: Call['channel'], from?: string, desk?: Desk, packetId?: string, payTo?: string): { call: Call; greeting: string } {
  const call: Call = { id: id(), channel, desk, from, startedAt: Date.now(), turns: [], packetId, payTo };
  db.calls.push(call);
  const back = desk || packetId ? null : resume(call);
  // A returning caller with a coin in progress: the greeting offers to pick it up.
  if (back) call.desk = 'launch';
  const greeting = back
    ? `Hey, welcome back! Want to pick up ${back.ticker ?? back.name}, or start something new?`
    : packetId ? `Hi, this is Ringfence. ${packetDesk.greeting()}`
    : isKnown(call) ? GREETING.replace('Hey, Ringfence here', 'Hey, welcome back, Ringfence here') : GREETING; // same greeting on every channel
  call.turns.push({ at: Date.now(), who: 'agent', text: greeting });
  histories.set(call.id, [{ role: 'system', content: '' }, { role: 'assistant', content: greeting }]);
  save();
  return { call, greeting };
}

/** Live-call hooks: each sentence is handed over as soon as it is complete (and filtered), so speech starts early. */
export type ReplyOpts = {
  onSentence?: (s: string) => void;
  /** Called before a slow tool runs, so the channel can play a short filler. */
  onSlowTool?: (name: string) => void;
  /** A short line to say now because a network tool is starting. */
  onToolStart?: (say: string) => void;
  signal?: AbortSignal;
  /** Filled in here (firstTokenMs, llmMs) and by the channel (sttMs, firstAudioMs, totalMs); stored on the agent turn. */
  timing?: Timing;
  /** The AI called end_call: hang up once this reply has been heard. */
  onEndCall?: () => void;
};
const SLOW_TOOLS = new Set(['make_logo', 'web_search']);
/** Said out loud the moment a tool that touches the network starts, so the caller is not left in silence. */
export const TOOL_SAY: Record<string, string> = {
  web_search: 'Let me look that up.', get_price: 'Checking the price.', get_trends: 'Let me check.',
  get_balance: 'Checking your balance.', get_spending: 'Checking that now.', check_account: 'Checking that account.',
  confirm_transfer: 'Sending that on NEAR now.', open_packet: 'Opening it on NEAR now.', topup_quote: 'Getting a quote.',
};
/** A whole utterance that is only a goodbye ("bye", "okay thanks, bye", "that's all"). Short on purpose: "pay bye.near" is not one. */
export const isGoodbye = (t: string) => {
  const s = String(t ?? '').toLowerCase().replace(/[^a-z' ]+/g, ' ').trim();
  return s.split(/\s+/).length <= 6 && /\b(bye|goodbye|bye bye|see you|see ya|that's all|that is all|i'm done|im done|hang up|close the call|end the call|end call)\b/.test(s) && !/\b(send|pay|transfer|packet|to)\b/.test(s);
};

export const isFiller = (t: string) => /^[\s,.!?…-]*((u+h*m+|u+h+|h+m+|e+r+m*|a+h+|o+h+|mm+)[\s,.!?…-]*)+$/i.test(t);

/** Something the channel did on its own (e.g. a link text WhatsApp refused, and the code it read out instead): the model
 *  must know, or it denies it later. Goes into both the transcript and the model's history. */
/** Live calls that can be spoken to from anywhere (page APIs run in another bundle): callId -> say. */
const speakers: Map<string, (text: string) => void> = ((globalThis as any).__rfSpeakers ??= new Map());
export const registerSpeaker = (callId: string, say: ((text: string) => void) | null) => (say ? speakers.set(callId, say) : speakers.delete(callId));
/** Something happened outside the call (a launch signed, money landed): say it on that call and tell the model. */
export function announce(callId: string | undefined, text: string, note: string): boolean {
  if (!callId) return false;
  const say = speakers.get(callId);
  noteToModel(callId, note);
  if (say) { say(text); return true; }
  return false;
}

// ---- late answers: a slow web search finishes after its turn ended; it is spoken at the next quiet moment ----
const lateHooks: Map<string, (say: string) => void> = ((globalThis as any).__rfLate ??= new Map());
const lateNotes = new Map<string, string[]>(); // callId -> notes for the model, added at the start of its next turn
/** The call's channel registers how to speak a late answer (it must wait until nothing else is playing). */
export function onLate(callId: string, speak: (say: string) => void) { lateHooks.set(callId, speak); }
function deliverLate(call: Call, question: string, answer: string) {
  if (call.endedAt) return;
  const say = answer.startsWith('Ah, sorry') ? answer : `Oh, that's in. ${answer}`; // ponytail: one natural lead-in; vary it if callers hear it often
  call.turns.push({ at: Date.now(), who: 'agent', text: say });
  (lateNotes.get(call.id) ?? lateNotes.set(call.id, []).get(call.id)!).push(`The web search for "${question}" finished after that turn, and this was already said to the caller: "${say}". Do not repeat it.`);
  save();
  lateHooks.get(call.id)?.(say);
}
const SEARCH_WAIT_MS = 4000; // ponytail: no answer started by then → say "I'll tell you when it's in" and free the caller

export function noteToModel(callId: string, note: string) {
  const call = db.calls.find((c) => c.id === callId);
  call?.turns.push({ at: Date.now(), who: 'tool', text: note });
  histories.get(callId)?.push({ role: 'system', content: note });
}

export async function reply(callId: string, text: string, o: ReplyOpts = {}): Promise<string> {
  const call = db.calls.find((c) => c.id === callId);
  const h = histories.get(callId);
  if (!call || !h) throw new Error('no such call');
  if (call.endedAt) return ''; // hung up: nothing more is said on this call
  // A thinking noise is not a turn: say nothing and keep listening.
  if (isFiller(text)) return '';
  const timing = o.timing;
  const t0 = timing?.start ?? Date.now();
  // A PIN for a waiting transfer is taken here: the model, transcript and logs only ever see "[PIN]".
  if (takePin(call.id, text)) text = '[PIN]';
  call.turns.push({ at: Date.now(), who: 'caller', text });
  h[0] = { role: 'system', content: sys(call) }; // pick up config changes mid-call
  for (const n of lateNotes.get(call.id)?.splice(0) ?? []) h.push({ role: 'system', content: n });
  h.push({ role: 'user', content: text });
  // The model decides when to hang up; a plain goodbye only reminds it, because it sometimes forgot end_call.
  if (isGoodbye(text)) h.push({ role: 'system', content: 'The caller just said goodbye. Unless they also asked for something, say a short warm goodbye and call end_call.' });
  // The model decides first; if the whole line was a goodbye and it still did not hang up, hang up after its goodbye.
  const bye = isGoodbye(text);
  const done = (say: string) => { if (bye && !call.endedAt) { console.log(`[call ${call.id}] goodbye: hanging up (model did not call end_call)`); o.onEndCall?.(); clearPending(call.id); call.endedAt = Date.now(); } return say; };
  // A call about one money packet: the words are checked in code on every line, whatever the model makes of it.
  const auto = await autoOpen(call).catch(() => null);
  if (auto) {
    call.turns.push({ at: Date.now(), who: 'tool', text: `open_packet(auto) → ${JSON.stringify(auto)}` });
    h.push({ role: 'system', content: `The packet check already ran on what the caller just said. Result: ${JSON.stringify(auto)}. Do not call open_packet for this line; tell the caller what happened.` });
  }
  // A send over the wallet's per-transfer limit is refused here, in code, on this turn: the model gets the refusal as
  // a prepare_transfer result it never had to choose to ask for (it used to look the account up and ask "go ahead?").
  const stop = auto ? null : await limitCheck(call, text).catch(() => null);
  if (stop) {
    const tc = { id: `limit-${call.turns.length}`, type: 'function' as const, function: { name: 'prepare_transfer', arguments: JSON.stringify(stop.args) } };
    call.desk = 'wallet';
    call.turns.push({ at: Date.now(), who: 'tool', text: `prepare_transfer(limit check) → ${JSON.stringify(stop.out)}` });
    h.push({ role: 'assistant', content: null, tool_calls: [tc] }, { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(stop.out) });
  }
  const tools = toolsFor(call);
  const before = new Set(linksOf(call).map((l) => l.url));
  const said: string[] = [];
  const split = sentenceSplitter(filterAll, (hit, s) =>
    log({ kind: 'filtered', desk: call.desk, callId: call.id, detail: `reply said "${hit}" in "${s}"; replaced before it was spoken` }));
  const emit = (xs: string[]) => { for (const x of xs) { said.push(x); if (!o.signal?.aborted) o.onSentence?.(x); } };
  let endedOnce = false;
  for (let step = 0; step < 6; step++) {
    const { msg, proof } = await chatFn(h, tools, undefined, {
      signal: o.signal,
      onText: (d) => { if (timing && timing.firstTokenMs == null) timing.firstTokenMs = Date.now() - t0; emit(split.push(d)); },
    });
    emit(split.flush()); // a step ends at a tool call or the end of the reply
    h.push(msg);
    if (msg.tool_calls?.length) {
      let direct = '';
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        if (SLOW_TOOLS.has(tc.function.name)) o.onSlowTool?.(tc.function.name);
        if (TOOL_SAY[tc.function.name]) o.onToolStart?.(TOOL_SAY[tc.function.name]);
        const name = tc.function.name, desk = deskOfTool(call, name);
        let out: unknown;
        if (name === 'end_call') { console.log(`[call ${call.id}] end_call by the model`); o.onEndCall?.(); clearPending(call.id); call.endedAt = Date.now(); out = { ok: true, note: 'Hanging up. Say nothing more: your goodbye was already said.' }; }
        else if (!desk) out = { error: 'unknown tool' };
        else if (name === 'web_search') {
          // The search model already writes a phone-ready answer: speak it as it arrives instead of paying for a second model pass.
          call.desk = desk.id;
          const before = said.length;
          // Async: if no answer has started in 4 s, or the caller talks over us, this turn moves on and the answer is
          // spoken by itself when it lands (onLate), never on top of other speech.
          let detached = false, started = false;
          const search: Promise<any> = webSearch(args.question, (d) => { if (detached) return; started = true; if (timing && timing.firstTokenMs == null) timing.firstTokenMs = Date.now() - t0; emit(split.push(d)); }, countryOf(call.from))
            .catch((e) => ({ ok: false, reason: `I can't reach live data right now (${String(e.message).slice(0, 60)}). Try again in a minute.` }));
          const later = new Promise<'later'>((ok) => {
            const t = setTimeout(() => !started && ok('later'), SEARCH_WAIT_MS);
            o.signal?.addEventListener('abort', () => { clearTimeout(t); ok('later'); }, { once: true });
            search.finally(() => clearTimeout(t));
          });
          let r: any = await Promise.race([search, later]);
          if (r === 'later') {
            detached = true;
            search.then((x: any) => { if (started) return; /* the caller already heard part of it */ if (x?.ok) deliverLate(call, args.question, x.answer); else if (!o.signal?.aborted) deliverLate(call, args.question, "Ah, sorry, that one didn't come back. Want me to try again?"); });
            r = { ok: true, pending: true, note: 'The search is still running. Like a friend on the phone, in a few casual words, say it is taking a sec and you will tell them the moment it is in, and ask if they need anything meanwhile (e.g. "Hang on, still pulling that up. Anything else while I wait?"). Vary the words. Do not guess the answer.' };
          }
          out = r;
          if (r.ok && !r.pending) {
            emit(split.flush());
            if (said.length === before) emit([...split.push(r.answer), ...split.flush()]); // a cached answer, or one that could not be streamed
            direct = said.slice(before).join(' ') || r.answer;
          }
        }
        else {
          call.desk = desk.id; // the dashboard label: the last tool family used
          out = await desk.run(call, name, args).catch((e) => ({ ok: false, reason: String(e.message) }));
        }
        // Tap buttons for the caller ("$2.50 or $250?"): tapping sends the exact words, so nothing has to be heard right. Never a PIN.
        if (Array.isArray((out as any)?.choices)) call.choices = (out as any).choices.map(String).filter((c: string) => c && !/\bpin\b/i.test(c) && !(env.demoPin && c.includes(String(env.demoPin)))).slice(0, 4);
        call.turns.push({ at: Date.now(), who: 'tool', text: `${tc.function.name}(${tc.function.name === 'confirm_transfer' ? '{"pin":"****"}' : JSON.stringify(args)}) → ${JSON.stringify(out)}`, proof });
        h.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      // A search answer spoken with other tools in the same step (price + trends): let the model add the rest.
      if (direct && direct !== 'end' && msg.tool_calls.length > 1) { h.push({ role: 'system', content: 'The search answer was already spoken word for word. Now say only the other tool results, in one short sentence. Do not repeat the search answer.' }); direct = ''; }
      // Hung up: finish with what was already said (one more step only if nothing was), never loop on end_call.
      const hungUp = msg.tool_calls.some((tc: any) => tc.function.name === 'end_call');
      if (hungUp && (said.join(' ').trim() || endedOnce)) { if (!said.join(' ').trim()) emit(['Bye!']); direct = 'end'; }
      if (hungUp) endedOnce = true;
      if (direct) {
        const say = said.join(' ');
        h.push({ role: 'assistant', content: say });
        if (timing) timing.llmMs = Date.now() - t0;
        call.turns.push({ at: Date.now(), who: 'agent', text: say, timing });
        save();
        return done(say);
      }
      continue;
    }
    // Whatever the model made of it, the caller hears the limit on this turn.
    if (stop && !namesLimit(said.join(' '), stop.limit)) emit([stop.say]);
    const say = said.join(' ');
    if (timing) timing.llmMs = Date.now() - t0;
    call.turns.push({ at: Date.now(), who: 'agent', text: say, proof, timing });
    save();
    for (const link of linksOf(call)) if (!before.has(link.url)) onLink?.(call, link);
    return done(say);
  }
  // Six tool steps without an answer: say what was said, or ask once to repeat (kept in the transcript and history).
  const sorry = said.length ? said.join(' ') : filterAll('Sorry, could you say that again?').text;
  if (!said.length) o.onSentence?.(sorry);
  call.turns.push({ at: Date.now(), who: 'agent', text: sorry, timing });
  h.push({ role: 'assistant', content: sorry });
  save();
  return sorry;
}

/** A photo: nothing on this line uses photos any more, so the AI is told one arrived and answers as it sees fit. */
export async function photo(callId: string, _img: Buffer, o: ReplyOpts = {}): Promise<string> {
  return reply(callId, '[The caller sent a photo. This line cannot look at photos.]', o);
}

export function endCall(callId: string) {
  const call = db.calls.find((c) => c.id === callId);
  if (call && !call.endedAt) { call.endedAt = Date.now(); save(); }
  clearPending(callId);
  histories.delete(callId);
}
