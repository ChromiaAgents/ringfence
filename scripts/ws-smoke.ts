// Smoke test for the browser call socket: expects the greeting as text, then as a WAV.
// Usage: tsx scripts/ws-smoke.ts [ws://localhost:8787/ws/call]
import WebSocket from 'ws';
const ws = new WebSocket(process.argv[2] ?? 'ws://localhost:8787/ws/call');
const t = Date.now();
const fail = setTimeout(() => { console.error('timeout'); process.exit(1); }, 60_000);
ws.on('message', (d, bin) => {
  if (!bin) return console.log(`${Date.now() - t}ms text`, String(d));
  const b = d as Buffer;
  console.log(`${Date.now() - t}ms audio`, b.subarray(0, 4).toString(), `${b.length} bytes`);
  clearTimeout(fail); ws.close();
});
