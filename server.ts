// One process, one port: TanStack Start (pages + /api routes) and the voice/WhatsApp handlers.
//   npm run dev  -> Vite in middleware mode (HMR, SSR from source)
//   npm start    -> the built Start handler from dist/ (run `npm run build` first)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { env } from './src/config.ts';
import { attachVoice, handleWebhook } from './src/voice.ts';
import { warmUp } from './src/tts.ts';
import { attest } from './src/ai.ts';

const dev = process.argv.includes('--dev');
const server = createServer();
let app: (req: IncomingMessage, res: ServerResponse) => void;

if (dev) {
  const { createServer: vite } = await import('vite');
  const v = await vite({ server: { middlewareMode: true, hmr: { server } }, appType: 'custom' });
  app = (req, res) => v.middlewares(req, res);
} else {
  const entry = new URL('./dist/server/server.js', import.meta.url);
  if (!existsSync(entry)) throw new Error('No build found: run `npm run build` first.');
  const { default: start } = await import(entry.href);
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const client = new URL('./dist/client/', import.meta.url).pathname;
  app = async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    const file = join(client, path);
    if (file.startsWith(client) && path !== '/' && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      return createReadStream(file).pipe(res);
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (req as any);
    const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
      method: req.method, headers: req.headers as Record<string, string>, body, duplex: 'half',
    } as RequestInit);
    const r: Response = await start.fetch(request);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const chunk of r.body as any) res.write(chunk);
    res.end();
  };
}

// Owner-only pages and data sit behind HTTP basic auth when DASHBOARD_PASSWORD is set.
function ownerOnly(req: IncomingMessage) {
  if (!env.dashboardPassword) return true;
  const [, b64] = (req.headers.authorization ?? '').split(' ');
  return Buffer.from(b64 ?? '', 'base64').toString().split(':')[1] === env.dashboardPassword;
}

server.on('request', async (req, res) => {
  if (await handleWebhook(req, res)) return;
  const p = (req.url ?? '/').split('?')[0];
  if ((p === '/dashboard' || p === '/api/state' || p === '/api/owner') && !ownerOnly(req)) return res.writeHead(401, { 'www-authenticate': 'Basic realm="owner"' }).end();
  app(req, res);
});
attachVoice(server);
server.listen(env.port, () => {
  console.log(`callhand on ${env.publicUrl}  (call: /  launches: /launch/:id  dashboard: /dashboard)  network: ${env.network}`);
  const t = Date.now();
  warmUp().then(() => console.log(`voice ready (kokoro + fillers, ${Date.now() - t} ms)`), (e) => console.error('tts warm-up', e));
  // Fetch TEE attestations now so the first call doesn't wait for them (cached 10 min, refreshed on use).
  if (!env.mockLlm) for (const m of [env.llmModel, env.sttModel]) attest(m).then(() => console.log('attested', m), (e) => console.error('attest', m, e.message));
  else console.log('MOCK_LLM=1: scripted chat + STT, real TTS');
});
