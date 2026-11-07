// The long-lived parts that a request/response framework can't hold: the browser call (WebSocket)
// and the WhatsApp webhook (which starts WebRTC calls). Mounted on the same HTTP server as the UI.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { startCall, reply, endCall, photo, DESKS } from './agent.ts';
import type { Desk } from './store.ts';
import { transcribe } from './ai.ts';
import { wav, warmUp } from './tts.ts';
import { voiceLine } from './turn.ts';
import { whatsappWebhook } from './whatsapp.ts';

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
    // ?desk=launch|business picks the desk up front; without it the router asks. The owner desk is not reachable from here.
    const q = new URL(req.url ?? '/', 'http://x').searchParams.get('desk');
    const { call, greeting } = startCall('web', undefined, q === 'launch' || q === 'business' ? (q as Desk) : undefined);
    const line = voiceLine((pcm, rate) => { if (ws.readyState === 1) ws.send(wav(pcm, rate)); });
    const sendLink = () => {
      const l = call.desk ? DESKS[call.desk].link?.(call) : null;
      ws.send(JSON.stringify({ type: 'desk', desk: call.desk ?? null }));
      if (l) ws.send(JSON.stringify({ type: 'link', ...l }));
    };
    const hooks = (signal: AbortSignal, timing: any) => ({
      signal, timing,
      onSentence: (s: string) => { ws.send(JSON.stringify({ type: 'agent', text: s })); line.say(s); },
      onSlowTool: (name: string) => line.filler(name === 'photo' ? 'photo' : 'draw'),
    });
    warmUp().then(() => { ws.send(JSON.stringify({ type: 'agent', text: greeting })); return line.say(greeting); }).catch(console.error);
    let busy = false;
    ws.on('message', async (data, isBinary) => {
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
        if (msg.type === 'text') data = Buffer.from(msg.text); // typed fallback
        else return;
      }
      if (busy) return;
      busy = true;
      try {
        const { signal, timing } = line.begin();
        const text = isBinary ? await transcribe(new Uint8Array(data as Buffer)) : String(data);
        timing.sttMs = Date.now() - timing.start!;
        if (!text || text.length < 2) return;
        ws.send(JSON.stringify({ type: 'caller', text }));
        line.ackSoon();
        await reply(call.id, text, hooks(signal, timing));
        sendLink();
        await line.end(call.id);
      } catch (e: any) {
        if (e?.name === 'AbortError' || /abort/i.test(e?.message)) return; // barge-in
        console.error(e);
        ws.send(JSON.stringify({ type: 'error', text: e.message }));
      } finally {
        busy = false;
      }
    });
    ws.on('close', () => endCall(call.id));
  });
}
