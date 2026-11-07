import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { env, owner } from './config.ts';
import { db, save, log } from './store.ts';
import { startCall, reply, endCall } from './agent.ts';
import { transcribe, attest } from './ai.ts';
import { speak, wav, warmUp } from './tts.ts';
import { listTokens, quoteDeposit, depositStatus } from './pay.ts';
import { whatsappWebhook } from './whatsapp.ts';
import QRCode from 'qrcode';

const page = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((ok, bad) => {
    const parts: Buffer[] = [];
    req.on('data', (c) => parts.push(c)).on('end', () => ok(Buffer.concat(parts))).on('error', bad);
  });

function ownerOnly(req: IncomingMessage) {
  if (!env.dashboardPassword) return true;
  const [, b64] = (req.headers.authorization ?? '').split(' ');
  return Buffer.from(b64 ?? '', 'base64').toString().split(':')[1] === env.dashboardPassword;
}

// A job's public view: what the payer needs, nothing about other customers.
const publicJob = (j: (typeof db.jobs)[number]) => ({
  id: j.id, business: owner().business.name, service: j.serviceName, quotedUsd: j.quotedUsd, depositUsd: j.depositUsd,
  name: j.caller.name, payout: owner().payout.asset_symbol, payment: j.payment ?? null,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/call') return res.writeHead(200, { 'content-type': 'text/html' }).end(page('call.html'));
    if (p === '/dashboard') {
      if (!ownerOnly(req)) return res.writeHead(401, { 'www-authenticate': 'Basic realm="owner"' }).end();
      return res.writeHead(200, { 'content-type': 'text/html' }).end(page('dashboard.html'));
    }
    if (p === '/static/style.css') return res.writeHead(200, { 'content-type': 'text/css' }).end(page('style.css'));
    if (p === '/api/qr') return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(await QRCode.toString(url.searchParams.get('text') ?? '', { type: 'svg', margin: 0 }));
    if (p.startsWith('/pay/')) return res.writeHead(200, { 'content-type': 'text/html' }).end(page('pay.html'));

    if (p === '/api/state') {
      if (!ownerOnly(req)) return json(res, 401, { error: 'owner only' });
      const a = await attest().catch((e) => ({ error: String(e.message) }));
      return json(res, 200, { owner: owner(), attestation: a, model: env.llmModel, calls: db.calls.slice(-30).reverse(), jobs: db.jobs.slice(-30).reverse(), ledger: db.ledger.slice(-100).reverse() });
    }
    if (p === '/api/tokens') {
      const t = await listTokens();
      return json(res, 200, t.filter((x) => x.price > 0).map(({ assetId, blockchain, symbol, decimals, price }) => ({ assetId, blockchain, symbol, decimals, price })));
    }
    const m = p.match(/^\/api\/pay\/([\w-]+)(\/quote|\/status)?$/);
    if (m) {
      const job = db.jobs.find((j) => j.id === m[1]);
      if (!job) return json(res, 404, { error: 'no such job' });
      if (!m[2]) return json(res, 200, publicJob(job));
      if (m[2] === '/quote' && req.method === 'POST') {
        if (job.payment && ['SUCCESS', 'PROCESSING', 'KNOWN_DEPOSIT_TX'].includes(job.payment.status)) return json(res, 409, { error: 'already paid' });
        const { originAsset, refundTo } = JSON.parse((await readBody(req)).toString() || '{}');
        const t = (await listTokens()).find((x) => x.assetId === originAsset);
        if (!t || !refundTo) return json(res, 400, { error: 'pick a token and give a refund address' });
        const quote = await quoteDeposit({ usd: job.depositUsd, originAsset, refundTo: String(refundTo).trim(), dry: false });
        job.payment = { quote, status: 'PENDING_DEPOSIT', updatedAt: Date.now(), originSymbol: t.symbol, chain: t.blockchain };
        save();
        return json(res, 200, publicJob(job));
      }
      if (m[2] === '/status') {
        if (!job.payment?.quote.depositAddress) return json(res, 200, publicJob(job));
        const s = await depositStatus(job.payment.quote.depositAddress, job.payment.quote.depositMemo);
        if (s.status !== job.payment.status) {
          job.payment.status = s.status;
          job.payment.updatedAt = Date.now();
          log({ kind: 'payment', jobId: job.id, detail: `${s.status}: $${job.depositUsd} deposit via ${job.payment.originSymbol} on ${job.payment.chain}` });
        }
        return json(res, 200, publicJob(job));
      }
    }
    if (p === '/webhooks/whatsapp') return whatsappWebhook(req, res, await readBody(req), url);
    res.writeHead(404).end('not found');
  } catch (e: any) {
    console.error(p, e);
    json(res, 500, { error: e.message });
  }
});

// Browser call: the page sends one WAV per utterance, we answer with text + WAV.
const wss = new WebSocketServer({ server, path: '/ws/call' });
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

server.listen(env.port, () => {
  console.log(`callhand on ${env.publicUrl}  (call: /  owner: /dashboard)`);
  warmUp().then(() => console.log('voice ready'));
});
