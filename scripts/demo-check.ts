// Headless smoke test of the no-key path: starts the built server with MOCK_LLM=1 and no .env, walks one launch,
// a declined building quote and a wallet dry run over the browser-call WebSocket (typed fallback), and checks the pages render.
//   npm run demo:check   (builds first; prints PASS/FAIL per step; exit 1 on any failure; stops the server)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
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
// A phone already bound to a wallet (PIN 1234, salted scrypt like src/wallet.ts), so the wallet desk can be walked.
writeFileSync(env.DB_FILE!, JSON.stringify({ wallets: [{ phone: '15550001234', owner: 'alice.testnet', contract: 'phone.alice.testnet', salt: 'demo', pinHash: scryptSync('1234', 'demo', 32).toString('hex'), fails: 0, createdAt: 0 }] }));
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
    must(api.params?.symbol === 'ZZOTR' && api.status === 'prepared', JSON.stringify(api).slice(0, 200));
    // The pad comes from launchpad.yaml: JustHoot is mainnet only, meme.cooking follows NETWORK.
    must(api.launchpad === 'justhoot' ? api.network === 'mainnet' : api.network === 'testnet', `pad ${api.launchpad} on ${api.network}`);
    return `$${api.params.symbol} on ${api.launchpad} (${api.network}), ${api.status}, logo: ${api.logoModel}; nothing signed`;
  });

  await step('building quotes are not offered: the router declines instead of opening the business desk', async () => {
    const r = await call('business', ['I need a new kitchen, can you quote it?']);
    must(r.said.some((s) => /don't do building quotes/i.test(s)), 'no polite decline: ' + r.said.join(' | '));
    must(!r.link, 'a link was sent');
    return r.said.at(-1);
  });
  await step('ledger records the refusal and the launch', async () => {
    const s = JSON.parse((await get('/api/state')).text);
    const kinds = s.ledger.map((l: any) => l.kind);
    for (const k of ['refused', 'launch_prepared']) must(kinds.includes(k), `no ${k} in the ledger`);
    must(!kinds.includes('booking'), 'a booking was made');
    return `${s.ledger.length} entries`;
  });
  await step('wallet desk: send 0.1 NEAR to liho.testnet, read back, PIN, dry run (no agent key)', async () => {
    const r = await call('wallet&from=15550001234', ['send 0.1 NEAR to liho.testnet', 'one two three four']);
    must(r.said.some((s) => /0\.1 NEAR to liho dot testnet/.test(s)), 'no read-back: ' + r.said.join(' | '));
    must(r.said.some((s) => /dry run/i.test(s)), 'no dry-run reply: ' + r.said.join(' | '));
    const s = JSON.parse((await get('/api/state')).text);
    must(s.ledger.some((l: any) => l.kind === 'wallet' && /DRY RUN/.test(l.detail)), 'no DRY RUN ledger entry');
    must(!JSON.stringify(s).includes('one two three four'), 'PIN left in the transcript');
    return 'stopped before signing: DRY RUN';
  });
  await step('wallet desk: an EVM send is refused politely (EVM_ENABLED off)', async () => {
    const r = await call('wallet&from=15550001234', ['send 0.0001 ETH on Base to 0x1111111111111111111111111111111111111111']);
    must(r.said.some((s) => /only NEAR/i.test(s)), 'no NEAR-only reply: ' + r.said.join(' | '));
  });
  // WhatsApp webhook payloads, posted locally (no WHATSAPP_APP_SECRET in this clean env, so no signature to forge).
  const wa = (from: string, m: object) => fetch(`${BASE}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.x', ...m }] } }] }] }) });
  const ledger = async () => JSON.parse((await get('/api/state')).text).ledger.map((l: any) => l.detail) as string[];
  const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 40; i++) { if (await f()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
  await step('wallet desk: 0.3 NEAR needs the PIN, then the WhatsApp Approve tap; a simulated button reply executes it (dry run)', async () => {
    const r = await call('wallet&from=15550001234', ['send 0.3 NEAR to liho.testnet', 'one two three four']);
    must(r.said.some((s) => /Approve button/i.test(s)), 'no approval prompt: ' + r.said.join(' | '));
    const token = log.match(/approve:([0-9a-f]{32})/g)?.at(-1)?.slice(8);
    must(token, 'no approval token in the server log');
    await wa('15550001234', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `approve:${token}`, title: 'Approve' } } });
    must(await until(async () => (await ledger()).some((d) => /approved on WhatsApp: 0\.3 NEAR/.test(d))), 'no approval in the ledger');
    return 'approved by button reply; DRY RUN';
  });
  await step('custodial create in WhatsApp chat: no custody key -> labelled dry run, PIN not stored', async () => {
    await wa('15550002222', { type: 'text', text: { body: 'create a wallet' } });
    await new Promise((r) => setTimeout(r, 300));
    await wa('15550002222', { type: 'text', text: { body: '9876' } });
    must(await until(async () => (await ledger()).some((d) => /DRY RUN \(no CUSTODY_PRIVATE_KEY\): would create custodial wallet/.test(d))), 'no custodial dry run in the ledger');
    must(!(await get('/api/state')).text.includes('9876'), 'PIN in the state');
    return 'DRY RUN: nothing created on chain';
  });
  await step('wallet desk: "how much did I spend?" lists recent transfers', async () => {
    const r = await call('wallet&from=15550001234', ['how much did I spend?']);
    must(r.said.some((s) => /liho dot testnet/.test(s) && /dry run/i.test(s)), 'no spend summary: ' + r.said.join(' | '));
  });
  await step('/wallet/claim page renders', async () => { const r = await get('/wallet/claim'); must(r.status === 200 && /Claim your phone wallet/i.test(r.text), `status ${r.status}`); });
  await step('/wallet/bind page renders', async () => { const r = await get('/wallet/bind'); must(r.status === 200 && /phone number is a wallet/i.test(r.text), `status ${r.status}`); });
  await step('dashboard and /proof pages render', async () => {
    for (const p of ['/dashboard', '/proof']) { const r = await get(p); must(r.status === 200, `${p} answered ${r.status}`); }
  });
} finally {
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 2000).unref();
}
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
process.exit(failed ? 1 : 0);
