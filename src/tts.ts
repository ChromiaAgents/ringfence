// Text-to-speech runs on this machine (Kokoro, open weights), so the reply text never leaves the box.
import { KokoroTTS } from 'kokoro-js';

let tts: Promise<KokoroTTS> | null = null;
const voice = (process.env.TTS_VOICE ?? 'bm_george') as any;

function load() {
  tts ??= KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  return tts;
}

// Returns mono float32 PCM at 24 kHz.
export async function speak(text: string): Promise<{ pcm: Float32Array; rate: number }> {
  const audio = await (await load()).generate(text, { voice });
  return { pcm: audio.audio as Float32Array, rate: audio.sampling_rate };
}

export function wav(pcm: Float32Array, rate: number): Uint8Array {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  return b;
}

export const warmUp = () => load().then(() => undefined);
