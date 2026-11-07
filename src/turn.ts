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

  const self = {
    /** Starts a turn when the caller's utterance arrives. */
    begin(): { timing: Timing; signal: AbortSignal } {
      ctl = new AbortController();
      timing = { start: Date.now() };
      return { timing, signal: ctl.signal };
    },
    /** Queue a sentence: TTS runs in order, each clip goes out as soon as it is rendered. */
    say(text: string) {
      const g = gen, t = timing;
      chain = chain.then(async () => {
        if (g !== gen) return;
        const { pcm, rate } = await speak(text);
        if (g !== gen) return;
        if (t?.start && t.firstAudioMs == null) t.firstAudioMs = Date.now() - t.start;
        play(pcm, rate);
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
    ackSoon(ms = Number(process.env.FILLER_MS ?? 0)) {
      if (ms < 0) return;
      const g = gen;
      setTimeout(() => { if (g === gen) self.filler('ack'); }, ms);
    },
    /** Caller started talking over us: stop the model and drop unplayed sentences. */
    cancel() { gen++; ctl?.abort(); },
    /** Waits for the queued audio of this turn, then records and logs its timings. */
    async end(label: string) {
      await chain;
      const t = timing;
      if (!t?.start) return;
      t.totalMs = Date.now() - t.start;
      console.log(`[turn ${label}] stt ${t.sttMs ?? '-'} ms · first token ${t.firstTokenMs ?? '-'} ms · first audio ${t.firstAudioMs ?? '-'} ms · total ${t.totalMs} ms`);
      save();
    },
  };
  return self;
}
