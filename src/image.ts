// Pictures through NEAR AI Cloud TEE models: a coin logo from FLUX, and a job description from a customer's photo.
import sharp from 'sharp';
import { env } from './config.ts';
import { chat, type Proof } from './ai.ts';

const BASE = 'https://cloud-api.near.ai/v1';

/** FLUX.2 klein (owned by nearai, runs in a TEE) -> a 256 px WebP data URL, small enough for on-chain storage. */
export async function generateLogo(vibe: string, name: string): Promise<{ icon: string; bytes: number; model: string }> {
  if (!env.nearAiKey) throw new Error('no NEARAI_API_KEY');
  const prompt = `A memecoin logo for "${name}": ${vibe}. One bold centred character or object, flat sticker style, thick black outline. A nod to NEAR Protocol: NEAR mint green (#00EC97) as the accent colour and a small round black NEAR "N" badge worn or held by the character. Plain solid background, no other text or letters.`;
  const r = await fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.nearAiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.imageModel, prompt, n: 1, size: '512x512', response_format: 'b64_json' }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`image ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  const item = d.data?.[0] ?? {};
  const src = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null;
  if (!src) throw new Error('image: no picture in the response');
  return { ...(await toIcon(src)), model: env.imageModel };
}

/** Fallback when the image model is unavailable (no key, outage): a plain sticker coin drawn here, labelled as such. */
export async function drawLogo(ticker: string) {
  const fills = ['#00EC97', '#93F091', '#CC91F0', '#FFB0C2'];
  const fill = fills[[...ticker].reduce((n, c) => n + c.charCodeAt(0), 0) % fills.length];
  const t = ticker.replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const size = t.length <= 3 ? 64 : t.length <= 5 ? 46 : 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#FFF8F8"/><circle cx="136" cy="136" r="104" fill="#1F1A23"/><circle cx="124" cy="124" r="104" fill="${fill}" stroke="#1F1A23" stroke-width="8"/><text x="124" y="124" dy=".35em" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${size}" fill="#1F1A23">${t}</text></svg>`;
  return { ...(await toIcon(Buffer.from(svg))), model: 'drawn locally' };
}

/** Any image -> 256x256 WebP data URL. The contract caps icons at 100 KB; we stay far below because every byte costs storage NEAR. */
export async function toIcon(img: Buffer) {
  let q = 70, out = await sharp(img).resize(256, 256, { fit: 'cover' }).webp({ quality: q }).toBuffer();
  while (out.length > 12_000 && q > 30) out = await sharp(img).resize(256, 256, { fit: 'cover' }).webp({ quality: (q -= 10) }).toBuffer();
  return { icon: `data:image/webp;base64,${out.toString('base64')}`, bytes: out.length };
}

/** Qwen3-VL (owned by nearai, TEE) looks at a customer's photo and describes the job for the business desk. */
export async function describePhoto(img: Buffer): Promise<{ text: string; proof: Proof }> {
  const small = await sharp(img).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  const { msg, proof } = await chat([{
    role: 'user',
    content: [
      { type: 'text', text: 'You help a building firm scope a job from a customer photo. In 2-3 plain sentences say: which room or part of the building this is, what work it seems to need, and whether it looks small, medium or large. Do not give prices.' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` } },
    ],
  }], [], env.visionModel, { maxTokens: 250 });
  return { text: String(msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), proof };
}
