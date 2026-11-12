// The long-lived parts that a request/response framework can't hold: the browser call (WebSocket)
// and the WhatsApp webhook (which starts WebRTC calls). Mounted on the same HTTP server as the UI.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { isFiller, startCall, reply, endCall, photo, linkOf } from './agent.ts';
import { transcribe } from './ai.ts';
import { wav, warmUp } from './tts.ts';
import { voiceLine } from './turn.ts';
import { whatsappWebhook } from './whatsapp.ts';
import { onCallNews, onWebApproval, onButton, parseRecipient } from './desks/wallet.ts';
import { devServer } from './wallet.ts';
import { env } from './config.ts';

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((ok, bad) => {
    const parts: Buffer[] = [];
    req.on('data', (c) => parts.push(c)).on('end', () => ok(Buffer.concat(parts))).on('error', bad);
  });

/** Handles /webhooks/whatsapp; returns false for any other path. */
export async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/webhooks/whatsapp') return false;
  try {
    await whatsappWebhook(req, res, await readBody(req), url);
  } catch (e: any) {
    console.error('webhook', e);
    if (!res.headersSent) res.writeHead(500).end();
  }
  return true;
}

// Browser call: the page sends one WAV per utterance, we answer with text + WAV.
export function attachVoice(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws/call') return; // leave others (Vite HMR) alone
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req: IncomingMessage) => {
    // One agent for every call; ?desk=launch only labels the call. The owner's tools are never reachable from here.
    const sp = new URL(req.url ?? '/', 'http://x').searchParams, q = sp.get('desk');
    // ?from= stands in for a WhatsApp number in the keyless demo only (MOCK_LLM=1, no keys); a real browser call has no number.
    const from = env.mockLlm && devServer() ? sp.get('from') ?? undefined : undefined; // never with real keys
    const packetId = (sp.get('packet') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || undefined; // from a packet page's Call button
    const payTo = packetId ? parseRecipient(sp.get('to') ?? '', 'near') ?? undefined : undefined; // typed on the packet page
    const { call, greeting } = startCall('web', from, q === 'launch' ? 'launch' : undefined, packetId, payTo);
    const line = voiceLine((pcm, rate) => { if (ws.readyState === 1) ws.send(wav(pcm, rate)); });
    const sendLink = () => {
      const l = linkOf(call);
      if (l) ws.send(JSON.stringify({ type: 'link', ...l }));
      if (call.choices?.length) { ws.send(JSON.stringify({ type: 'choices', options: call.choices })); call.choices = undefined; }
      ws.send(JSON.stringify({ type: 'desk', desk: call.desk ?? 'agent' })); // last: marks the end of the turn
    };
    const hooks = (signal: AbortSignal, timing: any) => ({
      signal, timing,
      onSentence: (s: string) => { ws.send(JSON.stringify({ type: 'agent', text: s })); line.say(s); },
      onSlowTool: (name: string) => line.filler(name === 'photo' ? 'photo' : 'draw'),
      onToolStart: (say: string) => line.toolStart(say),
    });
    ws.send(JSON.stringify({ type: 'agent', text: greeting })); // text first: the call works even if TTS is still loading
    warmUp().then(() => line.say(greeting)).catch(console.error);
    let busy = false;
    // A typed line that arrives while a reply is still being made is kept and answered next (the newest one wins);
    // it used to be dropped without a word. Audio that arrives then is still dropped: the caller was hearing the agent.
    let queued: string | null = null;
    const onMessage = async (data: any, isBinary: boolean) => {
      if (!isBinary) {
        const msg = JSON.parse(String(data));
        if (msg.type === 'barge') { line.cancel(); return; } // caller talked over the agent
        if (msg.type === 'photo' && !busy) { // data URL from the upload button
          busy = true;
          try {
            const img = Buffer.from(String(msg.dataUrl).split(',')[1] ?? '', 'base64');
            if (img.length > 8_000_000) throw new Error('Photo too large (8 MB max).');
            ws.send(JSON.stringify({ type: 'caller', text: '[sent a photo]' }));
            const { signal, timing } = line.begin();
            await photo(call.id, img, hooks(signal, timing));
            sendLink();
            await line.end('photo');
          } catch (e: any) { ws.send(JSON.stringify({ type: 'error', text: e.message })); } finally { busy = false; }
          return;
        }
        // A tap on the on-screen Approve card (website demo wallet only: the browser is that wallet's "phone").
        if (msg.type === 'button') { if (env.demoPhone && !call.from) onButton(env.demoPhone, String(msg.id)).catch(console.error); return; }
        if (msg.type === 'text') data = Buffer.from(msg.text); // typed fallback
        else return;
      }
      if (busy) { if (!isBinary) queued = String(data); return; }
      busy = true;
      try {
        const { signal, timing } = line.begin();
        const text = isBinary ? await transcribe(new Uint8Array(data as Buffer)) : String(data);
        timing.sttMs = Date.now() - timing.start!;
        if (!text || text.length < 2 || isFiller(text)) {
          timing.totalMs = Date.now() - timing.start!; // stops the keep-alive
          // Real speech that came back empty (short numbers, like a PIN, sometimes do): say so, never go silent.
          if (isBinary && (data as Buffer).length > 24_000) { const m = "Sorry, I didn't catch that. Say it again, or type it below."; ws.send(JSON.stringify({ type: 'agent', text: m })); await line.say(m); ws.send(JSON.stringify({ type: 'desk', desk: null })); }
          return;
        }
        ws.send(JSON.stringify({ type: 'caller', text }));
        line.ackSoon();
        let hangUp = false;
        await reply(call.id, text, { ...hooks(signal, timing), onEndCall: () => (hangUp = true) });
        if (hangUp) ws.send(JSON.stringify({ type: 'hangup' })); // the AI called end_call: the page hangs up once the goodbye has played
        sendLink();
        await line.end(call.id);
      } catch (e: any) {
        if (e?.name === 'AbortError' || /abort/i.test(e?.message)) return; // barge-in
        console.error(e);
        ws.send(JSON.stringify({ type: 'error', text: e.message }));
      } finally {
        busy = false;
        if (queued !== null) { const text = queued; queued = null; void onMessage(Buffer.from(JSON.stringify({ type: 'text', text })), false); }
      }
    };
    ws.on('message', onMessage);
    // After an Approve / Reject tap on WhatsApp, the agent on this call says what happened.
    onCallNews(call.id, (s) => { if (ws.readyState !== 1) return; ws.send(JSON.stringify({ type: 'agent', text: s })); line.say(s); });
    onWebApproval(call.id, (body, token) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'approval', body, token })); });
    ws.on('close', () => { onCallNews(call.id, null); onWebApproval(call.id, null); endCall(call.id); });
  });
}
