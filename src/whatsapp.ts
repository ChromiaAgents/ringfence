// WhatsApp: callers ring (or text, or send a photo to) one number; the router hands them to a desk.
// Calls are WebRTC (ICE + DTLS-SRTP, Opus) signalled through Graph API webhooks.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RTCPeerConnection, RtpHeader, RtpPacket, useOPUS, MediaStreamTrack } from 'werift';
import OpusScript from 'opusscript';
import { env } from './config.ts';
import { isFiller, startCall, reply, endCall, setOnLink, photo } from './agent.ts';
import { transcribe } from './ai.ts';
import { wav, warmUp } from './tts.ts';
import { voiceLine } from './turn.ts';

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

// Links (launch page, deposit page) go out as a WhatsApp message to whoever is on the line, on any channel that knows their number.
setOnLink((call, link) => {
  if (!call.from || !env.waToken || call.channel === 'dashboard') return;
  const text = call.desk === 'launch'
    ? `Your launch is ready to check and sign with your own NEAR wallet: ${link.url}\nNothing is launched until you sign. Memecoins are risky; most lose value.`
    : `${link.label}: ${link.url}`;
  sendText(call.from, text).catch(console.error);
});

const isOwner = (from: string) => !!env.ownerWhatsapp && from.replace(/\D/g, '') === env.ownerWhatsapp;

function validSignature(req: IncomingMessage, body: Buffer) {
  if (!env.waAppSecret) return true; // ponytail: local testing only; set WHATSAPP_APP_SECRET in any real deploy
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
  if (m.type !== 'text' && m.type !== 'image') return;
  let callId = chats.get(m.from);
  if (!callId) {
    // Everyone gets the router; the owner's number can also say "owner ..." to reach the settings desk.
    const { call, greeting } = startCall('whatsapp', m.from);
    call.isOwner = isOwner(m.from);
    callId = call.id;
    chats.set(m.from, callId);
    if (m.type === 'text' && /^(hi|hello|hey)\b/i.test(m.text.body.trim())) return sendText(m.from, greeting);
  }
  if (m.type === 'text' && /^(reset|new|restart)$/i.test(m.text.body.trim())) {
    chats.delete(m.from);
    return sendText(m.from, 'Fresh start. Say hi, or tell me what you need.');
  }
  if (m.type === 'image') return sendText(m.from, await photo(callId, await media(m.image.id)));
  sendText(m.from, await reply(callId, m.text.body));
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

type Live = { pc: RTCPeerConnection; callId: string; stop: () => void };
const live = new Map<string, Live>();

const BYE = /\b(bye|goodbye|see you|that's all|that is all|hang up|gotta go|talk later|cheers mate)\b/i;

async function onCallEvent(c: any) {
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
  call.isOwner = isOwner(c.from);
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
    live.delete(c.id);
  };
  live.set(c.id, { pc, callId: call.id, stop });

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
    const text = await transcribe(wav(pcm16k, 16000));
    timing.sttMs = Date.now() - timing.start!;
    console.log(`wa heard (${timing.sttMs} ms): "${text}"`);
    if (!text || text.length < 2 || isFiller(text)) return;
    line.ackSoon();
    try {
      await reply(call.id, text, { signal, timing, onSentence: (s) => line.say(s), onSlowTool: () => line.filler('draw') });
      await line.end(`wa ${call.id}`);
      const last = call.turns.filter((t) => t.who === 'agent').at(-1)?.text ?? '';
      if (BYE.test(text) || /\b(bye|goodbye|take care)\b/i.test(last)) { // let the goodbye finish playing, then hang up
        while (audio.busy()) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 400));
        await graph(`${env.waPhoneId}/calls`, { messaging_product: 'whatsapp', call_id: c.id, action: 'terminate' }).catch(console.error);
        stop();
      }
    } catch (e: any) { if (!/abort/i.test(e?.message ?? '')) throw e; }
  };
}

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
  const self = {
    onUtterance: undefined as undefined | ((pcm16k: Float32Array) => Promise<void>),
    onBarge: undefined as undefined | (() => void),
    lastRms: 0,
    hear(payload: Buffer) {
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
      if (voiced && silent > 45) { // ~900 ms of silence ends the utterance
        console.log(`wa utterance: ${voiced} voiced frames, floor ${floor.toFixed(3)}`); // ~700 ms of silence ends the utterance
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
      const up = up2(pcm); // 48 kHz
      for (let i = 0; i + 960 <= up.length; i += 960) {
        const s16 = Int16Array.from(up.subarray(i, i + 960), (x) => Math.max(-32768, Math.min(32767, x * 32767)));
        queue.push(enc.encode(Buffer.from(s16.buffer), 960));
      }
    },
    busy: () => queue.length > 0,
    close() { clearInterval(timer); dec.delete(); enc.delete(); },
  };
  const timer = setInterval(() => {
    const p = queue.shift();
    if (!p) return;
    seq = (seq + 1) & 0xffff; ts = (ts + 960) >>> 0;
    out.writeRtp(new RtpPacket(new RtpHeader({ payloadType: pt, sequenceNumber: seq, timestamp: ts, marker: false }), p));
  }, 20);
  return self;
}

const concat = (a: Float32Array[]) => { const o = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const down3 = (x: Float32Array) => { const o = new Float32Array(Math.floor(x.length / 3)); for (let i = 0; i < o.length; i++) o[i] = (x[3 * i] + x[3 * i + 1] + x[3 * i + 2]) / 3; return o; };
const up2 = (x: Float32Array) => { const o = new Float32Array(x.length * 2); for (let i = 0; i < x.length; i++) { const n = x[i + 1] ?? x[i]; o[2 * i] = x[i]; o[2 * i + 1] = (x[i] + n) / 2; } return o; };
