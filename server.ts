import { giftsTo, topGifters, totalTo, watch, hostLine, postChat, chatsOf } from './src/stream.ts';
import { ipOf } from './src/live.ts';
import { findPacket, publicPacket } from './src/packets.ts';
import { db, save } from './src/store.ts';
// One process, one port: TanStack Start (pages + /api routes) and the voice/WhatsApp handlers.
//   npm run dev  -> Vite in middleware mode (HMR, SSR from source)
//   npm start    -> the built Start handler from dist/ (run `npm run build` first)
import { handleAccess } from './src/access.ts';
import { handleTopup } from './src/topupPage.ts';
import { startHeldLoop } from './src/held.ts';
import { bindingOf, createCustodial, custodyLive, saveRecipient, walletState } from './src/wallet.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { env } from './src/config.ts';
import { attachVoice, handleWebhook } from './src/voice.ts';
import { warmUp, provider as ttsProvider } from './src/tts.ts';
import { attest } from './src/ai.ts';
import { handleLive } from './src/live.ts';
import { onButton } from './src/desks/wallet.ts';

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
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
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
      // The room host's 3D model: gzipped once (10 MB -> about 4 MB) and cached by the browser for a day.
      if (extname(file) === '.vrm') {
        const gz = file + '.gz';
        if (!existsSync(gz) || statSync(gz).mtimeMs < statSync(file).mtimeMs) writeFileSync(gz, gzipSync(readFileSync(file), { level: 9 }));
        const zip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
        res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': zip ? statSync(gz).size : size, 'cache-control': 'public, max-age=86400', ...(zip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}) });
        return createReadStream(zip ? gz : file).pipe(res);
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
  if (!env.dashboardPassword) return env.network !== 'mainnet'; // fail closed on mainnet without a password
  const [, b64] = (req.headers.authorization ?? '').split(' ');
  return Buffer.from(b64 ?? '', 'base64').toString().split(':')[1] === env.dashboardPassword;
}

server.on('request', async (req, res) => {
  if (await handleWebhook(req, res)) return;
  // For the deploy script: how many calls are on right now (a count only), so it restarts only when the line is idle.
  if (req.url === '/api/live-calls') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ calls: db.calls.filter((c) => !c.endedAt && Date.now() - c.startedAt < 30 * 60_000).length })); return; }
  // The room host's voice: /api/stream/<account>/voice?gift=<at-from> or ?idle=<n>. Only server-made lines.
  { const vm = (req.url ?? '').match(/^\/api\/stream\/([a-z0-9._-]{2,64})\/voice\?(.*)$/);
    if (vm) {
      const q = new URLSearchParams(vm[2]);
      const { speak, wav } = await import('./src/tts.ts');
      const audio = await hostLine(vm[1], { gift: q.get('gift') ?? undefined, idle: q.has('idle') ? Number(q.get('idle')) : undefined }, speak, wav).catch(() => null);
      if (!audio) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=3600' }).end(Buffer.from(audio));
      return;
    } }
  // Room chat: POST /api/stream/<account>/chat {name, text}. Same origin, rate-limited per IP.
  { const cm = (req.url ?? '').match(/^\/api\/stream\/([a-z0-9._-]{2,64})\/chat$/);
    if (cm && req.method === 'POST') {
      if (req.headers.origin !== new URL(env.publicUrl).origin) { res.writeHead(403).end(); return; }
      let b = ''; for await (const c of req) { b += c; if (b.length > 1000) break; }
      let o: any = {}; try { o = JSON.parse(b || '{}'); } catch {}
      const err = postChat(cm[1], ipOf(req), o.name, o.text);
      res.writeHead(err ? 429 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(err ? { error: err } : { ok: true }));
      return;
    } }
  // Stream overlay feed: /api/stream/<account>?since=<ms>&packet=<id>. Public: gifts are on chain anyway; senders masked.
  { const sm = (req.url ?? '').match(/^\/api\/stream\/([a-z0-9._-]{2,64})(?:\?(.*))?$/);
    if (sm) {
      const q = new URLSearchParams(sm[2] ?? ''), pid = (q.get('packet') ?? '').slice(0, 40);
      watch(sm[1]);
      const p = pid ? findPacket(pid) : undefined;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
        .end(JSON.stringify({ gifts: giftsTo(sm[1], Number(q.get('since')) || 0), top: topGifters(sm[1]), total: totalTo(sm[1]), chat: chatsOf(sm[1]), packet: p ? { ...publicPacket(p), hint: p.hint ?? null, claims: p.claims.slice(-8).map((c: any) => ({ to: String(c.to).replace(/^(.{6}).*(\..*)$/, '$1…$2'), near: Number(BigInt(c.yocto)) / 1e24, at: c.at })) } : null }));
      return;
    } }
  if ((req.url ?? '').startsWith('/api/topup/') && await handleTopup(req, res).catch((e) => { console.error('topup page', e.message); if (!res.headersSent) res.writeHead(500).end(); return true; })) return;
  if ((req.url ?? '').startsWith('/api/whatsapp-access') && await handleAccess(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); return true; })) return;
  // The live panel for WhatsApp calls; a tap there runs the same handler as a WhatsApp button tap.
  if (/^\/(llm|llms-full)\.txt$/.test(req.url ?? '')) { res.writeHead(301, { location: '/llms.txt' }).end(); return; }
  if (req.url === "/robot.txt") { res.writeHead(301, { location: "/robots.txt" }).end(); return; }
  if ((req.url ?? '').startsWith('/api/live/') && await handleLive(req, res, onButton).catch((e) => { console.error('live', e.message); if (!res.headersSent) res.writeHead(500).end(); return true; })) return;
  // Normalized: the app router matches case-insensitively and ignores a trailing slash, so must this gate.
  let p = (req.url ?? '/').split('?')[0];
  try { p = decodeURIComponent(p); } catch {}
  p = p.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  if ((p === '/dashboard' || p === '/api/state' || p.startsWith('/dashboard/') || p.startsWith('/api/state/')) && !ownerOnly(req)) return res.writeHead(401, { 'www-authenticate': 'Basic realm="owner"' }).end();
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
  const saved = (await walletState(b)).allowlist;
  // The payee plus the streamers whose rooms the demo may gift to (STREAM_ROOMS): small sends, under the wallet's own caps.
  for (const acct of [to, ...env.streamRooms]) if (acct && !saved.includes(acct)) { await saveRecipient(b, acct); console.log('demo wallet: saved payee', acct); }
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

// A deploy restarts the service: wait (up to 80s, under systemd's 90s stop timeout) for calls in progress to finish,
// so a restart never cuts someone off mid-sentence.
process.on('SIGTERM', async () => {
  const live = () => db.calls.filter((c) => !c.endedAt && Date.now() - c.startedAt < 30 * 60_000).length;
  const until = Date.now() + 80_000;
  while (live() > 0 && Date.now() < until) { console.log(`restart: waiting for ${live()} call(s) to end`); await new Promise((r) => setTimeout(r, 2000)); }
  process.exit(0);
});
// Calls left open by a crash or a forced restart are over: close them so they don't hold up the next restart.
for (const c of db.calls) if (!c.endedAt) c.endedAt = Date.now();
save();
