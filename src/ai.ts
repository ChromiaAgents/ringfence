// NEAR AI Cloud: chat + speech-to-text on TEE models, and the proof that a reply came from one.
import { createHash, randomBytes } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { env } from './config.ts';
import { correct } from './terms.ts';

const BASE = 'https://cloud-api.near.ai/v1';
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export type Msg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

// ---- attestation (preflight): which key signs for this model inside a TEE, and whether that TEE is genuine ----
//
// For each model we fetch NEAR AI's attestation report with a fresh nonce and check, in this process:
//  1. Intel TDX: the quote's ECDSA signature chain up to Intel's root, against collateral fetched from Intel PCS
//     (@phala/dcap-qvl, pure JS), and the TCB status Intel reports for that platform.
//  2. report_data inside the (now verified) quote binds the model's signing address and our nonce.
//  3. NVIDIA GPUs: the report's GPU evidence is sent to NVIDIA NRAS; we check the returned JWT's ES384 signature
//     against NVIDIA's JWKS, the overall result, each GPU's nonce match, and that the evidence carries our nonce.
// Not checked here: that the TDX measurements (MRTD, RTMRs) match a published NEAR AI build. See README.

export type IntelCheck = { verified: boolean; tcbStatus?: string; advisoryIds?: string[]; error?: string };
export type GpuCheck = { verified: boolean; gpus?: number; arch?: string; nonceMatch?: boolean; error?: string };
export type Attested = {
  model: string; signingAddress: string; nonce: string; fetchedAt: number;
  /** report_data binds signing address + our nonce (read from the verified quote when Intel's check passed). */
  quoteBindsKey: boolean;
  intel: IntelCheck;
  gpu: GpuCheck;
  reportDataHex: string;
};
const attested = new Map<string, Attested>(); // per model

// TDX quote v4: 48-byte header + TD report; report_data is the last 64 bytes of the 584-byte TD report.
function quoteReportData(quoteHex: string) {
  const q = Buffer.from(quoteHex, 'hex');
  return q.subarray(48 + 520, 48 + 584).toString('hex');
}

const INTEL_PCS = 'https://api.trustedservices.intel.com';
export async function verifyIntelQuote(quoteHex: string): Promise<IntelCheck & { reportDataHex?: string }> {
  try {
    const qvl = (await import('@phala/dcap-qvl')).default as typeof import('@phala/dcap-qvl');
    const quote = Buffer.from(quoteHex, 'hex');
    const collateral = await qvl.getCollateral(INTEL_PCS, quote);
    const r: any = qvl.verify(quote, collateral, Math.floor(Date.now() / 1000)); // throws on a bad signature or chain
    const rd = r.report?.data?.reportData;
    return { verified: true, tcbStatus: r.status, advisoryIds: r.advisory_ids ?? [], reportDataHex: rd ? Buffer.from(rd).toString('hex') : undefined };
  } catch (e: any) {
    return { verified: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

const NRAS = 'https://nras.attestation.nvidia.com';
const jwtPart = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());
async function verifyJwt(token: string, keys: any[]) {
  const [h, p, sig] = token.split('.');
  const head = jwtPart(h);
  const jwk = keys.find((k) => k.kid === head.kid);
  if (!jwk || head.alg !== 'ES384') throw new Error(`NRAS key ${head.kid} not in NVIDIA JWKS`);
  const { createPublicKey, verify } = await import('node:crypto');
  const ok = verify('sha384', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('NRAS token signature invalid');
  const claims = jwtPart(p);
  if (claims.iss !== NRAS) throw new Error('NRAS token issuer ' + claims.iss);
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new Error('NRAS token expired');
  return claims;
}

export async function verifyGpu(nvidiaPayload: string | undefined, nonce: string): Promise<GpuCheck> {
  if (!nvidiaPayload) return { verified: false, error: 'no GPU evidence in the report' };
  try {
    const ev = JSON.parse(nvidiaPayload);
    const nonceMatch = ev.nonce === nonce;
    const [res, jwks] = await Promise.all([
      fetch(`${NRAS}/v3/attest/gpu`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: nvidiaPayload, signal: AbortSignal.timeout(20_000) }),
      fetch(`${NRAS}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json() as any),
    ]);
    if (!res.ok) throw new Error(`NRAS ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const out: any = await res.json(); // [["JWT", platformToken], { "GPU-0": token, ... }]
    const overall = await verifyJwt(out[0][1], jwks.keys);
    const per = await Promise.all(Object.values(out[1] ?? {}).map((t) => verifyJwt(String(t), jwks.keys)));
    const gpusOk = per.length > 0 && per.every((c) => c['x-nvidia-gpu-attestation-report-nonce-match'] === true && c.measres === 'success');
    return { verified: overall['x-nvidia-overall-att-result'] === true && gpusOk && nonceMatch, gpus: per.length, arch: ev.arch, nonceMatch };
  } catch (e: any) {
    return { verified: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export async function attest(model = env.llmModel, fresh = false): Promise<Attested> {
  const hit = attested.get(model);
  if (!fresh && hit && Date.now() - hit.fetchedAt < 10 * 60_000) return hit;
  const nonce = randomBytes(32).toString('hex');
  const u = new URL(`${BASE}/attestation/report`);
  for (const [k, v] of Object.entries({ model, provider: 'near', include_tls_fingerprint: 'false', signing_algo: 'ecdsa', nonce }))
    u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: 'application/json', 'x-no-aliasing': 'true' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`attestation ${r.status}`);
  const d: any = await r.json();
  const reports = (d.model_attestations ?? []).filter((m: any) => m.signing_algo === 'ecdsa' && m.request_nonce === nonce);
  if (reports.length === 0) throw new Error('no NEAR model attestation for ' + model);
  const m = reports[0];
  const [intel, gpu] = await Promise.all([verifyIntelQuote(m.intel_quote), verifyGpu(m.nvidia_payload, nonce)]);
  const rd = intel.reportDataHex ?? quoteReportData(m.intel_quote);
  const addr = m.signing_address.toLowerCase().replace(/^0x/, '');
  // report_data = signing address (20 bytes, zero-padded to 32) || our nonce (32 bytes)
  const a: Attested = {
    model,
    signingAddress: m.signing_address.toLowerCase(),
    nonce,
    quoteBindsKey: rd.startsWith(addr) && rd.endsWith(nonce),
    intel: { verified: intel.verified, tcbStatus: intel.tcbStatus, advisoryIds: intel.advisoryIds, error: intel.error },
    gpu,
    reportDataHex: rd,
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
/** A pooled connection the far side already closed fails before any answer ("fetch failed"). Nothing was sent back
 *  yet, so the same request is safe to make once more. A caller hanging up (abort) is not retried. */
async function again(signal: AbortSignal | undefined, f: () => Promise<Response>): Promise<Response> {
  try { return await f(); } catch (e: any) {
    if (signal?.aborted || e?.name === 'AbortError') throw e;
    await new Promise((ok) => setTimeout(ok, 200));
    return f();
  }
}

export async function chat(messages: Msg[], tools: unknown[], model = env.llmModel, o: ChatOpts = {}): Promise<{ msg: Extract<Msg, { role: 'assistant' }>; proof: Proof }> {
  if (env.mockLlm) return mockChat(messages, tools, o);
  const pre = await attest(model).catch(() => null);
  const body = JSON.stringify({
    model, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: 0.3, max_tokens: o.maxTokens ?? 400,
    stream: true, chat_template_kwargs: { enable_thinking: false }, // Qwen3: no reasoning pass on a phone call
  });
  const r = await again(o.signal, () => fetch(`${BASE}/chat/completions`, {
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
  }));
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

// ---- mock mode (MOCK_LLM=1): no key needed. A tiny keyword script stands in for the model, including the tool
// calls a real model would make, so both desks can be walked end to end offline. The tools, rules, pages and
// ledger are the real ones; only the model's choices are scripted. Replies stream token by token with model-like timing.

const MOCK_REPLIES = [
  'Sure, I can help with that. What is the coin about, in a few words?',
  'Love it. What would you like to call it, and what ticker should it have?',
  'Got it. Any links to add, like an X account, Telegram or a website?',
];
let mockTurn = 0, mockSeq = 0;
const textOf = (m: Msg) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c: any) => c.text ?? '').join(' ') : '') ?? '';

/** The scripted "model": which tool to call for the caller's last line, or null for a plain reply. */
export function mockStep(messages: Msg[], tools: unknown[]): { name: string; args: unknown } | null {
  const names = new Set((tools as any[]).map((t) => t.function?.name));
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const u = last ? textOf(last) : '';
  if (names.has('end_call') && /\b(bye|goodbye|that's all|hang up)\b/i.test(u)) return { name: 'end_call', args: {} };
  if (names.has('set_coin')) {
    const c = u.match(/call it ([^,.]+?),?\s+ticker\s+\$?([A-Za-z0-9]+)/i);
    if (c) return { name: 'set_coin', args: { name: c[1].trim(), ticker: c[2], description: 'a meme coin made on a phone call' } };
    if (/\blogo\b|\bvibe\b/i.test(u)) return { name: 'make_logo', args: { vibe: u } };
    if (/^\s*(yes|yeah|yep|do it|go ahead|set it up)\b/i.test(u) && messages.some((m) => m.role === 'assistant' && /shall I set it up/i.test(textOf(m)))) return { name: 'prepare_launch', args: { caller_confirmed: true } };
  }
  // Money packets: fund one ("send a money packet of 0.02 NEAR for 5 people, the words are ..."), or open one. On a call
  // started from a packet's page the system prompt names the packet, so anything that isn't a PIN or a send is an attempt.
  if (names.has('prepare_packet') && /money packet|red packet|red envelope|hongbao|angpao|红包/i.test(u)) {
    const m = u.match(/([\d.]+)\s*near/i), n = u.match(/(\d+)\s*(?:people|persons?|kids|shares)/i), w = u.match(/words?\s+(?:are|is)\s+["“]?([^"”.!?]+)/i);
    if (m && /\b(send|make|give|create)\b/i.test(u)) return { name: 'prepare_packet', args: { amount: m[1], count: Number(n?.[1] ?? 5), split: /equal/i.test(u) ? 'equal' : 'lucky', words: (w?.[1] ?? '').trim() } };
  }
  if (names.has('open_packet')) {
    const sys = messages[0] ? textOf(messages[0]) : '';
    const id = u.match(/packet\s+([a-z0-9-]{6,})/i)?.[1] ?? sys.match(/page of packet ([a-z0-9-]+)/)?.[1];
    const acct = u.match(/([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:near|testnet))/i)?.[1];
    if (id && u !== '[PIN]' && !/\b(send|pay|transfer|balance|spen[dt])\b/i.test(u.replace(/send it to/i, ''))) return { name: 'open_packet', args: { packet_id: id, ...(acct ? { account: acct } : {}) } };
  }
  if (names.has('confirm_transfer')) {
    const send = u.match(/(?:send|pay|transfer)\s+([\d.]+)\s*([a-z]+)?\b(?:\s+on\s+([a-z0-9 ]+?))?\s+to\s+(\S+(?:\s+dot\s+\S+)*)/i);
    if (send) return { name: 'prepare_transfer', args: { to: send[4].replace(/[.,!?]$/, ''), amount: send[1], asset: send[3] ? send[3].trim().toLowerCase() : /^near$/i.test(send[2] ?? 'near') ? 'near' : (send[2] ?? '').toLowerCase() } };
    if (u === '[PIN]' || /^[\s\d,.-]+$|^(\s*(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b[\s,.]*)+$/i.test(u)) return { name: 'confirm_transfer', args: { pin: u } };
    if (names.has('cancel_transfer') && /^\s*(please\s+)?(cancel|stop)\b/i.test(u)) return { name: 'cancel_transfer', args: {} };
    if (/\bbalance\b/i.test(u)) return { name: 'get_balance', args: {} };
    if (/\bspen[dt]\b/i.test(u)) return { name: 'get_spending', args: {} };
  }
  return null;
}

function mockText(messages: Msg[], tools: unknown[] = []): string {
  const lastMsg = messages.at(-1);
  const names = new Set((tools as any[]).map((t) => t.function?.name));
  const said = messages.filter((m) => m.role === 'user').map(textOf).join(' ');
  const u = lastMsg?.role === 'user' ? textOf(lastMsg) : '';
  // One agent: a plain reply follows the conversation, as a model would.
  if (lastMsg?.role !== 'tool' && /\b(quote|kitchen|bathroom|roof|builder|booking)\b/i.test(u))
    return "Sorry, we don't do building quotes. I can send NEAR for you, or help you launch a coin.";
  // Coin talk: follow what the caller just said, not a global turn counter, so the coin's name and ticker are never skipped.
  if (lastMsg?.role !== 'tool' && names.has('set_coin') && /\b(coin|launch|meme\w*|ticker)\b/i.test(said))
    return /\babout\b/i.test(said) || messages.some((m) => m.role === 'assistant' && textOf(m) === MOCK_REPLIES[0]) ? MOCK_REPLIES[1] : MOCK_REPLIES[0];
  if (lastMsg?.role !== 'tool' && names.has('confirm_transfer')) return /\b(pay|send|transfer|near)\b/i.test(u) ? 'Who do you want to pay, and how much?' : 'I can pay someone for you, or help you launch a coin. Which one?';
  if (lastMsg?.role !== 'tool') return MOCK_REPLIES[mockTurn++ % MOCK_REPLIES.length];
  let out: any = {};
  try { out = JSON.parse(lastMsg.content); } catch {}
  const prev = messages.at(-2) as any;
  const tool = prev?.tool_calls?.[0]?.function?.name;
  if (tool === 'end_call') return 'Thanks for calling, take care. Bye!';
  if (tool === 'set_coin' && out.ok !== false && !out.error) return 'Got it. Shall I set it up? Say yes and I’ll put the launch on your screen to check and sign.';
  if (out.waiting) return `PIN accepted. It is a first payment to that account, so your wallet holds it for ${out.goes_out_in}, then it goes. Say cancel to stop it.`;
  if (out.cancelled) return `Stopped: ${out.cancelled.join('; ')}. Nothing left your wallet.`;
  if (out.need === 'words') return 'Say the words that came with the money packet to open it.';
  if (out.need === 'account') return 'Those are the words. Which NEAR account should I send your share to?';
  if (tool === 'open_packet' && out.ok) return `You opened ${out.near} NEAR${out.dryRun ? ' (a dry run: no real money moved)' : ''}. ${out.left ? `${out.left} left for the others.` : 'That was the last share.'}`;
  if (out.packet) return `Your money packet is ready${out.dryRun ? ' (a dry run: no real money is in it)' : ''}. Share the link on your screen, and tell them the words.`;
  if (out.ok === false && /^I still need/.test(out.reason ?? '')) return out.reason;
  if (out.ok === false || out.error) return `Sorry, I can't do that: ${out.reason ?? out.error}`;
  if (out.approvalDemo) return `That's ${out.read_back}. On a bound wallet that amount needs your PIN and then an Approve tap on WhatsApp. This browser demo stops here: nothing was sent.`;
  if (out.approvalSent) return `That's ${out.read_back}. I've sent an Approve button to your WhatsApp. Tap it within two minutes.`;
  if (out.last && out.spentToday) return `Today you've spent ${out.spentToday} of your ${out.dailyLimit} daily limit, ${out.leftToday} left. ${out.last.length ? `Last: ${out.last[0]}.` : 'No transfers yet.'}`;
  if (out.last) return `This is a dry run, so I can't read today's total from the chain. ${out.last.length ? `Your last ${out.last.length} transfers: ${out.last.join('; ')}.` : 'No transfers yet.'}`;
  if (out.read_back) return `That's ${out.read_back}. What's your four digit PIN?`;
  if (out.demo && out.txHash) return 'Four digits heard. This was a browser demo: no wallet is bound to a browser call, so nothing was sent. On WhatsApp, your bound wallet contract would check the limits and send.';
  if (out.demo && tool === 'get_spending') return 'This is a browser demo: no wallet is bound to a browser call, so there is no spending to show.';
  if (out.demo) return 'This is a browser demo: no wallet is bound to a browser call, so there is no balance to read.';
  if (out.dryRun && out.txHash) return 'PIN accepted. This was a dry run: the server has no agent key, so nothing was sent.';
  if (out.txHash) return 'Sent. The transaction link is on WhatsApp.';
  if (out.linkSent) return 'Done. Open the link on your screen, check the details, and sign with your own NEAR wallet.';
  return 'Got it. What next?';
}

async function mockChat(messages: Msg[], tools: unknown[], o: ChatOpts): Promise<{ msg: Extract<Msg, { role: 'assistant' }>; proof: Proof }> {
  const wait = (ms: number) => new Promise<void>((ok, bad) => {
    const t = setTimeout(ok, ms);
    o.signal?.addEventListener('abort', () => { clearTimeout(t); bad(new Error('aborted')); }, { once: true });
  });
  const proof: Proof = { chatId: 'mock', model: 'mock', requestHash: '', responseHash: '', status: 'unverified', kind: 'mock' };
  await wait(Number(process.env.MOCK_TTFT_MS ?? 450)); // time to first token seen on hosted 30B-class models
  const step = messages.at(-1)?.role === 'tool' ? null : mockStep(messages, tools);
  if (step) return { msg: { role: 'assistant', content: null, tool_calls: [{ id: `mock-${++mockSeq}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] }, proof };
  const text = mockText(messages, tools);
  for (const tok of text.match(/\S+\s*/g) ?? []) { o.onText?.(tok); await wait(Number(process.env.MOCK_TOKEN_MS ?? 25)); }
  return { msg: { role: 'assistant', content: text }, proof };
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
      (s.signature_kind !== 'provider_tee' || (pre?.quoteBindsKey && pre.intel.verified && pre.signingAddress === signer))
        ? 'verified'
        : 'unverified';
    return;
  }
  p.status = 'unverified';
}

// ---- speech-to-text (Whisper in a NEAR TEE) ----

export async function transcribe(audio: Uint8Array, mime = 'audio/wav'): Promise<string> {
  if (env.mockLlm) { await new Promise((ok) => setTimeout(ok, Number(process.env.MOCK_STT_MS ?? 350))); return 'I want to launch a memecoin about sleepy otters.'; }
  // English and Chinese only: auto-detect, and if Whisper hears any other language (English heard as Malay, 'bye' as Korean), retry as English.
  const { text, lang } = await stt(audio, mime).then((r) => ({ ...r, text: fixTerms(r.text) }));
  const ok = (!lang || /^(en|english|zh|chinese)$/i.test(lang)) && /^[\p{Script=Latin}\p{Script=Han}\p{N}\p{P}\p{Zs}\p{S}]*$/u.test(text);
  return ok ? text : fixTerms((await stt(audio, mime, 'en')).text);
}

/** Crypto names misheard by speech-to-text, fixed from a glossary (src/terms.ts) only where the sentence is about money,
 *  so ordinary speech ("pass the salt", "Neo is a film") is left alone. */
export function fixTerms(t: string): string {
  return correct(t);
}

async function stt(audio: Uint8Array, mime: string, language?: string): Promise<{ text: string; lang?: string }> {
  const fd = new FormData();
  fd.set('model', env.sttModel);
  if (language) fd.set('language', language);
  fd.set('response_format', 'verbose_json'); // adds the detected language
  // Vocabulary hint, both languages: Whisper spells crypto names right when it has seen them in the prompt.
  // Whisper reads only the last ~224 tokens of the prompt; this one is about 150. Spellings here are how we want them back.
  fd.set('prompt', 'Ringfence call on NEAR. Send 0.1 NEAR, 1 NEAR, half a NEAR to liho00.near, mum.near, stranger.near or ringfence-family.sputnik-dao.near. Top up 2 dollars of SOL, ETH, BTC, USDC, USDT, wNEAR, stNEAR, DOGE, ADA, AVAX, LINK, UNI, SUI, PEPE, SHIB, TRUMP, ZEC, DAI, XRP, ARB, AURORA, SWEAT. NEAR Intents, NEAR AI, Sputnik DAO, JustHoot, MyNearWallet, HOT wallet, rhea finance. Money packet, lucky split, PIN. 发送NEAR，USDC充值，红包，余额，退款地址。');
  fd.set('file', new Blob([audio as BlobPart], { type: mime }), mime.includes('webm') ? 'a.webm' : mime.includes('ogg') ? 'a.ogg' : 'a.wav');
  const r = await again(undefined, () => fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${env.nearAiKey}` }, body: fd }));
  if (!r.ok) throw new Error(`stt ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as any;
  return { text: j.text?.trim() ?? '', lang: j.language };
}
