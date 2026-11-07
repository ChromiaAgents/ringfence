// Kokoro runs here, off the main thread: rendering a sentence takes ~1 s of CPU, and on the main
// thread that stalls the 20 ms call-audio pacer, which is what made the line sound choppy.
import { parentPort, workerData } from 'node:worker_threads';
import { KokoroTTS } from 'kokoro-js';

const tts = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
const { voice, speed } = workerData as { voice: any; speed: number };

parentPort!.on('message', async ({ id, text }: { id: number; text: string }) => {
  try {
    const a = await (await tts).generate(text, { voice, speed });
    const pcm = a.audio as Float32Array;
    parentPort!.postMessage({ id, pcm, rate: a.sampling_rate }, [pcm.buffer as ArrayBuffer]);
  } catch (e: any) {
    parentPort!.postMessage({ id, error: String(e?.message ?? e) });
  }
});
parentPort!.postMessage({ ready: true });
