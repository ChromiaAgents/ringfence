// Speech eval for crypto / NEAR terms through the production transcribe().
// Usage: npm run asr:eval -- --label before
// Audio is synthesized with macOS `say`, cached under the eval dir, so reruns only cost STT calls.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcribe } from '../src/ai.ts';

type Phrase = { id: string; lang: 'en' | 'zh'; text: string; say?: string; terms: string[] };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const label = arg('--label') ?? 'run';
const DIR = process.env.ASR_EVAL_DIR ?? '/private/tmp/claude-501/-Users-liho-Desktop-chromia/fa8b011f-eee8-4fdc-901f-4ba6b705dbc6/scratchpad/asr-eval';
const AUDIO = join(DIR, 'audio');
mkdirSync(AUDIO, { recursive: true });

const VOICES = {
  en: ['Samantha', 'Daniel', 'Rishi', 'Karen', 'Tessa'], // US, GB, IN, AU, ZA
  zh: ['Tingting', 'Eddy (Chinese (China mainland))', 'Flo (Chinese (China mainland))'],
};

const phrases: Phrase[] = JSON.parse(readFileSync(new URL('./asr-phrases.json', import.meta.url), 'utf8'));

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

type Row = { id: string; voice: string; lang: string; expected: string; spoken: string; transcript: string; error?: string; terms: { term: string; ok: boolean }[]; exact: boolean };
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
    rows[i] = { id: p.id, voice, lang: p.lang, expected: p.text, spoken: p.say ?? p.text, transcript, error, terms, exact: !error && norm(transcript) === norm(p.text) };
    if (++done % 25 === 0) process.stderr.write(`${done}/${jobs.length}\n`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

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
const out = join(DIR, `results-${label}.json`);
writeFileSync(out, JSON.stringify({ label, at: new Date().toISOString(), voices: VOICES, termAccuracy: n / N, phraseAccuracy: ex / rows.length, errors, worst: worst.map(([term, s]) => ({ term, ...s })), rows }, null, 1));
console.log(`\nresults: ${out}${errors ? ` (${errors} errors)` : ''}`);
console.log(`term accuracy ${pct(n, N)}% (${n}/${N}), phrases ${pct(ex, rows.length)}%`);
