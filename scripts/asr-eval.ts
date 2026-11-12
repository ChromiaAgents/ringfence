// Speech eval for crypto / NEAR terms through the production transcribe().
// Usage: npm run asr:eval -- --label before
//        npm run asr:eval -- --phrases scripts/asr-judge-phrases.json --agent --label judge-before
// --phrases <file>: another phrase set (entries may carry `group` and `expect`; scores are then split by group).
// --agent: also feed each phrase's transcript (one voice per language) to the real agent turn (reply() in src/agent.ts)
//   on a fresh web call; the first tool call the model makes is recorded and the turn is stopped there, so no tool
//   (prepare_transfer, confirm_transfer, top up...) ever runs. TTS is not involved.
// Audio is synthesized with macOS `say`, cached under the eval dir, so reruns only cost STT calls.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { transcribe } from '../src/ai.ts';

type Expect = { tool: string; token?: string; amount?: number; to?: string };
type Phrase = { id: string; lang: 'en' | 'zh'; text: string; say?: string; terms: string[]; group?: string; expect?: Expect };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const label = arg('--label') ?? 'run';
const DIR = process.env.ASR_EVAL_DIR ?? '/private/tmp/claude-501/-Users-liho-Desktop-chromia/fa8b011f-eee8-4fdc-901f-4ba6b705dbc6/scratchpad/asr-eval';
const AUDIO = join(DIR, 'audio');
mkdirSync(AUDIO, { recursive: true });

const VOICES = {
  en: ['Samantha', 'Daniel', 'Rishi', 'Karen', 'Tessa'], // US, GB, IN, AU, ZA
  zh: ['Tingting', 'Eddy (Chinese (China mainland))', 'Flo (Chinese (China mainland))'],
};

const phrasesFile = arg('--phrases');
const phrases: Phrase[] = JSON.parse(readFileSync(phrasesFile ? resolve(phrasesFile) : new URL('./asr-phrases.json', import.meta.url), 'utf8'));
const AGENT = process.argv.includes('--agent');
const CONC = Number(arg('--concurrency') ?? 3);

function audioFor(p: Phrase, voice: string): string {
  const spoken = p.say ?? p.text;
  const h = createHash('sha1').update(voice + '\0' + spoken).digest('hex').slice(0, 10);
  const wav = join(AUDIO, `${p.id}-${voice.split(' ')[0]}-${h}.wav`);
  if (!existsSync(wav)) {
    const aiff = wav.replace(/\.wav$/, '.aiff');
    execFileSync('say', ['-v', voice, '-o', aiff, spoken]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]);
    execFileSync('rm', ['-f', aiff]);
  }
  return wav;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Case-sensitive when the term has a capital, digit or dot (symbols, amounts, accounts); else case-insensitive. Han terms: plain substring. */
function found(term: string, transcript: string): boolean {
  if (/\p{Script=Han}/u.test(term)) return transcript.includes(term);
  const exact = /[A-Z0-9.]/.test(term);
  return new RegExp(`(?<!(?!\\p{Script=Han})[\\p{L}\\p{N}.\\-])${esc(term)}(?!(?!\\p{Script=Han})[\\p{L}\\p{N}\\-]|\\.[\\p{L}\\p{N}])`, exact ? 'u' : 'iu').test(transcript);
}
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\.(?!\p{L})|(?<!\p{L}|\p{N})\./gu, ' ').replace(/\s+/g, ' ').trim();

async function withRetry<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch { await new Promise((r) => setTimeout(r, 1500)); return f(); }
}

type Row = { id: string; group?: string; voice: string; lang: string; expected: string; spoken: string; transcript: string; error?: string; terms: { term: string; ok: boolean }[]; exact: boolean };
const jobs = phrases.flatMap((p) => VOICES[p.lang].map((voice) => ({ p, voice })));
const rows: Row[] = new Array(jobs.length);
let next = 0, done = 0;

async function worker() {
  while (next < jobs.length) {
    const i = next++;
    const { p, voice } = jobs[i];
    let transcript = '', error: string | undefined;
    try {
      const wav = audioFor(p, voice);
      transcript = await withRetry(() => transcribe(new Uint8Array(readFileSync(wav)), 'audio/wav'));
    } catch (e: any) { error = String(e?.message ?? e).slice(0, 200); }
    const terms = p.terms.map((term) => ({ term, ok: !error && found(term, transcript) }));
    rows[i] = { id: p.id, group: p.group, voice, lang: p.lang, expected: p.text, spoken: p.say ?? p.text, transcript, error, terms, exact: !error && norm(transcript) === norm(p.text) };
    if (++done % 25 === 0) process.stderr.write(`${done}/${jobs.length}\n`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// misses table
const misses = rows.flatMap((r) => r.terms.filter((t) => !t.ok).map((t) => ({ term: t.term, voice: r.voice.split(' ')[0], id: r.id, heard: r.error ? `ERROR ${r.error}` : r.transcript })));
console.log('\nMISSES (expected term | voice | heard)');
for (const m of misses) console.log(`${m.id} ${m.term.padEnd(34)} | ${m.voice.padEnd(9)} | ${m.heard}`);

// worst terms by miss rate
const byTerm = new Map<string, { miss: number; n: number; heard: string[] }>();
for (const r of rows) for (const t of r.terms) {
  const s = byTerm.get(t.term) ?? { miss: 0, n: 0, heard: [] };
  s.n++; if (!t.ok) { s.miss++; s.heard.push(r.transcript); }
  byTerm.set(t.term, s);
}
const worst = [...byTerm].filter(([, s]) => s.miss).sort((a, b) => b[1].miss / b[1].n - a[1].miss / a[1].n || b[1].miss - a[1].miss).slice(0, 15);
console.log('\nWORST 15 TERMS (term | missed/total | example heard)');
for (const [t, s] of worst) console.log(`${t.padEnd(34)} | ${s.miss}/${s.n} | ${s.heard[0]}`);

const N = rows.reduce((a, r) => a + r.terms.length, 0);
const n = rows.reduce((a, r) => a + r.terms.filter((t) => t.ok).length, 0);
const ex = rows.filter((r) => r.exact).length;
const pct = (a: number, b: number) => ((100 * a) / b).toFixed(1);
const errors = rows.filter((r) => r.error).length;
const groups = [...new Set(rows.map((r) => r.group ?? 'all'))];
const byGroup = Object.fromEntries(groups.map((g) => {
  const rs = rows.filter((r) => (r.group ?? 'all') === g);
  const gN = rs.reduce((a, r) => a + r.terms.length, 0), gn = rs.reduce((a, r) => a + r.terms.filter((t) => t.ok).length, 0);
  return [g, { terms: gN, termsOk: gn, termAccuracy: gN ? gn / gN : null, phrases: rs.length, exact: rs.filter((r) => r.exact).length }];
}));
if (groups.length > 1) {
  console.log('\nTERM ACCURACY BY GROUP');
  for (const [g, s] of Object.entries(byGroup)) console.log(`${g.padEnd(10)} ${s.terms ? pct(s.termsOk, s.terms) : '-'}% (${s.termsOk}/${s.terms}), exact phrases ${pct(s.exact, s.phrases)}%`);
}
const agent = AGENT ? await runAgent(rows) : undefined;
const out = join(DIR, `results-${label}.json`);
writeFileSync(out, JSON.stringify({ label, at: new Date().toISOString(), phrases: phrasesFile ?? 'scripts/asr-phrases.json', voices: VOICES, termAccuracy: n / N, phraseAccuracy: ex / rows.length, errors, byGroup, worst: worst.map(([term, s]) => ({ term, ...s })), agent, rows }, null, 1));
console.log(`\nresults: ${out}${errors ? ` (${errors} errors)` : ''}`);
console.log(`term accuracy ${pct(n, N)}% (${n}/${N}), phrases ${pct(ex, rows.length)}%`);

// ---------------- agent mode ----------------
type Act = { tool: string; args?: any; via?: string; text?: string; error?: string };
type AgentRow = { id: string; group?: string; lang: string; voice: string; said: string; heard: string; expect?: Expect; first: Act; actions: Act[]; ok: boolean; why: string; cryptoOnNegative?: boolean };
function stopErr() { return Object.assign(new Error('stop'), { stop: true }); }

async function runAgent(rows: Row[]): Promise<AgentRow[]> {
  // The agent's store writes to a scratch copy of the db, never data/db.json.
  const dbFile = join(DIR, `agent-db-${label}.json`);
  if (!process.env.DB_FILE) { if (existsSync('data/db.json')) copyFileSync('data/db.json', dbFile); process.env.DB_FILE = dbFile; }
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { chat } = await import('../src/ai.ts');
  const agentMod = await import('../src/agent.ts');
  const als = new AsyncLocalStorage<Act[]>();
  agentMod.setChatForTest(async (messages: any, tools: any, model: any, o: any) => {
    const acts = als.getStore()!;
    // The code-side limit check runs before the model and is injected as a prepare_transfer result.
    for (const m of messages) for (const tc of m.tool_calls ?? []) if (String(tc.id).startsWith('limit-') && !acts.some((a) => a.via === 'limit')) {
      acts.push({ tool: 'refuse_limit', via: 'limit', args: JSON.parse(tc.function.arguments) });
    }
    const r = await chat(messages, tools, model, o);
    if (r.msg.tool_calls?.length) {
      for (const tc of r.msg.tool_calls) { let a: any = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch {} acts.push({ tool: tc.function.name, args: a, via: 'model' }); }
      throw stopErr(); // never run a tool: the prepared action is what we score (no PIN, no Approve, no confirm_transfer)
    }
    acts.push({ tool: 'answer_only', text: typeof r.msg.content === 'string' ? r.msg.content : '' , via: 'model' });
    return r;
  });
  const voiceFor = { en: 'Samantha', zh: VOICES.zh[0] } as const;
  const pick = phrases.map((p) => ({ p, r: rows.find((r) => r.id === p.id && r.voice === voiceFor[p.lang])! }));
  const res: AgentRow[] = new Array(pick.length);
  let k = 0, d = 0;
  const work = async () => {
    while (k < pick.length) {
      const i = k++; const { p, r } = pick[i];
      const acts: Act[] = [];
      let err: string | undefined;
      if (r.error || !r.transcript.trim()) err = r.error ?? 'empty transcript';
      else {
        const { call } = agentMod.startCall('web');
        try { await als.run(acts, () => agentMod.reply(call.id, r.transcript)); }
        catch (e: any) { if (!(e?.stop === true)) { try { await new Promise((z) => setTimeout(z, 2000)); acts.length = 0; const c2 = agentMod.startCall('web').call; await als.run(acts, () => agentMod.reply(c2.id, r.transcript)); } catch (e2: any) { if (!(e2?.stop === true)) err = String(e2?.message ?? e2).slice(0, 200); } } }
        finally { agentMod.endCall(call.id); }
      }
      const first = err ? { tool: 'error', error: err } : acts[0] ?? { tool: 'answer_only' };
      res[i] = { id: p.id, group: p.group, lang: p.lang, voice: r.voice, said: p.say ?? p.text, heard: r.transcript, expect: p.expect, first, actions: acts, ...score(p, acts, first) };
      if (++d % 10 === 0) process.stderr.write(`agent ${d}/${pick.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, work));
  const grp = [...new Set(res.map((x) => x.group ?? 'all'))];
  console.log('\nAGENT ACTION ACCURACY BY GROUP');
  for (const g of grp) { const xs = res.filter((x) => (x.group ?? 'all') === g); console.log(`${g.padEnd(10)} ${pct(xs.filter((x) => x.ok).length, xs.length)}% (${xs.filter((x) => x.ok).length}/${xs.length})`); }
  console.log(`agent overall ${pct(res.filter((x) => x.ok).length, res.length)}%`);
  const bad = res.filter((x) => x.cryptoOnNegative);
  console.log(`\nNEGATIVES TURNED INTO CRYPTO: ${bad.length}`);
  for (const x of bad) console.log(`${x.id} said "${x.said}" | heard "${x.heard}" | did ${x.first.tool} ${JSON.stringify(x.first.args ?? {})}`);
  console.log('\nAGENT MISSES');
  for (const x of res.filter((x) => !x.ok)) console.log(`${x.id} [${x.group}] said "${x.said}" | heard "${x.heard}" | expect ${JSON.stringify(x.expect)} | did ${x.first.tool} ${JSON.stringify(x.first.args ?? {})} | ${x.why}`);
  return res;
}

function score(p: Phrase, acts: Act[], first: Act): { ok: boolean; why: string; cryptoOnNegative?: boolean } {
  const MONEY = new Set(['prepare_transfer', 'confirm_transfer', 'prepare_packet', 'topup_quote', 'prepare_launch']);
  const CRYPTO_FREE = new Set(['answer_only', 'web_search', 'end_call', 'error']);
  const tokenNorm = (t?: string) => String(t ?? '').toUpperCase().replace(/^USD\$?$/, 'USDC').replace(/^NEAR$/, 'NEAR');
  const e = p.expect;
  if (!e) return { ok: true, why: 'no expect' };
  if (first.tool === 'error') return { ok: false, why: first.error ?? 'error' };
  const a = first.args ?? {};
  const amt = (x: any) => (x == null || x === '' ? undefined : Number(x));
  const chk = (fields: [string, unknown, unknown][]) => {
    const wrong = fields.filter(([, want, got]) => want != null && String(want).toLowerCase() !== String(got ?? '').toLowerCase());
    return wrong.length ? { ok: false, why: wrong.map(([f, w, g]) => `${f} ${g ?? '-'} != ${w}`).join(', ') } : { ok: true, why: '' };
  };
  const money = acts.find((x) => MONEY.has(x.tool));
  switch (e.tool) {
    case 'prepare_transfer':
      if (first.tool !== 'prepare_transfer') return { ok: false, why: `tool ${first.tool}` };
      return chk([['token', e.token?.toLowerCase() === 'near' ? 'near' : e.token === 'USDC' ? 'usdc' : e.token, a.asset], ['amount', e.amount, amt(a.amount)], ['to', e.to, a.to]]);
    case 'refuse_limit':
      if (acts.some((x) => x.via === 'limit')) return { ok: true, why: 'code limit check' };
      if (first.tool === 'prepare_transfer' && (e.amount == null || amt(a.amount)! > 1)) return { ok: true, why: 'prepare_transfer over limit (desk refuses in code)' };
      if (first.tool === 'answer_only' && !money) return { ok: true, why: 'model refused' };
      return { ok: false, why: `tool ${first.tool}` };
    case 'refuse_scam':
      return money ? { ok: false, why: `money tool ${money.tool}` } : { ok: true, why: '' };
    case 'answer_only': {
      const crypto = !CRYPTO_FREE.has(first.tool);
      return { ok: !crypto, why: crypto ? `tool ${first.tool}` : '', cryptoOnNegative: p.group === 'negative' && crypto };
    }
    case 'topup_quote':
      if (first.tool !== 'topup_quote') return { ok: false, why: `tool ${first.tool}` };
      return chk([['token', e.token, tokenNorm(a.token)], ['amount', e.amount, amt(a.usd)]]);
    case 'balance':
      return ['get_balance', 'get_spending'].includes(first.tool) ? { ok: true, why: '' } : { ok: false, why: `tool ${first.tool}` };
    case 'price/market':
      if (!['get_price', 'get_trends', 'web_search'].includes(first.tool)) return { ok: false, why: `tool ${first.tool}` };
      if (first.tool === 'get_price' && e.token && !['NEAR', 'USDC'].includes(e.token) ) return { ok: false, why: `get_price coin ${a.coin} for ${e.token}` };
      return { ok: true, why: '' };
    case 'prepare_packet':
      if (first.tool !== 'prepare_packet') return { ok: false, why: `tool ${first.tool}` };
      return chk([['amount', e.amount, amt(a.amount)]]);
    case 'open/claim packet words':
      return ['open_packet', 'get_packet'].includes(first.tool) ? { ok: true, why: '' } : { ok: false, why: `tool ${first.tool}` };
    case 'web_search':
      return first.tool === 'web_search' ? { ok: true, why: '' } : { ok: false, why: `tool ${first.tool}` };
  }
  return { ok: false, why: `unknown expect ${e.tool}` };
}
