import { speak, wav } from '../src/tts.ts';
import { writeFileSync } from 'node:fs';
let t = Date.now(); await speak('warm up'); console.log('load', Date.now() - t);
t = Date.now();
const { pcm, rate } = await speak("Hi, this is Ringfence on NEAR. I can send NEAR or a money packet for you, or launch a coin on JustHoot. What do you need?");
console.log('gen ms', Date.now() - t, 'audio s', (pcm.length / rate).toFixed(1), rate);
writeFileSync('data/test.wav', wav(pcm, rate));
