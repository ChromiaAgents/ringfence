// Text-to-speech. Two providers (TTS_PROVIDER, default cartesia when CARTESIA_API_KEY is set, else kokoro):
// - cartesia: Cartesia Sonic over HTTPS. Fast and natural, but the reply TEXT goes to Cartesia (a third party, not a TEE).
// - kokoro: open weights in a worker thread on this machine, so the reply text never leaves the box (~90 MB model).
// With cartesia, Kokoro is never loaded unless TTS_FALLBACK=kokoro.
import { Worker } from 'node:worker_threads';
export type TtsProvider = 'cartesia' | 'kokoro';
export const providerFor = (e: Record<string, string | undefined>): TtsProvider =>
  e.TTS_PROVIDER === 'kokoro' || e.TTS_PROVIDER === 'cartesia' ? e.TTS_PROVIDER : e.CARTESIA_API_KEY ? 'cartesia' : 'kokoro';
export const provider = providerFor(process.env);
const kokoroEnabled = provider === 'kokoro' || process.env.TTS_FALLBACK === 'kokoro';
const voice = (process.env.TTS_VOICE ?? 'af_heart') as any;
const speed = Number(process.env.TTS_SPEED ?? (provider === 'kokoro' ? 1.15 : 1));
const RATE = 24000;

// Cartesia: /tts/bytes per sentence (we already split by sentence), raw float32 PCM at 24 kHz mono, like Kokoro.
// Voice default: "Jacqueline" (warm, en-US), from Cartesia's recommended voice-agent voices.
const CARTESIA = {
  url: process.env.CARTESIA_URL ?? 'https://api.cartesia.ai/tts/bytes',
  version: process.env.CARTESIA_VERSION ?? '2026-08-14',
  model: process.env.CARTESIA_MODEL ?? 'sonic-3.6',
  voice: process.env.CARTESIA_VOICE_ID ?? '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
  timeoutMs: Number(process.env.CARTESIA_TIMEOUT_MS ?? 5000),
};
// ponytail: one Cartesia request at a time (the free plan's concurrency limit is tiny), retry 429 twice.
// Sentences are spoken in order anyway; raise the plan and drop this queue if several calls run at once.
let cartesiaChain: Promise<unknown> = Promise.resolve();
export function cartesiaSpeak(text: string, key = process.env.CARTESIA_API_KEY ?? ''): Promise<Float32Array> {
  const run = async () => {
    for (let i = 0; ; i++) {
      try { return await cartesiaOnce(text, key); } catch (e) {
        if (i >= 2 || !/cartesia 429/.test((e as Error).message)) throw e;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  };
  const p = cartesiaChain.then(run, run);
  cartesiaChain = p.catch(() => {});
  return p;
}
async function cartesiaOnce(text: string, key: string): Promise<Float32Array> {
  if (!key) throw new Error('CARTESIA_API_KEY is not set');
  const r = await fetch(CARTESIA.url, {
    method: 'POST',
    signal: AbortSignal.timeout(CARTESIA.timeoutMs),
    headers: { Authorization: `Bearer ${key}`, 'Cartesia-Version': CARTESIA.version, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_id: CARTESIA.model, transcript: text, voice: { id: CARTESIA.voice }, language: 'en',
      output_format: { container: 'raw', encoding: 'pcm_f32le', sample_rate: RATE },
      generation_config: { speed: Math.min(1.5, Math.max(0.6, speed)) },
    }),
  });
  if (!r.ok) throw new Error(`cartesia ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const buf = await r.arrayBuffer();
  return new Float32Array(buf.slice(0, buf.byteLength - (buf.byteLength % 4)));
}
// Never voice emoji, markdown or symbols the model slips in.
export const speakable = (t: string) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/[*_#~\`|<>]/g, '').replace(/\s+/g, ' ').trim();

// Kokoro lives in a worker thread (see tts-worker.ts) so rendering never blocks call audio.
let worker: Promise<Worker> | null = null;
let seq = 0;
const waiting = new Map<number, (m: any) => void>();
function load() {
  return (worker ??= new Promise((ok, fail) => {
    const w = new Worker(new URL('./tts-worker.ts', import.meta.url), { workerData: { voice, speed }, execArgv: ['--import', 'tsx'] });
    w.on('message', (m) => { if (m.ready) return ok(w); waiting.get(m.id)?.(m); waiting.delete(m.id); });
    w.on('error', fail);
  }));
}

// Returns mono float32 PCM at 24 kHz.
// TTS=off: text only (no Kokoro download); used by `npm run demo:check`.
const off = process.env.TTS === 'off';
export async function speak(text: string): Promise<{ pcm: Float32Array; rate: number }> {
  const clean = speakable(text);
  if (!clean || off) return { pcm: new Float32Array(0), rate: RATE };
  if (provider === 'cartesia') {
    try { return { pcm: trim(await cartesiaSpeak(clean), RATE), rate: RATE }; } catch (e) {
      if (!kokoroEnabled) throw e;
      console.error('cartesia failed, falling back to kokoro:', (e as Error).message);
    }
  }
  return kokoro(clean);
}

async function kokoro(clean: string) {
  const w = await load();
  const id = ++seq;
  const m: any = await new Promise((ok) => { waiting.set(id, ok); w.postMessage({ id, text: clean }); });
  if (m.error) throw new Error(m.error);
  return { pcm: trim(m.pcm, m.rate), rate: m.rate };
}

// Kokoro pads clips with silence; on a call that reads as lag, so keep only ~60 ms either side of the speech.
function trim(x: Float32Array, rate: number) {
  let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]) < 0.01) a++;
  while (b > a && Math.abs(x[b]) < 0.01) b--;
  const pad = Math.round(rate * 0.06);
  return x.subarray(Math.max(0, a - pad), Math.min(x.length, b + pad));
}

export function wav(pcm: Float32Array, rate: number): Uint8Array {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  return b;
}

// Short clips said while the caller waits: rendered once at startup so they play instantly.
const FILLER_TEXT = { ack: ['Mm, okay.', 'Right.', 'Okay.'], draw: ['Let me draw that.'], photo: ['One sec, let me look.'], wait: ['One sec.'] };
export type FillerKind = keyof typeof FILLER_TEXT;
const fillers = new Map<FillerKind, { pcm: Float32Array; rate: number }[]>();
export function filler(kind: FillerKind) {
  const xs = fillers.get(kind);
  return xs?.length ? xs[Math.floor(Math.random() * xs.length)] : null;
}

let warm: Promise<void> | null = null;
/** Loads the voice (Kokoro only if it is the provider) and renders the filler clips. Safe to call often; runs once. */
export const warmUp = () => (warm ??= (async () => {
  if (off) return;
  if (provider === 'kokoro') await load();
  for (const [k, texts] of Object.entries(FILLER_TEXT) as [FillerKind, string[]][])
    fillers.set(k, await Promise.all(texts.map((t) => speak(t))));
})());
