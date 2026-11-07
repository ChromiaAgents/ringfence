// Browser call over /ws/call: mic -> one 16 kHz WAV per utterance (simple energy VAD), server -> text + WAV.
// Same protocol as before; also takes typed lines when there is no mic.
import { useEffect, useRef, useState } from 'react';

export type Line = { who: 'agent' | 'caller' | 'tool'; text: string };

function wav16(f32: Float32Array) {
  const b = new DataView(new ArrayBuffer(44 + f32.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, f32.length * 2, true);
  f32.forEach((x, i) => b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
  return b.buffer;
}

export function useCall() {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState('Not connected');
  const [live, setLive] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const r = useRef<{ ws?: WebSocket; ctx?: AudioContext; stream?: MediaStream; playing: boolean }>({ playing: false });
  const add = (who: Line['who'], text: string) => setLines((l) => [...l, { who, text }]);

  function stop() {
    const s = r.current;
    try { s.ws?.close(); } catch {}
    s.stream?.getTracks().forEach((t) => t.stop());
    s.ctx?.close().catch(() => {});
    r.current = { playing: false };
    setLive(false);
    setState('Call ended');
  }

  async function start() {
    setLines([]); setLink(null); setLive(true); setState('Connecting…');
    const s = r.current;
    s.ctx = new AudioContext({ sampleRate: 16000 });
    // Mic is optional: without it (or if refused) the call continues with typed lines.
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const src = s.ctx.createMediaStreamSource(s.stream);
      const proc = s.ctx.createScriptProcessor(1024, 1, 1); // ~64 ms frames
      src.connect(proc); proc.connect(s.ctx.destination);
      let frames: Float32Array[] = [], voiced = 0, silent = 0, floor = 0.01;
      proc.onaudioprocess = (e) => {
        if (s.playing || s.ws?.readyState !== 1) return;
        const f = new Float32Array(e.inputBuffer.getChannelData(0));
        const rms = Math.sqrt(f.reduce((a, x) => a + x * x, 0) / f.length);
        const loud = rms > Math.max(0.015, floor * 3);
        if (!loud) floor = floor * 0.97 + rms * 0.03;
        if (loud) { voiced++; silent = 0; frames.push(f); setState('Listening…'); }
        else if (voiced) { silent++; frames.push(f); }
        if (voiced && silent > 11) { // ~700 ms pause = end of sentence
          const all = new Float32Array(frames.reduce((n, x) => n + x.length, 0)); let i = 0;
          for (const x of frames) { all.set(x, i); i += x.length; }
          const ok = voiced > 4; frames = []; voiced = 0; silent = 0;
          if (ok) { s.ws.send(wav16(all)); setState('Thinking…'); }
        }
      };
    } catch (e: any) {
      add('tool', `No microphone (${e.message}). Type your side of the call below.`);
    }
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/call');
    s.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => setState('Ringing…');
    ws.onmessage = async (m) => {
      if (typeof m.data !== 'string') {
        if (!s.ctx) return;
        s.playing = true; setState('Speaking');
        const buf = await s.ctx.decodeAudioData((m.data as ArrayBuffer).slice(0));
        const src = s.ctx.createBufferSource(); src.buffer = buf; src.connect(s.ctx.destination);
        src.onended = () => { s.playing = false; setState('Your turn'); };
        src.start();
        return;
      }
      const d = JSON.parse(m.data);
      if (d.type === 'agent') add('agent', d.text);
      if (d.type === 'caller') add('caller', d.text);
      if (d.type === 'error') { add('tool', d.text); setState('Your turn'); }
      if (d.type === 'link') setLink(d.url);
    };
    ws.onclose = () => stop();
  }

  function say(text: string) {
    const ws = r.current.ws;
    if (!text.trim() || ws?.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'text', text: text.trim() }));
    setState('Thinking…');
    return true;
  }

  // On unmount only release the mic and socket (no state updates).
  useEffect(() => () => { const s = r.current; s.ws?.close(); s.stream?.getTracks().forEach((t) => t.stop()); s.ctx?.close().catch(() => {}); }, []);
  return { lines, state, live, link, start: () => start().catch((e) => { add('tool', e.message); stop(); }), stop, say };
}
