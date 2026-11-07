// The long-lived parts that a request/response framework can't hold: the browser call (WebSocket)
// and the WhatsApp webhook (which starts WebRTC calls). Mounted on the same HTTP server as the UI.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { env } from './config.ts';
import { startCall, reply, endCall } from './agent.ts';
import { transcribe } from './ai.ts';
import { speak, wav } from './tts.ts';
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
  wss.on('connection', (ws) => {
    const { call, greeting } = startCall('web');
    const say = async (text: string) => {
      ws.send(JSON.stringify({ type: 'agent', text }));
      const { pcm, rate } = await speak(text);
      ws.send(wav(pcm, rate));
    };
    say(greeting).catch(console.error);
    let busy = false;
    ws.on('message', async (data, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(String(data));
        if (msg.type === 'text') data = Buffer.from(msg.text); // typed fallback
        else return;
      }
      if (busy) return;
      busy = true;
      try {
        const text = isBinary ? await transcribe(new Uint8Array(data as Buffer)) : String(data);
        if (!text || text.length < 2) return;
        ws.send(JSON.stringify({ type: 'caller', text }));
        const answer = await reply(call.id, text);
        if (call.jobId) ws.send(JSON.stringify({ type: 'link', url: `${env.publicUrl}/pay/${call.jobId}` }));
        await say(answer);
      } catch (e: any) {
        console.error(e);
        ws.send(JSON.stringify({ type: 'error', text: e.message }));
      } finally {
        busy = false;
      }
    });
    ws.on('close', () => endCall(call.id));
  });
}
