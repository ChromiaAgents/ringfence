// The launch desk: a caller describes a memecoin, the desk prepares a JustHoot launch (NEAR mainnet) the caller
// signs with their own wallet. Every rule in launchpad.yaml is enforced here, in code, before anything is prepared.
import { launchpad, env, type Launchpad } from '../config.ts';
import { db, save, id, log, type Call } from '../store.ts';
import type { LaunchParams } from '../near.ts';
import { generateLogo, drawLogo } from '../image.ts';
import { smallIcon } from '../justhoot.ts';
import type { DeskDef } from './types.ts';

type Draft = Partial<LaunchParams> & { logoModel?: string; logoBytes?: number };
const drafts = new Map<string, Draft>();
export const draftOf = (callId: string) => drafts.get(callId) ?? {};
export const carryDraft = (from: string, to: string) => { const d = drafts.get(from); if (d) drafts.set(to, { ...d }); };

type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- rules (pure, tested in test/rules.ts) ----

export function checkTicker(raw: string, lp: Launchpad = launchpad()): Verdict & { ticker?: string } {
  const t = String(raw ?? '').replace(/^\$/, '').trim().toUpperCase();
  const { ticker_min: min, ticker_max: max } = lp.rules;
  if (!new RegExp(`^[A-Z0-9]{${min},${max}}$`).test(t)) return no(`Tickers are ${min} to ${max} letters or digits, A to Z and 0 to 9 only.`);
  if (lp.blocked_tickers.map((x) => x.toUpperCase()).includes(t)) return no(`${t} is the ticker of an existing asset; launching it would look like impersonation.`);
  const brand = lp.blocked_names.map((n) => n.replace(/\s/g, '').toUpperCase()).find((n) => n === t || (n.length >= 4 && t.includes(n)));
  if (brand) return no(`${t} is a brand or a real person's name; the desk won't launch it.`);
  return { ok: true, ticker: t };
}

export function checkName(name: string, lp: Launchpad = launchpad()): Verdict {
  const n = String(name ?? '').trim();
  if (n.length < 2 || n.length > lp.rules.name_max) return no(`Names are 2 to ${lp.rules.name_max} characters.`);
  const hit = lp.blocked_names.find((b) => ` ${norm(n)} `.includes(` ${norm(b)} `));
  if (hit) return no(`The name uses "${hit}", a brand or a real person. The desk won't launch coins that impersonate them.`);
  return { ok: true };
}

/** Replies that promise returns never reach the caller. Returns the cleaned text and whether it was replaced. */
export function filterClaims(text: string, lp: Launchpad = launchpad()): { text: string; hit?: string } {
  const low = text.toLowerCase();
  const hit = lp.forbidden_claims.find((c) => low.includes(c.toLowerCase()));
  if (!hit) return { text };
  return { text: "I can't make any promises about price or returns: most memecoins lose value. I can only help you set the launch up.", hit };
}

const url = (s?: string) => (s && /^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : s?.trim() ? `https://${s.trim().replace(/^@/, 'x.com/')}` : undefined);

// ---- the agent's view ----

const tools = [
  { type: 'function', function: { name: 'set_coin', description: 'Save the coin name, ticker and a one-line description. Call as soon as you have them; the ticker is checked against the rules.', parameters: { type: 'object', properties: { name: { type: 'string' }, ticker: { type: 'string', description: '1 to 10 letters or digits' }, description: { type: 'string' } }, required: ['name', 'ticker', 'description'] } } },
  { type: 'function', function: { name: 'make_logo', description: 'Draw the logo from the vibe the caller describes (colours, character, mood). Takes a few seconds.', parameters: { type: 'object', properties: { vibe: { type: 'string' } }, required: ['vibe'] } } },
  { type: 'function', function: { name: 'set_socials', description: 'Optional links: X/Twitter, Telegram, website.', parameters: { type: 'object', properties: { twitter: { type: 'string' }, telegram: { type: 'string' }, website: { type: 'string' } } } } },
  { type: 'function', function: { name: 'prepare_launch', description: 'Only after you read the full summary back and the caller clearly said yes. Prepares the launch page the caller signs with their own NEAR wallet.', parameters: { type: 'object', properties: { caller_confirmed: { type: 'boolean' } }, required: ['caller_confirmed'] } } },
];

function system(): string {
  const lp = launchpad();
  const r = lp.rules;
  return `Coins launch on JustHoot: instant trading on RHEA, about 0.06 to 0.1 NEAR, on NEAR mainnet with real NEAR.
Drive it like a friend who's done this a hundred times. Once you know what the coin is about, pitch a fun name and ticker yourself and ask if they like it ("How about Whisker Coin, ticker WHISK?"); if they give their own, use it. Call set_coin as soon as there's a name and ticker.
Then make the logo straight away from what you already know (call make_logo with your own vibe idea); only ask about the look if they seem to care.
There is no auction and no team share: go straight to the recap. No transfer tax and no dev buy are offered.
Then give a quick one-breath recap and ask "shall I set it up?". Only after a clear yes call prepare_launch with caller_confirmed true.
Explain that the caller signs the launch with their own NEAR wallet on the link you send; you never hold their keys or money. Talk about it as a coin on NEAR, and mention NEAR naturally when you confirm the launch.
Never promise returns, price moves or profit, never give financial advice. If a tool refuses, say why in plain words and ask for something else.${r.kill_switch ? '\nLaunches are paused today: chat, but do not prepare any launch.' : ''}`;
}

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const lp = launchpad();
  const d = drafts.get(call.id) ?? {};
  drafts.set(call.id, d);
  const refuse = (reason: string) => { log({ kind: 'refused', desk: 'launch', callId: call.id, detail: `${name}: ${reason}` }); return { ok: false, reason }; };

  if (name === 'set_coin') {
    const nv = checkName(a.name, lp);
    if (!nv.ok) return refuse(nv.reason);
    const tv = checkTicker(a.ticker, lp);
    if (!tv.ok) return refuse(tv.reason);
    Object.assign(d, { name: String(a.name).trim(), symbol: tv.ticker, description: String(a.description ?? '').slice(0, 280) });
    return { ok: true, ticker: tv.ticker };
  }
  if (name === 'make_logo') {
    if (!d.symbol || !d.name) return { ok: false, reason: 'Save the name and ticker first (set_coin).' };
    const g = await generateLogo(String(a.vibe ?? ''), d.name).catch(async (e) => { console.error('logo', e.message); return drawLogo(d.symbol!); });
    Object.assign(d, { icon: g.icon, logoModel: g.model, logoBytes: g.bytes });
    log({ kind: 'logo', desk: 'launch', callId: call.id, detail: `${d.symbol}: ${g.model}, ${g.bytes} bytes` });
    return { ok: true, by: g.model, note: g.model === 'drawn locally' ? 'The image model was unavailable, so a plain placeholder was drawn. Say so.' : 'Tell them the logo is on the launch page.' };
  }
  if (name === 'set_socials') {
    d.socials = { twitter: url(a.twitter), telegram: url(a.telegram), website: url(a.website) };
    return { ok: true };
  }
  if (name === 'prepare_launch') {
    if (lp.rules.kill_switch) return refuse('Launches are paused by the desk operator today.');
    if (a.caller_confirmed !== true) return { ok: false, reason: 'Read the summary back and get a clear yes first.' };
    // No logo asked for yet: make one from the description rather than stall the call on "missing icon".
    if (d.icon == null && d.name && d.symbol) {
      const g = await generateLogo(d.description || d.name, d.name).catch(() => drawLogo(d.symbol!));
      Object.assign(d, { icon: g.icon, logoModel: g.model, logoBytes: g.bytes });
      log({ kind: 'logo', desk: 'launch', callId: call.id, detail: `${d.symbol}: ${g.model}, ${g.bytes} bytes (auto)` });
    }
    const missing = (['name', 'symbol', 'icon'] as const).filter((k) => d[k] == null);
    if (missing.length) {
      const say: Record<string, string> = { name: 'a name', symbol: 'a ticker', icon: 'a logo' };
      const m = missing.map((k) => say[k]);
      return { ok: false, reason: `I still need ${m.length > 1 ? `${m.slice(0, -1).join(', ')} and ${m.at(-1)}` : m[0]} for the coin.` };
    }
    // Re-check everything at the last step: drafts can be edited between tools.
    const checks: Verdict[] = [checkName(d.name!, lp), checkTicker(d.symbol!, lp)];
    for (const v of checks) if (!v.ok) return refuse(v.reason);
    const icon = await smallIcon(d.icon!).catch(() => null);
    if (!icon) return { ok: false, reason: 'The logo is too detailed for JustHoot. Make a simpler one (make_logo).' };
    const l = {
      id: id(), callId: call.id, createdAt: Date.now(), network: 'mainnet' as const, launchpad: 'justhoot' as const, status: 'prepared' as const, logoModel: d.logoModel,
      params: { name: d.name!, symbol: d.symbol!, description: d.description ?? '', icon, socials: d.socials },
    };
    db.launches.push(l);
    call.launchId = l.id;
    save();
    const link = `${env.publicUrl}/launch/${l.id}`;
    log({ kind: 'launch_prepared', desk: 'launch', callId: call.id, launchId: l.id, detail: `$${l.params.symbol} ${l.params.name} on JustHoot, mainnet: ${link}` });
    return { ok: true, linkSent: true, network: l.network, note: 'Tell them to open the link: it is mainnet, real NEAR, about 0.1 NEAR plus gas, and the coin trades on RHEA the moment they sign with their own wallet.' };
  }
  return { error: 'unknown tool' };
}

export const launchDesk: DeskDef = {
  id: 'launch',
  greeting: () => launchpad().desk.greeting,
  system,
  tools,
  run,
  filter: (text) => filterClaims(text),
  link: (call) => (call.launchId ? { url: `${env.publicUrl}/launch/${call.launchId}`, label: 'Open your launch' } : null),
};
