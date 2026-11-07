// NEAR AI Cloud: chat + speech-to-text on TEE models, and the proof that a reply came from one.
import { createHash, randomBytes } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { env } from './config.ts';

const BASE = 'https://cloud-api.near.ai/v1';
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export type Msg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

// ---- attestation (preflight): which key signs for this model inside a TEE ----

export type Attested = { model: string; signingAddress: string; nonce: string; quoteBindsKey: boolean; fetchedAt: number };
const attested = new Map<string, Attested>(); // per model

// TDX quote v4: 48-byte header + TD report; report_data is the last 64 bytes of the 584-byte TD report.
function quoteReportData(quoteHex: string) {
  const q = Buffer.from(quoteHex, 'hex');
  return q.subarray(48 + 520, 48 + 584).toString('hex');
}

export async function attest(model = env.llmModel): Promise<Attested> {
  const hit = attested.get(model);
  if (hit && Date.now() - hit.fetchedAt < 10 * 60_000) return hit;
  const nonce = randomBytes(32).toString('hex');
  const u = new URL(`${BASE}/attestation/report`);
  for (const [k, v] of Object.entries({ model, provider: 'near', include_tls_fingerprint: 'false', signing_algo: 'ecdsa', nonce }))
    u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: 'application/json', 'x-no-aliasing': 'true' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`attestation ${r.status}`);
  const d: any = await r.json();
  const reports = (d.model_attestations ?? []).filter((m: any) => m.signing_algo === 'ecdsa' && m.request_nonce === nonce);
  if (reports.length === 0) throw new Error('no NEAR model attestation for ' + model);
  const m = reports[0];
  // ponytail: checks the quote's report_data binds this key + our nonce; Intel's signature on the
  // quote itself is not checked here (use dcap-qvl or the NEAR Verification Center for that).
  const rd = quoteReportData(m.intel_quote);
  const addr = m.signing_address.toLowerCase().replace(/^0x/, '');
  const a: Attested = {
    model,
    signingAddress: m.signing_address.toLowerCase(),
    nonce,
    quoteBindsKey: rd.includes(addr) && rd.includes(nonce),
    fetchedAt: Date.now(),
  };
  attested.set(model, a);
  return a;
}

// ---- chat ----

export type Proof = { chatId: string; model: string; requestHash: string; responseHash: string; status: 'pending' | 'verified' | 'unverified'; signer?: string; kind?: string };

export type ChatOpts = { onText?: (delta: string) => void; signal?: AbortSignal; maxTokens?: number };

/**
 * Streamed chat (OpenAI-style SSE). Text deltas go to onText as they arrive; tool_call deltas are accumulated.
 * Proof: NEAR AI signs sha256 of the exact request body and sha256 of the exact (uncompressed) response body bytes,
 * stream framing and the final "data: [DONE]" included (docs.near.ai/cloud/verification/cloud-api/response-signatures).
 * So we hash every raw byte we read, before any SSE parsing.
 */
export async function chat(messages: Msg[], tools: unknown[], model = env.llmModel, o: ChatOpts = {}): Promise<{ msg: Extract<Msg, { role: 'assistant' }>; proof: Proof }> {
  if (env.mockLlm) return mockChat(messages, o);
  const pre = await attest(model).catch(() => null);
  const body = JSON.stringify({
    model, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.3, max_tokens: o.maxTokens ?? 400,
    stream: true, chat_template_kwargs: { enable_thinking: false }, // Qwen3: no reasoning pass on a phone call
  });
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.nearAiKey}`,
      'content-type': 'application/json',
      'x-no-aliasing': 'true',
      'accept-encoding': 'identity',
      accept: 'text/event-stream',
    },
    body,
    signal: o.signal,
  });
  if (!r.ok || !r.body) throw new Error(`chat ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const hash = createHash('sha256');
  const dec = new TextDecoder();
  let pending = '', id = '', content = '';
  const calls: ToolCall[] = [];
  const onEvent = (data: string) => {
    if (data === '[DONE]') return;
    let d: any;
    try { d = JSON.parse(data); } catch { return; }
    id ||= d.id ?? '';
    const delta = d.choices?.[0]?.delta ?? {};
    if (delta.content) { content += delta.content; o.onText?.(delta.content); }
    for (const tc of delta.tool_calls ?? []) {
      const c = (calls[tc.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.function.name += tc.function.name;
      if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
    }
  };
  for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    pending += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (line.startsWith('data:')) onEvent(line.slice(5).trim());
    }
  }
  if (pending.trim().startsWith('data:')) onEvent(pending.trim().slice(5).trim());
  const proof: Proof = { chatId: id, model, requestHash: sha256(body), responseHash: hash.digest('hex'), status: 'pending' };
  // The signature is recorded a moment after the reply; check it in the background.
  verifyLater(proof, pre).catch(() => (proof.status = 'unverified'));
  const tool_calls = calls.filter(Boolean);
  return { msg: { role: 'assistant', content: content || null, ...(tool_calls.length ? { tool_calls } : {}) }, proof };
}

// ---- mock mode (MOCK_LLM=1): no key needed; streams a scripted reply token by token with model-like timing ----

const MOCK_REPLIES = [
  'Sure, I can help with that. What is the coin about, in a few words?',
  'Love it. What would you like to call it, and what ticker should it have?',
  'Got it. How long should the auction run, and what soft cap in NEAR?',
];
let mockTurn = 0;
async function mockChat(messages: Msg[], o: ChatOpts): Promise<{ msg: Extract<Msg, { role: 'assistant' }>; proof: Proof }> {
  const wait = (ms: number) => new Promise<void>((ok, bad) => {
    const t = setTimeout(ok, ms);
    o.signal?.addEventListener('abort', () => { clearTimeout(t); bad(new Error('aborted')); }, { once: true });
  });
  const text = MOCK_REPLIES[mockTurn++ % MOCK_REPLIES.length];
  await wait(Number(process.env.MOCK_TTFT_MS ?? 450)); // time to first token seen on hosted 30B-class models
  for (const tok of text.match(/\S+\s*/g) ?? []) { o.onText?.(tok); await wait(Number(process.env.MOCK_TOKEN_MS ?? 25)); }
  void messages;
  return { msg: { role: 'assistant', content: text }, proof: { chatId: 'mock', model: 'mock', requestHash: '', responseHash: '', status: 'unverified', kind: 'mock' } };
}

async function verifyLater(p: Proof, pre: Attested | null) {
  for (let i = 0; i < 6; i++) {
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    const r = await fetch(`${BASE}/signature/${encodeURIComponent(p.chatId)}?signing_algo=ecdsa`, {
      headers: { accept: 'application/json', authorization: `Bearer ${env.nearAiKey}` },
    });
    if (r.status === 404) continue;
    const s: any = await r.json();
    if (!s.signature) continue;
    const expected = s.signature_kind === 'provider_tee' ? `${p.model}:${p.requestHash}:${p.responseHash}` : `${p.requestHash}:${p.responseHash}`;
    const signer = verifyMessage(s.text, s.signature).toLowerCase();
    p.signer = signer;
    p.kind = s.signature_kind;
    p.status =
      s.text === expected && signer === String(s.signing_address).toLowerCase() &&
      (s.signature_kind !== 'provider_tee' || (pre?.quoteBindsKey && pre.signingAddress === signer))
        ? 'verified'
        : 'unverified';
    return;
  }
  p.status = 'unverified';
}

// ---- speech-to-text (Whisper in a NEAR TEE) ----

export async function transcribe(audio: Uint8Array, mime = 'audio/wav'): Promise<string> {
  if (env.mockLlm) { await new Promise((ok) => setTimeout(ok, Number(process.env.MOCK_STT_MS ?? 350))); return 'I want to launch a memecoin about sleepy otters.'; }
  const fd = new FormData();
  fd.set('model', env.sttModel);
  fd.set('language', 'en'); // short words like 'bye' were coming back as Korean
  fd.set('prompt', 'A phone call about launching a memecoin on NEAR or meme.cooking, a ticker, a coin name, or building work.'); // vocabulary hint
  fd.set('file', new Blob([audio as BlobPart], { type: mime }), mime.includes('webm') ? 'a.webm' : 'a.wav');
  const r = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${env.nearAiKey}` }, body: fd });
  if (!r.ok) throw new Error(`stt ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as any).text?.trim() ?? '';
}
