// Times one spoken turn end to end with MOCK_LLM=1 (scripted streamed chat + STT) and the real TTS provider (cartesia or kokoro).
//   MOCK_LLM=1 DB_FILE=/tmp/x.json tsx test/latency.ts
import { startCall, reply } from '../src/agent.ts';
import { warmUp, provider } from '../src/tts.ts';
import { voiceLine } from '../src/turn.ts';
import { transcribe } from '../src/ai.ts';
import { env } from '../src/config.ts';

if (!env.mockLlm) throw new Error('set MOCK_LLM=1');
let t = Date.now(); await warmUp(); console.log(`tts provider: ${provider}`); console.log(`warm-up (${provider === 'kokoro' ? 'kokoro + ' : ''}fillers)`, Date.now() - t, 'ms');
const { call } = startCall('web', undefined, 'launch');
let firstClip: number | undefined; const clips: string[] = [];
let t0 = 0;
const line = voiceLine((pcm, rate) => { clips.push(`+${Date.now() - t0}ms:${(pcm.length / rate).toFixed(1)}s`); });
for (let i = 0; i < 3; i++) {
  const { signal, timing } = line.begin(); t0 = timing.start!; clips.push("|");
  const text = await transcribe(new Uint8Array());
  timing.sttMs = Date.now() - timing.start!;
  line.ackSoon();
  await reply(call.id, text, { signal, timing, onSentence: (s) => line.say(s) });
  await line.end(`mock ${i + 1}`);
  firstClip ??= timing.firstAudioMs;
}
console.log('clips sent', clips.join(' '));
console.log(`provider ${provider} · first audio ${firstClip ?? '-'} ms`);
process.exit(0);
