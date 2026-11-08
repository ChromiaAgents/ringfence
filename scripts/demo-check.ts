// Headless smoke test of the no-key path: starts the built server with MOCK_LLM=1 and no .env, walks one launch
// and one business booking over the browser-call WebSocket (typed fallback), and checks the pages render.
//   npm run demo:check   (builds first; prints PASS/FAIL per step; exit 1 on any failure; stops the server)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

// A free port, so a running dev server is left alone.
const PORT: number = await new Promise((ok) => { const s = createServer().listen(0, () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });
const BASE = `http://localhost:${PORT}`;
// A clean environment: no .env is loaded and no key is passed, so this is exactly what a judge without keys gets.
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', MOCK_LLM: '1', TTS: 'off', PORT: String(PORT),
  MOCK_TTFT_MS: '20', MOCK_TOKEN_MS: '1', NETWORK: 'testnet', DB_FILE: join(mkdtempSync(join(tmpdir(), 'callhand-demo-')), 'db.json'),
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

let failed = 0;
const step = async (name: string, f: () => Promise<string | void>) => {
  try { const note = await f(); console.log(`PASS  ${name}${note ? `  (${note})` : ''}`); }
  catch (e: any) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
};
const must = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
const get = async (path: string) => { const r = await fetch(BASE + path); return { status: r.status, text: await r.text() }; };

/** One browser call: sends typed lines and waits for each turn to finish (the server sends {type:'desk'} after every reply). */
async function call(desk: string, lines: string[]) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws/call?desk=${desk}`);
  const said: string[] = [];
  let link: { url: string; label: string } | null = null;
  let done: (() => void) | null = null;
  ws.on('message', (d, bin) => {
    if (bin) return;
    const m = JSON.parse(String(d));
    if (m.type === 'agent') said.push(m.text);
    if (m.type === 'link') link = m;
    if (m.type === 'error') said.push('[error] ' + m.text);
    if (m.type === 'desk') done?.();
  });
  await new Promise((ok, bad) => { ws.once('open', ok); ws.once('error', bad); });
  for (const text of lines) {
    await new Promise<void>((ok, bad) => {
      done = ok;
      setTimeout(() => bad(new Error(`no reply to "${text}"`)), 20_000);
      ws.send(JSON.stringify({ type: 'text', text }));
    });
  }
  ws.close();
  return { said, link: link as { url: string; label: string } | null };
}

try {
  await step('server starts with MOCK_LLM=1, no .env, no key', async () => {
    for (let i = 0; i < 60; i++) {
      if (server.exitCode != null) throw new Error('server exited: ' + log.slice(-400));
      try { if ((await fetch(BASE + '/')).ok) return `port ${PORT}`; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('not up after 30 s: ' + log.slice(-400));
  });

  let launchUrl = '';
  await step('launch desk: refuses ticker NEAR, then prepares a launch over the call socket', async () => {
    const r = await call('launch', [
      "It's a coin about a sleepy otter",
      'Call it Sleepy Otter, ticker NEAR',
      'Call it Sleepy Otter, ticker ZZOTR',
      'Logo vibe: a sleepy otter on a pillow',
      'One hour, soft cap 100 NEAR',
      'Yes, set it up',
    ]);
    must(r.said.some((s) => /existing asset/i.test(s)), 'no refusal for NEAR: ' + r.said.join(' | '));
    must(r.link?.url.includes('/launch/'), 'no launch link: ' + r.said.join(' | '));
    launchUrl = r.link!.url;
    return launchUrl;
  });
  await step('launch page renders (/launch/:id) with the agreed terms', async () => {
    must(launchUrl, 'no launch from the previous step');
    const id = launchUrl.split('/launch/')[1];
    const page = await get(`/launch/${id}`);
    must(page.status === 200, `status ${page.status}`);
    must(page.text.includes('ZZOTR') || page.text.includes('Sleepy Otter'), 'terms not in the page');
    const api = JSON.parse((await get(`/api/launch/${id}`)).text);
    must(api.params?.symbol === 'ZZOTR' && api.status === 'prepared' && api.network === 'testnet', JSON.stringify(api).slice(0, 200));
    return `$${api.params.symbol}, ${api.params.durationMinutes} min, soft cap ${api.params.softCapNear} NEAR, ${api.status}, logo: ${api.logoModel}`;
  });

  let payUrl = '';
  await step('business desk: refuses 30% off, quotes, books, sends a deposit link', async () => {
    const r = await call('business', [
      'I need a new kitchen, can you do 30% off?',
      'OK, no discount then, what is the quote?',
      'My name is Sam Lee, postcode N5 1AA',
      'OK, book it for Tuesday',
    ]);
    must(r.said.some((s) => /max discount/i.test(s)), 'no discount refusal: ' + r.said.join(' | '));
    must(r.link?.url.includes('/pay/'), 'no deposit link: ' + r.said.join(' | '));
    payUrl = r.link!.url;
    return payUrl;
  });
  await step('pay page renders (/pay/:jobId) with the deposit', async () => {
    must(payUrl, 'no job from the previous step');
    const id = payUrl.split('/pay/')[1];
    const page = await get(`/pay/${id}`);
    must(page.status === 200, `status ${page.status}`);
    const api = JSON.parse((await get(`/api/pay/${id}`)).text);
    must(api.depositUsd > 0, JSON.stringify(api).slice(0, 200));
    return `${api.service}, $${api.quotedUsd}, deposit $${api.depositUsd}`;
  });
  await step('ledger records the refusals, the launch and the booking', async () => {
    const s = JSON.parse((await get('/api/state')).text);
    const kinds = s.ledger.map((l: any) => l.kind);
    for (const k of ['refused', 'launch_prepared', 'booking', 'deposit_link']) must(kinds.includes(k), `no ${k} in the ledger`);
    must(kinds.filter((k: string) => k === 'refused').length >= 2, 'expected at least 2 refusals');
    return `${s.ledger.length} entries`;
  });
  await step('dashboard and /proof pages render', async () => {
    for (const p of ['/dashboard', '/proof']) { const r = await get(p); must(r.status === 200, `${p} answered ${r.status}`); }
  });
} finally {
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 2000).unref();
}
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
process.exit(failed ? 1 : 0);
