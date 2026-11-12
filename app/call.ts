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

export type Desk = 'launch';

export function useCall(deskPick: Desk | 'auto' = 'auto', packet?: string, payTo?: string) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState('Not connected');
  const [live, setLive] = useState(false);
  const [link, setLink] = useState<{ url: string; label: string } | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [desk, setDesk] = useState<Desk | 'wallet' | 'agent' | null>(null);
  // The website demo wallet's Approve card (WhatsApp buttons, shown on the page instead).
  const [approval, setApproval] = useState<{ body: string; token: string } | null>(null);
  const r = useRef<{ ws?: WebSocket; ctx?: AudioContext; stream?: MediaStream; playing: boolean; srcs?: AudioBufferSourceNode[]; next?: number; decode?: Promise<AudioBuffer | null> }>({ playing: false });
  const add = (who: Line['who'], text: string) => setLines((l) => [...l, { who, text }]);

  // Stop everything queued to play (barge-in).
  function hush() {
    const s = r.current;
    for (const x of s.srcs ?? []) { x.onended = null; try { x.stop(); } catch {} }
    s.srcs = []; s.next = 0; s.playing = false;
    setState('Listening…');
  }

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
    setLines([]); setLink(null); setChoices([]); setDesk(deskPick === 'auto' ? null : deskPick); setLive(true); setState('Connecting…');
    const s = r.current;
    s.ctx = new AudioContext({ sampleRate: 16000 });
    // Mic is optional: without it (or if refused) the call continues with typed lines.
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const src = s.ctx.createMediaStreamSource(s.stream);
      const proc = s.ctx.createScriptProcessor(1024, 1, 1); // ~64 ms frames
      src.connect(proc); proc.connect(s.ctx.destination);
      let frames: Float32Array[] = [], voiced = 0, silent = 0, floor = 0.01, loudRun = 0;
      proc.onaudioprocess = (e) => {
        if (s.ws?.readyState !== 1) return;
        const f = new Float32Array(e.inputBuffer.getChannelData(0));
        const rms = Math.sqrt(f.reduce((a, x) => a + x * x, 0) / f.length);
        if (s.playing) {
          // Barge-in: ~500 ms of clearly loud speech while the agent talks. Phone speakers leak our own voice past echo cancellation, so a short or soft burst must not cut the agent off.
          loudRun = rms > Math.max(0.12, floor * 10) ? loudRun + 1 : 0;
          if (loudRun < 8) return;
          loudRun = 0;
          hush();
          s.ws.send(JSON.stringify({ type: 'barge' }));
        }
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
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/call' + (packet ? `?packet=${encodeURIComponent(packet)}${payTo ? `&to=${encodeURIComponent(payTo)}` : ''}` : deskPick === 'auto' ? '' : `?desk=${deskPick}`));
    s.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => setState('Ringing…');
    let hangAfterTurn = false;
    ws.onmessage = async (m) => {
      if (typeof m.data !== 'string') {
        if (!s.ctx) return;
        // Clips (one per sentence) arrive while earlier ones play: schedule them back to back.
        // Decode in arrival order: a short clip must not jump ahead of a longer one still decoding.
        const decoded = (s.decode ?? Promise.resolve()).then(() => s.ctx!.decodeAudioData((m.data as ArrayBuffer).slice(0))).catch(() => null);
        s.decode = decoded;
        const buf = await decoded;
        if (!buf || !s.ctx) return; // empty/undecodable clip (TTS off or failed), or call ended
        const src = s.ctx.createBufferSource(); src.buffer = buf; src.connect(s.ctx.destination);
        const at = Math.max(s.ctx.currentTime + 0.02, s.next ?? 0);
        s.next = at + buf.duration;
        (s.srcs ??= []).push(src);
        s.playing = true; setState('Speaking');
        src.onended = () => {
          s.srcs = (s.srcs ?? []).filter((x) => x !== src);
          if (!s.srcs.length) { s.playing = false; setState('Your turn'); }
        };
        src.start(at);
        return;
      }
      const d = JSON.parse(m.data);
      if (d.type === 'agent' && !s.playing) setState('Your turn'); // text-only reply (no audio) must not leave "Thinking…"
      if (d.type === 'agent') // sentences of one reply stream in: keep them in one bubble
        setLines((l) => (l.at(-1)?.who === 'agent' ? [...l.slice(0, -1), { who: 'agent', text: l.at(-1)!.text + ' ' + d.text }] : [...l, { who: 'agent', text: d.text }]));
      if (d.type === 'caller') add('caller', d.text);
      if (d.type === 'error') { add('tool', d.text); setState('Your turn'); }
      if (d.type === 'approval') setApproval({ body: d.body, token: d.token });
      if (d.type === 'link') setLink({ url: d.url, label: d.label });
      if (d.type === 'choices') setChoices(Array.isArray(d.options) ? d.options.map(String) : []);
      if (d.type === 'caller') setChoices([]);
      if (d.type === 'desk' && d.desk) setDesk(d.desk);
      // The AI ended the call: wait for the end of the turn (all goodbye audio sent), let it finish playing, then hang up.
      if (d.type === 'hangup') hangAfterTurn = true;
      if (d.type === 'desk' && hangAfterTurn) { const bye = () => (s.playing ? setTimeout(bye, 200) : stop()); setTimeout(bye, 600); }
    };
    ws.onclose = () => stop();
  }

  function tap(verb: 'approve' | 'cancel' | 'reject') {
    const ws = r.current.ws;
    if (!approval || ws?.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'button', id: `${verb}:${approval.token}` }));
    setApproval(null);
  }

  function say(text: string) {
    const ws = r.current.ws;
    if (!text.trim() || ws?.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'text', text: text.trim() }));
    setState('Thinking…');
    return true;
  }

  // A photo, downscaled in the browser before it is sent (the agent says it can't use photos; nothing is stored).
  async function sendPhoto(file: File) {
    const ws = r.current.ws;
    if (ws?.readyState !== 1) return false;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    ws.send(JSON.stringify({ type: 'photo', dataUrl: c.toDataURL('image/jpeg', 0.85) }));
    setState('Looking at your photo…');
    return true;
  }

  // On unmount only release the mic and socket (no state updates).
  useEffect(() => () => { const s = r.current; s.ws?.close(); s.stream?.getTracks().forEach((t) => t.stop()); s.ctx?.close().catch(() => {}); }, []);
  return { lines, state, live, link, choices, desk, approval, tap, sendPhoto, start: () => start().catch((e) => { add('tool', e.message); stop(); }), stop, say };
}
