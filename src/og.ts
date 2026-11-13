// Live share cards for /stats and /wallets: today's numbers drawn onto a base card. The base, the slot positions and
// one PNG per digit (in the site's Battlefin) come from scripts/og/og.cjs, so the server needs no fonts. Cached 5 min.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './config.ts';
import { rpc, yoctoToNear } from './near.ts';
import { publicStats } from './stats.ts';
import { bindingOf } from './wallet.ts';

const DIR = join(process.cwd(), 'assets/og');
const layout = JSON.parse(readFileSync(join(DIR, 'layout.json'), 'utf8')) as { slots: Record<string, { x: number; y: number }[]>; widths: Record<string, number> };
const file = (ch: string) => join(DIR, 'digits', `${ch === '.' ? 'dot' : ch === ',' ? 'comma' : ch}.png`);

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const balance = (a: string) => rpc('query', { request_type: 'view_account', finality: 'final', account_id: a }).then((x: any) => yoctoToNear(x.amount)).catch(() => null);

async function values(slug: 'stats' | 'wallets'): Promise<string[]> {
  if (slug === 'stats') {
    const s = publicStats();
    return [fmt(s.calls.total), fmt(s.packets.sharesOpened), fmt(s.sends.onChain), fmt(s.refused.total)];
  }
  const demo = env.demoPhone ? bindingOf(env.demoPhone)?.contract : undefined;
  const accts = [demo, 'liho00.near', env.packetsAccountId, env.agentAccountId];
  return Promise.all(accts.map(async (a) => { const n = a ? await balance(a) : null; return n == null ? '' : fmt(n, 2); }));
}

/** Text → composite layers: each character's PNG placed at x, advancing by its width. Unknown characters are skipped. */
function digits(text: string, x: number, y: number) {
  const out: sharp.OverlayOptions[] = [];
  for (const ch of text) { const w = layout.widths[ch]; if (w == null) continue; out.push({ input: file(ch), left: x, top: y }); x += w; }
  return out;
}

const cache = new Map<string, { at: number; png: Buffer }>();
export async function liveCard(slug: 'stats' | 'wallets'): Promise<Buffer> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.png;
  const v = await values(slug);
  const png = await sharp(join(DIR, `${slug}-base.png`)).composite(layout.slots[slug].flatMap((s, i) => digits(v[i] ?? '', s.x, s.y))).png().toBuffer();
  cache.set(slug, { at: Date.now(), png });
  return png;
}

// ponytail: self-check, `tsx src/og.ts` writes both cards next to the base images.
if (process.argv[1]?.endsWith('og.ts')) for (const s of ['stats', 'wallets'] as const) liveCard(s).then((b) => sharp(b).toFile(join(DIR, `${s}-check.png`))).then(() => console.log(`${s} ok`));
