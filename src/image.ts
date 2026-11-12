import { withAiKey, hasAiKey } from './aikey.ts';
// Pictures through NEAR AI Cloud TEE models: a coin logo from FLUX.
import sharp from 'sharp';
import { env } from './config.ts';

const BASE = 'https://cloud-api.near.ai/v1';

/** FLUX.2 klein (owned by nearai, runs in a TEE) -> a 256 px WebP data URL, small enough for on-chain storage. */
export async function generateLogo(vibe: string, name: string): Promise<{ icon: string; bytes: number; model: string }> {
  if (!hasAiKey()) throw new Error('no NEARAI_API_KEY');
  const prompt = `A memecoin logo for "${name}": ${vibe}. One bold centred character or object, flat sticker style, thick black outline. A nod to NEAR Protocol: NEAR mint green (#00EC97) as the accent colour and a small round black NEAR "N" badge worn or held by the character. Plain solid background, no other text or letters.`;
  const { r } = await withAiKey((key) => fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.imageModel, prompt, n: 1, size: '512x512', response_format: 'b64_json' }),
  }));
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`image ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  const item = d.data?.[0] ?? {};
  const src = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null;
  if (!src) throw new Error('image: no picture in the response');
  return { ...(await toIcon(src)), model: env.imageModel };
}

/** Fallback when the image model is unavailable (no key, outage): a plain sticker coin drawn here, labelled as such. */
export async function drawLogo(ticker: string) {
  const fill = '#00EC97'; // NEAR mint on the site's warm black with dark lettering; no gold or yellow
  const t = ticker.replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const size = t.length <= 3 ? 64 : t.length <= 5 ? 46 : 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#0C0A08"/><circle cx="136" cy="136" r="104" fill="#2C2722"/><circle cx="124" cy="124" r="104" fill="${fill}" stroke="#0C0A08" stroke-width="8"/><text x="124" y="124" dy=".35em" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${size}" fill="#0C0A08">${t}</text></svg>`;
  return { ...(await toIcon(Buffer.from(svg))), model: 'drawn locally' };
}

/** Any image -> 256x256 WebP data URL. The contract caps icons at 100 KB; we stay far below because every byte costs storage NEAR. */
export async function toIcon(img: Buffer) {
  let q = 70, out = await sharp(img).resize(256, 256, { fit: 'cover' }).webp({ quality: q }).toBuffer();
  while (out.length > 12_000 && q > 30) out = await sharp(img).resize(256, 256, { fit: 'cover' }).webp({ quality: (q -= 10) }).toBuffer();
  return { icon: `data:image/webp;base64,${out.toString('base64')}`, bytes: out.length };
}

