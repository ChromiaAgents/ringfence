// WhatsApp: callers ring (or text, or send a photo to) one number and talk to the one Ringfence agent.
// Calls are WebRTC (ICE + DTLS-SRTP, Opus) signalled through Graph API webhooks.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RTCPeerConnection, RtpHeader, RtpPacket, useOPUS, MediaStreamTrack } from 'werift';
import OpusScript from 'opusscript';
import { env } from './config.ts';
import { isFiller, startCall, reply, endCall, setOnLink, photo, noteToModel, registerSpeaker } from './agent.ts';
import { transcribe } from './ai.ts';
import { wav, warmUp } from './tts.ts';
import { voiceLine } from './turn.ts';
import { onboard, bindingOf, NO_WALLET, devServer, ftBalance } from './wallet.ts';
import { rpc } from './near.ts';
import { onButton, setApprovalSender, onCallNews } from './desks/wallet.ts';
import { setNotifier } from './notify.ts';
import { db, type Call } from './store.ts';
import { startLive, endLive, liveLink } from './live.ts';

const GRAPH = 'https://graph.facebook.com/v23.0';

async function graph(path: string, body: unknown) {
  const r = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.waToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`graph ${path} ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

export const sendText = (to: string, text: string) =>
  graph(`${env.waPhoneId}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: true } });

// Links (launch page, wallet page) go out as a WhatsApp message to whoever is on the line, on any channel that knows their number.
export function deliverLink(call: Call, link: { url: string; label: string }) {
  if (!call.from || !env.waToken) return;
  // Meta refused texts already (test line, verification pending): skip the text, straight to the live panel.
  if ((globalThis as any).__rfWaTextBlocked) { sendViaPanel(call, link); return; }
  const text = call.desk === 'launch'
    ? `Your launch is ready to check and sign with your own NEAR wallet: ${link.url}\nNothing is launched until you sign. Memecoins are risky; most lose value.`
    : `${link.label}: ${link.url}`;
  sendText(call.from, text).catch((e) => {
    console.error('link message', String(e.message).slice(0, 160));
    if (/13103[02]|131000|141010/.test(String(e.message))) (globalThis as any).__rfWaTextBlocked = true;
    sendViaPanel(call, link);
  });
}

function sendViaPanel(call: Call, link: { url: string; label: string }) {
  {
    // Meta refuses messages until business verification passes (131030, 131032): on a call the link goes to its
    // live panel (/live) and the code is said once; with no panel, say where to go instead.
    const panel = liveLink(call.id, link);
    const say = panel ?? "I can't text you on this line, so open ringfence dot evalengine dot ai to finish.";
    if (!say) { // the panel code was already given on this call: the new link is on the same panel
      noteToModel(call.id, `"${link.label}" is on the caller's live panel (/live, same code as before). Say that; never say it reached WhatsApp.`);
      return;
    }
    // Into the transcript too, so the model knows the text failed and what it told the caller (it denied it before).
    noteToModel(call.id, `The link text did NOT reach the caller: WhatsApp refused it. You already said to them: "${say}". If they ask for the code, the "quote" (speech-to-text often hears "code" as "quote") or the link, repeat exactly that (digits one by one, slowly). Never say the link is on their WhatsApp.`);
    for (const l of live.values()) if (l.callId === call.id) l.say?.(say);
  }
}
setOnLink(deliverLink);

/** Approve / Reject for larger sends: a Graph API interactive "button" message to the wallet's bound phone. */
export const sendButtons = (to: string, body: string, token: string) =>
  graph(`${env.waPhoneId}/messages`, { messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'button', body: { text: body },
    action: { buttons: [{ type: 'reply', reply: { id: `approve:${token}`, title: 'Approve' } }, { type: 'reply', reply: { id: `cancel:${token}`, title: 'Cancel' } }, { type: 'reply', reply: { id: `reject:${token}`, title: 'Not me' } }] } } });
if (env.waToken) setApprovalSender(sendButtons);
if (env.waToken) setNotifier((phone, text) => { sendText(phone, text).catch((e) => console.error('notify', e.message.slice(0, 120))); });


function validSignature(req: IncomingMessage, body: Buffer) {
  // Unsigned webhooks only on a dry-run server: anywhere real, a missing secret would let anyone post as any number.
  if (!env.waAppSecret) return devServer();
  const got = String(req.headers['x-hub-signature-256'] ?? '');
  const want = 'sha256=' + createHmac('sha256', env.waAppSecret).update(body).digest('hex');
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// One text conversation per WhatsApp user, reusing the call agent.
const chats = new Map<string, string>(); // wa_id -> callId

export async function whatsappWebhook(req: IncomingMessage, res: ServerResponse, body: Buffer, url: URL) {
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.waVerify;
    return res.writeHead(ok ? 200 : 403).end(ok ? url.searchParams.get('hub.challenge') : '');
  }
  if (!validSignature(req, body)) return res.writeHead(401).end();
  res.writeHead(200).end(); // ack fast, work after
  const payload = JSON.parse(body.toString() || '{}');
  for (const entry of payload.entry ?? [])
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const c of v.calls ?? []) onCallEvent(c).catch((e) => console.error('call', e));
      for (const m of v.messages ?? []) onMessage(m).catch((e) => console.error('msg', e));
    }
}

async function onMessage(m: any) {
  // A tap on [Approve] / [Reject]: handled here, never by the model.
  if (m.type === 'interactive' && m.interactive?.type === 'button_reply') return sendText(m.from, await onButton(m.from, m.interactive.button_reply.id));
  // A voice note is heard like a call turn: it can say the words of a money packet, or ask for a send.
  if (m.type === 'audio') {
    const heard = await transcribe(new Uint8Array(await media(m.audio.id)), String(m.audio.mime_type ?? 'audio/ogg').split(';')[0]).catch(() => '');
    if (!heard) return sendText(m.from, "I couldn't hear that voice note. Try again, or type it.");
    m = { ...m, type: 'text', text: { body: heard } };
  }
  if (m.type !== 'text' && m.type !== 'image') return;
  // No wallet yet: "create a wallet" starts the custodial onboarding; the PIN reply is handled here and never logged.
  if (m.type === 'text') { const r = await onboard(m.from, m.text.body); if (r) return sendText(m.from, r); }
  let callId = chats.get(m.from);
  if (!callId) {
    // Everyone gets the same agent; on the owner's number it also has the settings tools.
    const { call, greeting } = startCall('whatsapp', m.from);
    callId = call.id;
    chats.set(m.from, callId);
    if (m.type === 'text' && /^(hi|hello|hey)\b/i.test(m.text.body.trim())) return sendText(m.from, bindingOf(m.from) ? greeting : `${greeting}\n\n${NO_WALLET()}`);
  }
  if (m.type === 'text' && /^(reset|new|restart)$/i.test(m.text.body.trim())) {
    chats.delete(m.from);
    return sendText(m.from, 'Fresh start. Say hi, or tell me what you need.');
  }
  if (m.type === 'image') return sendText(m.from, await photo(callId, await media(m.image.id)));
  let ended = false;
  const say = await reply(callId, m.text.body, { onEndCall: () => (ended = true) });
  if (ended) { chats.delete(m.from); endCall(callId); } // the AI closed the conversation: the next text starts fresh
  if (say.trim()) sendText(m.from, say); // a filler word gets no reply; WhatsApp rejects an empty body
}

// Graph API media: look up the short-lived URL, then download with the same token. Kept on this machine only.
async function media(mediaId: string): Promise<Buffer> {
  const auth = { authorization: `Bearer ${env.waToken}` };
  const meta: any = await (await fetch(`${GRAPH}/${mediaId}`, { headers: auth })).json();
  if (!meta.url) throw new Error('media: no url');
  const r = await fetch(meta.url, { headers: auth });
  if (!r.ok) throw new Error(`media ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------------- calls ----------------

type Live = { pc: RTCPeerConnection; callId: string; stop: () => void; say?: (s: string) => void; typed?: (text: string) => Promise<void> };
const live: Map<string, Live> = ((globalThis as any).__rfWaLive ??= new Map()); // shared across bundles

/** Say something on the WhatsApp call this number is on now (the page APIs run in another bundle), and tell the model. */
export function sayOnCall(phone: string, text: string, note?: string): boolean {
  for (const l of live.values()) {
    const call = db.calls.find((c) => c.id === l.callId);
    if (call && !call.endedAt && call.from === phone) { l.say?.(text); noteToModel(call.id, note ?? `You just told the caller: "${text}"`); return true; }
  }
  return false;
}

async function onCallEvent(c: any) {
  // Meta may omit `from` for some callers; fall back to other id fields and log which keys arrived.
  c.from ??= c.from_user_id ?? c.wa_id ?? c.caller?.wa_id;
  if (c.event === 'connect') console.log('wa call event keys', Object.keys(c).join(','), c.from ? 'from present' : 'no from');
  if (c.event === 'terminate') {
    live.get(c.id)?.stop();
    return;
  }
  if (c.event !== 'connect' || c.session?.sdp_type !== 'offer') return;

  const pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()] }, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], ...(env.rtcPorts ? { icePortRange: env.rtcPorts } : {}) });
  const out = new MediaStreamTrack({ kind: 'audio' });
  const tr = pc.addTransceiver(out, { direction: 'sendrecv' });
  await pc.setRemoteDescription({ type: 'offer', sdp: c.session.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  pc.iceConnectionStateChange.subscribe((s) => console.log('wa ice', s));
  await waitIce(pc);
  console.log('wa candidates', (pc.localDescription?.sdp.match(/a=candidate:[^\r\n]*/g) ?? []).map((x) => x.split(' ').slice(4, 8).join(' ')).join(' | '));
  const sdp = pc.localDescription!.sdp;
  await graph(`${env.waPhoneId}/calls`, { messaging_product: 'whatsapp', call_id: c.id, action: 'pre_accept', session: { sdp_type: 'answer', sdp } });

  const { call, greeting } = startCall('whatsapp', c.from);
  if (c.from) startLive(call.id, String(c.from)); // the fallback screen when WhatsApp messages can't reach them
  const audio = callAudio(out, payloadType(c.session.sdp));
  const line = voiceLine((pcm) => audio.play(pcm));
  audio.onBarge = () => line.cancel();
  warmUp().catch(console.error); // usually already warm from boot
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    audio.close();
    pc.close();
    endCall(call.id);
    endLive(call.id);
    onCallNews(call.id, null);
    live.delete(c.id);
  };
  live.set(c.id, { pc, callId: call.id, stop, say: (s: string) => line.say(s) });
  registerSpeaker(call.id, (s) => line.say(s));
  onCallNews(call.id, (s) => line.say(s)); // "Approved and sent" after a WhatsApp tap

  pc.connectionStateChange.subscribe(async (s) => {
    if (s === 'connected') {
      await graph(`${env.waPhoneId}/calls`, { messaging_product: 'whatsapp', call_id: c.id, action: 'accept', session: { sdp_type: 'answer', sdp } });
      await warmUp().catch(() => {});
      line.say(greeting);
    }
    if (s === 'failed' || s === 'closed') stop();
  });

  // ponytail: debug counters for the inbound leg; remove once calls are stable
  let rtpN = 0, maxRms = 0;
  const dbg = setInterval(() => { if (!rtpN) console.log(`wa rx ${c.id.slice(-6)}: no audio from caller`); rtpN = 0; maxRms = 0; }, 4000);
  const onTrack = (track: any) => {
    console.log('wa track', track.kind);
    track.onReceiveRtp.subscribe((rtp: any) => {
      rtpN++;
      try { audio.hear(rtp.payload); maxRms = Math.max(maxRms, audio.lastRms); } catch (e) { console.error('wa hear', e); }
    });
  };
  // The remote track is created during setRemoteDescription, before this point, so onTrack alone misses it.
  let hooked = false;
  const hook = (t: any) => { if (!t || hooked) return; hooked = true; onTrack(t); };
  tr.onTrack.subscribe(hook);
  pc.onTrack.subscribe(hook);
  hook(tr.receiver.track);
  pc.connectionStateChange.subscribe((s) => { console.log('wa pc', s); if (s === 'closed' || s === 'failed') clearInterval(dbg); });

  audio.onUtterance = async (pcm16k) => {
    const { signal, timing } = line.begin();
    let text = '';
    try { text = await transcribe(wav(pcm16k, 16000)); } catch (e: any) {
      console.error('wa stt failed', e?.message ?? e);
      line.say("Sorry, I didn't catch that. Say it again?");
      await line.end(`wa ${call.id}`);
      return;
    }
    timing.sttMs = Date.now() - timing.start!;
    console.log(`wa heard (${timing.sttMs} ms): ${text.length} chars`); // never the words: they may be a PIN
    if (!text || text.length < 2 || isFiller(text)) { await line.end(`wa ${call.id}`); return; }
    await answer(text, signal, timing);
  };
  // Typed on the live panel ("Type instead"): handled exactly like speech, minus the speech-to-text.
  live.get(c.id)!.typed = async (text: string) => { const { signal, timing } = line.begin(); await answer(text, signal, timing); };

  async function answer(text: string, signal: AbortSignal, timing: any) {
    line.ackSoon();
    try {
      let hangUp = false;
      await reply(call.id, text, { signal, timing, onSentence: (s) => line.say(s), onSlowTool: () => line.filler('draw'), onToolStart: (say) => line.toolStart(say), onEndCall: () => (hangUp = true) });
      await line.end(`wa ${call.id}`);
      if (hangUp) { // the AI called end_call: let the goodbye finish playing, then hang up
        while (audio.busy()) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 400));
        console.log('wa hang-up: terminating');
        await graph(`${env.waPhoneId}/calls`, { messaging_product: 'whatsapp', call_id: c.id, action: 'terminate' }).catch((e) => console.error('wa terminate failed', e?.message ?? e));
        stop();
      }
    } catch (e: any) { if (!/abort/i.test(e?.message ?? '')) throw e; }
  }
}

/** The live panel's "Type instead" box: text into this WhatsApp call as if spoken. */
(globalThis as any).__rfTyped = (callId: string, text: string) => {
  for (const l of live.values()) if (l.callId === callId && l.typed) { l.typed(text).catch((e) => console.error('typed', e?.message)); return true; }
  return false;
};

function waitIce(pc: RTCPeerConnection) {
  return new Promise<void>((ok) => {
    if (pc.iceGatheringState === 'complete') return ok();
    pc.iceGatheringStateChange.subscribe((s) => s === 'complete' && ok());
    setTimeout(ok, 3000);
  });
}

const payloadType = (sdp: string) => Number(sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1] ?? 111);

// Opus in -> 16 kHz utterances; text -> Opus out, paced at 20 ms.
function callAudio(out: MediaStreamTrack, pt: number) {
  const dec = new OpusScript(48000, 1, OpusScript.Application.VOIP);
  const enc = new OpusScript(48000, 1, OpusScript.Application.VOIP);
  // thinking: an utterance is being answered and nothing is playing yet; input is held so it can't start a second turn.
  // While audio plays, input still runs through a stricter detector: ~240 ms of clearly loud speech is a barge-in.
  let thinking = false;
  let buf: Float32Array[] = [];
  let voiced = 0, silent = 0, floor = 0.01, loudRun = 0;
  let seq = Math.floor(Math.random() * 65535), ts = Math.floor(Math.random() * 2 ** 31);
  let queue: Buffer[] = [];
  let closed = false; // after hang-up the encoder is freed: a late reply must not touch it (it crashed opus)
  const self = {
    onUtterance: undefined as undefined | ((pcm16k: Float32Array) => Promise<void>),
    onBarge: undefined as undefined | (() => void),
    lastRms: 0,
    hear(payload: Buffer) {
      if (closed) return;
      const pcm = new Int16Array(new Uint8Array(dec.decode(payload)).buffer);
      const f = Float32Array.from(pcm, (x) => x / 32768);
      const rms = Math.sqrt(f.reduce((a, x) => a + x * x, 0) / f.length);
      self.lastRms = rms;
      if (queue.length) { // agent is talking
        loudRun = rms > Math.max(0.05, floor * 6) ? loudRun + 1 : 0;
        if (loudRun < 12) return;
        queue = []; loudRun = 0; thinking = false; // stop talking, start listening
        self.onBarge?.();
      } else if (thinking) return;
      const loud = rms > Math.max(0.02, floor * 3);
      if (!loud) floor = floor * 0.98 + rms * 0.02;
      if (loud) { voiced++; silent = 0; buf.push(f); }
      else if (voiced) { silent++; buf.push(f); }
      if (voiced && silent > Number(process.env.WA_END_SILENCE_FRAMES ?? 30)) { // 30 x 20 ms = ~600 ms of silence ends the utterance
        console.log(`wa utterance: ${voiced} voiced frames, floor ${floor.toFixed(3)}`);
        const frames = buf; const enough = voiced > 15;
        buf = []; voiced = 0; silent = 0;
        if (enough && self.onUtterance) {
          thinking = true;
          self.onUtterance(down3(concat(frames))).catch(console.error).finally(() => { thinking = false; });
        }
      }
    },
    /** 24 kHz mono PCM -> 20 ms Opus frames on the send queue. */
    play(pcm: Float32Array) {
      if (closed) return;
      const up = up2(pcm); // 48 kHz
      for (let i = 0; i + 960 <= up.length; i += 960) {
        const s16 = Int16Array.from(up.subarray(i, i + 960), (x) => Math.max(-32768, Math.min(32767, x * 32767)));
        queue.push(enc.encode(Buffer.from(s16.buffer), 960));
      }
    },
    busy: () => queue.length > 0,
    close() { if (closed) return; closed = true; queue = []; clearInterval(timer); dec.delete(); enc.delete(); },
  };
  // Keep the media flowing while the agent is quiet: with no packets at all, WhatsApp drops the call after about
  // ten seconds (seen when a caller left to sign in their wallet). One encoded frame of silence, reused.
  const silence = enc.encode(Buffer.alloc(960 * 2), 960);
  const timer = setInterval(() => {
    if (closed) return;
    const p = queue.shift() ?? silence;
    seq = (seq + 1) & 0xffff; ts = (ts + 960) >>> 0;
    out.writeRtp(new RtpPacket(new RtpHeader({ payloadType: pt, sequenceNumber: seq, timestamp: ts, marker: false }), p));
  }, 20);
  return self;
}

const concat = (a: Float32Array[]) => { const o = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const down3 = (x: Float32Array) => { const o = new Float32Array(Math.floor(x.length / 3)); for (let i = 0; i < o.length; i++) o[i] = (x[3 * i] + x[3 * i + 1] + x[3 * i + 2]) / 3; return o; };
const up2 = (x: Float32Array) => { const o = new Float32Array(x.length * 2); for (let i = 0; i < x.length; i++) { const n = x[i + 1] ?? x[i]; o[2 * i] = x[i]; o[2 * i + 1] = (x[i] + n) / 2; } return o; };

// On-chain events during a call: every 10 s, the caller's own phone wallet is read (NEAR and USDC). Money arriving or
// leaving is said on the call and told to the model, so nothing that happens on chain goes unnoticed.
const seen = new Map<string, { near: bigint; usdc: bigint }>();
const fmtNear = (y: bigint) => (Number(y) / 1e24).toFixed(3).replace(/\.?0+$/, '');
const fmtUsdc = (u: bigint) => (Number(u) / 1e6).toFixed(2);
// Once per process: this module is also loaded by the page-API bundle.
if (!(globalThis as any).__rfChainWatch) (globalThis as any).__rfChainWatch = setInterval(async () => {
  for (const l of live.values()) {
    const call = db.calls.find((c) => c.id === l.callId);
    const b = call?.from ? bindingOf(call.from) : undefined;
    if (!call || call.endedAt || !b || b.dryRun || (env.demoPhone && b.phone === env.demoPhone)) continue;
    const acct = await rpcView(b.contract).catch(() => null);
    const usdc = await ftBalance(env.usdcToken, b.contract).then(BigInt).catch(() => null);
    if (acct == null || usdc == null) continue;
    const now = { near: acct, usdc }, was = seen.get(call.id);
    seen.set(call.id, now);
    if (!was) continue;
    const parts: string[] = [];
    const dn = now.near - was.near, du = now.usdc - was.usdc;
    if (dn >= 10n ** 21n) parts.push(`${fmtNear(dn)} NEAR came in`);
    else if (dn <= -(10n ** 22n)) parts.push(`${fmtNear(-dn)} NEAR went out`);
    if (du > 0n) parts.push(`${fmtUsdc(du)} USDC came in`);
    else if (du < 0n) parts.push(`${fmtUsdc(-du)} USDC went out`);
    if (!parts.length) continue;
    const text = `Heads up: ${parts.join(' and ')}. Your wallet now has ${fmtNear(now.near)} NEAR and ${fmtUsdc(now.usdc)} USDC.`;
    l.say?.(text);
    noteToModel(call.id, `On chain just now: ${parts.join(', ')} on the caller's wallet ${b.contract}. Balance now ${fmtNear(now.near)} NEAR, ${fmtUsdc(now.usdc)} USDC. You already told them.`);
  }
  for (const id of seen.keys()) if (![...live.values()].some((l) => l.callId === id)) seen.delete(id);
}, 10_000).unref?.();

async function rpcView(account: string): Promise<bigint> {
  const r: any = await rpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: account });
  return BigInt(r.amount);
}
