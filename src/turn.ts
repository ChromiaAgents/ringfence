// One spoken turn on a live call, shared by the browser and WhatsApp channels: sentences are voiced one by one
// as the model streams them, fillers cover slow moments, and barge-in cancels whatever has not been played yet.
import { speak, filler, type FillerKind } from './tts.ts';
import { save, type Timing } from './store.ts';

export type Play = (pcm: Float32Array, rate: number) => void;

export function voiceLine(play: Play) {
  let gen = 0; // bumped on barge-in: queued work from an older turn is dropped
  let chain: Promise<void> = Promise.resolve();
  let ctl: AbortController | null = null;
  let timing: Timing | null = null;
  let lastSound = 0, nudges = 0, ticker: ReturnType<typeof setInterval> | undefined;
  const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_MS ?? 9000);
  const NUDGES = ['One moment.', 'Still working on it.', 'Almost done.'];
  let lastNudgeAt = 0, nudgeNo = 0;
  let turnNo = 0, lastAckTurn = -9;

  const self = {
    /** Starts a turn when the caller's utterance arrives. */
    begin(): { timing: Timing; signal: AbortSignal } {
      ctl = new AbortController();
      timing = { start: Date.now() };
      turnNo++;
      // Keep-alive: if the turn is still working and nothing has been heard for a while, say so once.
      lastSound = Date.now(); nudges = 0; clearInterval(ticker);
      const g0 = gen;
      ticker = setInterval(() => {
        if (g0 !== gen || !timing || timing.totalMs != null) return clearInterval(ticker);
        // Once per turn at most, and not again within 30s across turns: repeated filler sounds broken.
        if (nudges < 1 && Date.now() - lastSound > KEEP_ALIVE_MS && Date.now() - lastNudgeAt > 30_000) { nudges++; lastSound = lastNudgeAt = Date.now(); self.say(NUDGES[nudgeNo++ % NUDGES.length]); }
      }, 500);
      return { timing, signal: ctl.signal };
    },
    /** Queue a sentence: TTS runs in order, each clip goes out as soon as it is rendered. */
    say(text: string) {
      text = text.replace(/\s*\bcall ended\.?\s*$/i, '').trim(); // a stage direction, not speech
      if (!text) return chain;
      const g = gen, t = timing;
      chain = chain.then(async () => {
        if (g !== gen) return;
        const { pcm, rate } = await speak(text);
        if (g !== gen) return;
        if (t?.start && t.firstAudioMs == null) t.firstAudioMs = Date.now() - t.start;
        play(pcm, rate);
        lastSound = Date.now() + (pcm.length / rate) * 1000; // silence is counted from the end of this clip
      }).catch((e) => console.error('tts', e));
      return chain;
    },
    /** A pre-rendered clip, unless real speech already went out for this turn. */
    filler(kind: FillerKind) {
      const c = filler(kind), t = timing;
      if (c && !(t && t.firstAudioMs != null)) play(c.pcm, c.rate);
    },
    /** "Mm, okay" as soon as we know what was said, unless real speech is already out (FILLER_MS delays it; -1 turns it off).
     *  Kokoro blocks the event loop while it renders, so a delayed filler tends to land after the first sentence anyway. */
    ackSoon(ms = Number(process.env.FILLER_MS ?? 1500)) {
      // Only when the answer is slow, and never two turns in a row: a person does not say "okay" before every reply.
      if (ms < 0) return;
      const g = gen, t = timing, n = turnNo;
      setTimeout(() => {
        if (g !== gen || !t || t.firstAudioMs != null || t.totalMs != null || lastAckTurn >= n - 1) return;
        lastAckTurn = n; self.filler('ack');
      }, ms);
    },
    /** A short line now, because a slow tool started and nothing has been said yet this turn. */
    toolStart(text: string) { if (!(timing && timing.firstAudioMs != null)) self.say(text); else lastSound = Date.now(); },
    /** Caller started talking over us: stop the model and drop unplayed sentences. */
    cancel() { gen++; ctl?.abort(); clearInterval(ticker); },
    /** Waits for the queued audio of this turn, then records and logs its timings. */
    async end(label: string) {
      await chain;
      clearInterval(ticker);
      const t = timing;
      if (!t?.start) return;
      t.totalMs = Date.now() - t.start;
      console.log(`[turn ${label}] stt ${t.sttMs ?? '-'} ms · first token ${t.firstTokenMs ?? '-'} ms · first audio ${t.firstAudioMs ?? '-'} ms · total ${t.totalMs} ms`);
      save();
    },
  };
  return self;
}
