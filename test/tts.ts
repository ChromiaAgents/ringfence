import { speak, wav } from '../src/tts.ts';
import { writeFileSync } from 'node:fs';
let t = Date.now(); await speak('warm up'); console.log('load', Date.now() - t);
t = Date.now();
const { pcm, rate } = await speak("Hey, Ringfence here, on NEAR. I can send NEAR or dollars for you, make or open a money packet, launch a coin on JustHoot, or look up prices and news. What do you need?");
console.log('gen ms', Date.now() - t, 'audio s', (pcm.length / rate).toFixed(1), rate);
writeFileSync('data/test.wav', wav(pcm, rate));
