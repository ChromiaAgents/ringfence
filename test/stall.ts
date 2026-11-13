// The AI stream goes quiet: nothing said yet → asked again on the other key; something said → kept. Run: npx tsx test/stall.ts
process.env.NEARAI_API_KEY = 'p'; process.env.NEARAI_API_KEY_FALLBACK = 'f'; process.env.NEARAI_BASE_FALLBACK = 'https://fallback.test'; process.env.AI_STALL_MS = '300';
process.env.MOCK_LLM = '';
import assert from 'node:assert';
const sse = (parts: string[], hang: boolean, signal?: AbortSignal) => new ReadableStream({ async start(c) {
  signal?.addEventListener('abort', () => c.error(signal.reason), { once: true }); // as a real fetch body does
  for (const p of parts) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: 'x', choices: [{ delta: { content: p } }] })}\n\n`));
  if (!hang) { c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); }
} });
let mode = 'silent';
const hits: string[] = [];
globalThis.fetch = (async (u: any, init: any) => {
  const url = String(u);
  if (!url.includes('/chat/completions')) throw new Error('offline');
  hits.push(url.includes('fallback') ? 'fallback' : 'primary');
  const hang = !url.includes('fallback');
  const body = sse(hang && mode === 'silent' ? [] : hang ? ['Hello there. '] : ['From fallback.'], hang, init?.signal);
  return new Response(body, { status: 200 });
}) as any;
const { chat } = await import('../src/ai.ts');
const { resetAiKeys } = await import('../src/aikey.ts');
let r = await chat([{ role: 'user', content: 'hi' }], []);
assert.equal(r.msg.content, 'From fallback.'); assert.deepEqual(hits, ['primary', 'fallback']);
resetAiKeys(); hits.length = 0; mode = 'partial';
r = await chat([{ role: 'user', content: 'hi' }], []);
assert.equal(r.msg.content, 'Hello there. '); assert.deepEqual(hits, ['primary']);
console.log('ok stall watchdog'); process.exit(0);
