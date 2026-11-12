// One process, one port: TanStack Start (pages + /api routes) and the voice/WhatsApp handlers.
//   npm run dev  -> Vite in middleware mode (HMR, SSR from source)
//   npm start    -> the built Start handler from dist/ (run `npm run build` first)
import { startHeldLoop } from './src/held.ts';
import { bindingOf, createCustodial, custodyLive, saveRecipient, walletState } from './src/wallet.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { env } from './src/config.ts';
import { attachVoice, handleWebhook } from './src/voice.ts';
import { warmUp, provider as ttsProvider } from './src/tts.ts';
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
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8' };
  const client = new URL('./dist/client/', import.meta.url).pathname;
  app = async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    const file = join(client, path);
    if (file.startsWith(client) && path !== '/' && existsSync(file) && statSync(file).isFile()) {
      const size = statSync(file).size, type = types[extname(file)] ?? 'application/octet-stream';
      const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      // Byte ranges, so the film plays and seeks in Safari and on phones.
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size) return res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': cache });
        return createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': cache });
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
  if ((p === '/dashboard' || p === '/api/state') && !ownerOnly(req)) return res.writeHead(401, { 'www-authenticate': 'Basic realm="owner"' }).end();
  app(req, res);
});
// A failed send to WhatsApp (Meta refusing a message) must never take the whole line down.
process.on('unhandledRejection', (e) => console.error('unhandled:', (e as Error)?.message ?? e));
attachVoice(server);
startHeldLoop(); // first payments to new recipients go out when their wait is over
// The website's demo wallet: made once on chain when the custody key is set and the demo number has no real wallet yet.
// It only ever pays one saved payee (DEMO_RECIPIENT): the owner (custody) saves that payee on the wallet once.
async function demoWallet() {
  if (!env.demoPhone || !/^\d{4}$/.test(env.demoPin) || !custodyLive()) return;
  if (!bindingOf(env.demoPhone) || bindingOf(env.demoPhone)!.dryRun) {
    const r = await createCustodial(env.demoPhone, env.demoPin);
    console.log('demo wallet:', r.ok ? r.binding.contract : r.reason);
    if (!r.ok) return;
  }
  const b = bindingOf(env.demoPhone)!, to = env.demoRecipient.toLowerCase();
  if (to && !(await walletState(b)).allowlist.includes(to)) { await saveRecipient(b, to); console.log('demo wallet: saved payee', to); }
}
demoWallet().catch((e) => console.error('demo wallet failed:', e.message));
server.listen(env.port, () => {
  console.log(`Ringfence on ${env.publicUrl}  (call: /  launches: /launch/:id  dashboard: /dashboard)  network: ${env.network}`);
  const t = Date.now();
  warmUp().then(() => console.log(`voice ready (${ttsProvider} + fillers, ${Date.now() - t} ms)`), (e) => console.error('tts warm-up', e));
  // Fetch TEE attestations now so the first call doesn't wait for them (cached 10 min, refreshed on use).
  if (!env.mockLlm) for (const m of [env.llmModel, env.sttModel]) attest(m).then(() => console.log('attested', m), (e) => console.error('attest', m, e.message));
  else console.log('MOCK_LLM=1: scripted chat + STT, real TTS');
});
