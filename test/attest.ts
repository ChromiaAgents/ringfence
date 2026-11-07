import { attest } from '../src/ai.ts';
console.log(await attest());
console.log(await attest('openai/whisper-large-v3').catch((e) => e.message));
