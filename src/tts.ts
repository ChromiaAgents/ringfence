// Text-to-speech runs on this machine (Kokoro, open weights), so the reply text never leaves the box.
import { Worker } from 'node:worker_threads';
const voice = (process.env.TTS_VOICE ?? 'af_heart') as any;
const speed = Number(process.env.TTS_SPEED ?? 1.15);
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
  if (!clean || off) return { pcm: new Float32Array(0), rate: 24000 };
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
/** Loads Kokoro and renders the filler clips. Safe to call often; the work happens once. */
export const warmUp = () => (warm ??= (async () => {
  if (off) return;
  await load();
  for (const [k, texts] of Object.entries(FILLER_TEXT) as [FillerKind, string[]][])
    fillers.set(k, await Promise.all(texts.map((t) => speak(t))));
})());
