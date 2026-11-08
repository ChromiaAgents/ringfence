// The launch desk: a caller describes a memecoin, the desk prepares a meme.cooking or JustHoot launch the caller
// signs with their own wallet. Every rule in launchpad.yaml is enforced here, in code, before anything is prepared.
import { launchpad, env, type Launchpad } from '../config.ts';
import { db, save, id, log, type Call } from '../store.ts';
import { existingMemes, type LaunchParams } from '../memecook.ts';
import { generateLogo, drawLogo } from '../image.ts';
import { smallIcon } from '../justhoot.ts';
import type { DeskDef } from './types.ts';

export type Pad = 'meme_cooking' | 'justhoot';
type Draft = Partial<Omit<LaunchParams, 'totalSupply' | 'decimals'>> & { logoModel?: string; logoBytes?: number; pad?: Pad };
const drafts = new Map<string, Draft>();
export const draftOf = (callId: string) => drafts.get(callId) ?? {};
export const carryDraft = (from: string, to: string) => { const d = drafts.get(from); if (d) drafts.set(to, { ...d }); };

type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- rules (pure, tested in test/rules.ts) ----

export function checkTicker(raw: string, lp: Launchpad = launchpad(), existing: { symbol: string }[] = []): Verdict & { ticker?: string } {
  const t = String(raw ?? '').replace(/^\$/, '').trim().toUpperCase();
  const { ticker_min: min, ticker_max: max } = lp.rules;
  if (!new RegExp(`^[A-Z0-9]{${min},${max}}$`).test(t)) return no(`Tickers are ${min} to ${max} letters or digits, A to Z and 0 to 9 only.`);
  if (lp.blocked_tickers.map((x) => x.toUpperCase()).includes(t)) return no(`${t} is the ticker of an existing asset; launching it would look like impersonation.`);
  const brand = lp.blocked_names.map((n) => n.replace(/\s/g, '').toUpperCase()).find((n) => n === t || (n.length >= 4 && t.includes(n)));
  if (brand) return no(`${t} is a brand or a real person's name; the desk won't launch it.`);
  if (existing.some((m) => m.symbol.toUpperCase() === t)) return no(`${t} is already a ticker on meme.cooking. Pick another.`);
  return { ok: true, ticker: t };
}

export function checkName(name: string, lp: Launchpad = launchpad()): Verdict {
  const n = String(name ?? '').trim();
  if (n.length < 2 || n.length > lp.rules.name_max) return no(`Names are 2 to ${lp.rules.name_max} characters.`);
  const hit = lp.blocked_names.find((b) => ` ${norm(n)} `.includes(` ${norm(b)} `));
  if (hit) return no(`The name uses "${hit}", a brand or a real person. The desk won't launch coins that impersonate them.`);
  return { ok: true };
}

export function checkAuction(a: { durationMinutes: number; softCapNear: number; hardCapNear?: number }, lp: Launchpad = launchpad()): Verdict {
  const r = lp.rules;
  if (!(a.durationMinutes >= r.duration_min_minutes && a.durationMinutes <= r.duration_max_minutes)) return no(`The auction runs between ${r.duration_min_minutes} minutes and ${r.duration_max_minutes / 60} hours.`);
  if (!(a.softCapNear >= r.soft_cap_min_near && a.softCapNear <= r.soft_cap_max_near)) return no(`The soft cap must be between ${r.soft_cap_min_near} and ${r.soft_cap_max_near} NEAR.`);
  if (a.hardCapNear != null && a.hardCapNear !== 0 && !(a.hardCapNear > a.softCapNear)) return no('A hard cap has to be above the soft cap.');
  return { ok: true };
}

export function checkTeam(t: { pct: number; cliffDays: number; vestingDays: number }, lp: Launchpad = launchpad()): Verdict {
  const r = lp.rules;
  if (!t.pct) return { ok: true };
  if (!(t.pct > 0 && t.pct <= r.max_team_allocation_pct)) return no(`Team allocation is capped at ${r.max_team_allocation_pct}% of supply.`);
  if (!(t.cliffDays >= r.min_cliff_days)) return no(`A team allocation needs a cliff of at least ${r.min_cliff_days} days before anything unlocks.`);
  if (!(t.vestingDays >= r.min_vesting_days)) return no(`A team allocation has to vest over at least ${r.min_vesting_days} days.`);
  return { ok: true };
}

/** Replies that promise returns never reach the caller. Returns the cleaned text and whether it was replaced. */
export function filterClaims(text: string, lp: Launchpad = launchpad()): { text: string; hit?: string } {
  const low = text.toLowerCase();
  const hit = lp.forbidden_claims.find((c) => low.includes(c.toLowerCase()));
  if (!hit) return { text };
  return { text: "I can't make any promises about price or returns: most memecoins lose value. I can only help you set the launch up.", hit };
}

export const padEnabled = (pad: Pad, lp: Launchpad = launchpad()) => lp.launchpads?.[pad]?.enabled !== false;
/** JustHoot's ticker rule (1-10 letters or digits by default) with every other rule unchanged. */
export const justhootRules = (lp: Launchpad = launchpad()): Launchpad =>
  ({ ...lp, rules: { ...lp.rules, ticker_min: lp.launchpads?.justhoot?.ticker_min ?? 1, ticker_max: lp.launchpads?.justhoot?.ticker_max ?? 10 } });
/** Ticker check for the chosen pad. JustHoot tickers are not unique, so only meme.cooking checks collisions. */
const tickerFor = async (pad: Pad, raw: string, lp: Launchpad) =>
  pad === 'justhoot' ? checkTicker(raw, justhootRules(lp)) : checkTicker(raw, lp, await existingMemes().catch(() => []));

const url = (s?: string) => (s && /^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : s?.trim() ? `https://${s.trim().replace(/^@/, 'x.com/')}` : undefined);

// ---- the agent's view ----

const tools = [
  { type: 'function', function: { name: 'set_launchpad', description: "Which launchpad: meme_cooking (auction first) or justhoot (instant trading on RHEA, mainnet only). Call once the caller picks, or after you suggest one and they agree.", parameters: { type: 'object', properties: { launchpad: { type: 'string', enum: ['meme_cooking', 'justhoot'] } }, required: ['launchpad'] } } },
  { type: 'function', function: { name: 'set_coin', description: 'Save the coin name, ticker and a one-line description. Call as soon as you have them; the ticker is checked against the rules and existing meme.cooking tickers.', parameters: { type: 'object', properties: { name: { type: 'string' }, ticker: { type: 'string', description: 'letters or digits: 2-8 on meme.cooking, 1-10 on JustHoot' }, description: { type: 'string' } }, required: ['name', 'ticker', 'description'] } } },
  { type: 'function', function: { name: 'make_logo', description: 'Draw the logo from the vibe the caller describes (colours, character, mood). Takes a few seconds.', parameters: { type: 'object', properties: { vibe: { type: 'string' } }, required: ['vibe'] } } },
  { type: 'function', function: { name: 'set_auction', description: 'Save the auction length and soft cap (minimum NEAR raised for the launch to succeed). Hard cap is optional.', parameters: { type: 'object', properties: { duration_minutes: { type: 'number' }, soft_cap_near: { type: 'number' }, hard_cap_near: { type: 'number' } }, required: ['duration_minutes', 'soft_cap_near'] } } },
  { type: 'function', function: { name: 'set_team_allocation', description: "Optional creator share of supply with a cliff and linear vesting. pct 0 means none.", parameters: { type: 'object', properties: { pct: { type: 'number' }, cliff_days: { type: 'number' }, vesting_days: { type: 'number' } }, required: ['pct'] } } },
  { type: 'function', function: { name: 'set_socials', description: 'Optional links: X/Twitter, Telegram, website.', parameters: { type: 'object', properties: { twitter: { type: 'string' }, telegram: { type: 'string' }, website: { type: 'string' } } } } },
  { type: 'function', function: { name: 'prepare_launch', description: 'Only after you read the full summary back and the caller clearly said yes. Prepares the launch page the caller signs with their own NEAR wallet.', parameters: { type: 'object', properties: { caller_confirmed: { type: 'boolean' } }, required: ['caller_confirmed'] } } },
];

function system(): string {
  const lp = launchpad();
  const r = lp.rules;
  return `You are ${lp.desk.name}, a voice agent that helps a caller launch a memecoin on NEAR.
There are two launchpads; early on, say the difference in one breath and let them pick, or suggest one: meme.cooking runs an auction first and costs about 0.22 NEAR; JustHoot is instant trading on RHEA and costs about 0.06 to 0.1 NEAR (the logo is stored on chain), mainnet only, real NEAR. Call set_launchpad with their choice before set_coin.${padEnabled('justhoot', lp) ? '' : ' JustHoot is switched off today: only offer meme.cooking.'}${padEnabled('meme_cooking', lp) ? '' : ' meme.cooking is switched off today: only offer JustHoot.'}
Drive it like a friend who's done this a hundred times. Once you know what the coin is about, pitch a fun name and ticker yourself and ask if they like it ("How about Whisker Coin, ticker WHISK?"); if they give their own, use it. Call set_coin as soon as there's a name and ticker.
Then make the logo straight away from what you already know (call make_logo with your own vibe idea); only ask about the look if they seem to care.
On JustHoot there is no auction and no team share: skip straight to the recap. No transfer tax and no dev buy are offered.
On meme.cooking, for the auction, propose sensible defaults in one go instead of asking each: 24 hours and a soft cap of 10 NEAR, no team share, no socials (limits: ${r.duration_min_minutes} minutes to ${r.duration_max_minutes / 60} hours, soft cap ${r.soft_cap_min_near} to ${r.soft_cap_max_near} NEAR, team share up to ${r.max_team_allocation_pct}% with at least a ${r.min_cliff_days}-day cliff and ${r.min_vesting_days}-day vesting). If they say fine, call set_auction with those.
Then give a quick one-breath recap and ask "shall I set it up?". Only after a clear yes call prepare_launch with caller_confirmed true.
Explain that the caller signs the launch with their own NEAR wallet on the link you send; you never hold their keys or money. meme.cooking launches go to NEAR ${env.network}; JustHoot launches always go to NEAR mainnet with real NEAR. Talk about it as a coin on NEAR, and mention NEAR naturally when you confirm the launch.
Never promise returns, price moves or profit, never give financial advice. If a tool refuses, say why in plain words and ask for something else.${r.kill_switch ? '\nLaunches are paused today: chat, but do not prepare any launch.' : ''}`;
}

async function run(call: Call, name: string, a: any): Promise<unknown> {
  const lp = launchpad();
  const d = drafts.get(call.id) ?? {};
  drafts.set(call.id, d);
  const refuse = (reason: string) => { log({ kind: 'refused', desk: 'launch', callId: call.id, detail: `${name}: ${reason}` }); return { ok: false, reason }; };

  const pad: Pad = d.pad ?? (padEnabled('justhoot', lp) ? 'justhoot' : 'meme_cooking'); // first enabled pad
  if (name === 'set_launchpad') {
    const p = a.launchpad === 'justhoot' ? 'justhoot' : a.launchpad === 'meme_cooking' ? 'meme_cooking' : null;
    if (!p) return refuse('Pick meme_cooking or justhoot.');
    if (!padEnabled(p, lp)) return refuse(`${p === 'justhoot' ? 'JustHoot' : 'meme.cooking'} is switched off by the desk operator today.`);
    d.pad = p;
    return { ok: true, launchpad: p, network: p === 'justhoot' ? 'mainnet' : env.network };
  }
  if (name === 'set_coin') {
    const nv = checkName(a.name, lp);
    if (!nv.ok) return refuse(nv.reason);
    const tv = await tickerFor(pad, a.ticker, lp);
    if (!tv.ok) return refuse(tv.reason);
    const nameHit = pad === 'meme_cooking' ? (await existingMemes().catch(() => [])).find((m) => norm(m.name) === norm(a.name)) : undefined;
    Object.assign(d, { name: String(a.name).trim(), symbol: tv.ticker, description: String(a.description ?? '').slice(0, 280) });
    return { ok: true, ticker: tv.ticker, note: nameHit ? `A meme called ${nameHit.name} already exists with ticker ${nameHit.symbol}; mention it.` : undefined };
  }
  if (name === 'make_logo') {
    if (!d.symbol || !d.name) return { ok: false, reason: 'Save the name and ticker first (set_coin).' };
    const g = await generateLogo(String(a.vibe ?? ''), d.name).catch(async (e) => { console.error('logo', e.message); return drawLogo(d.symbol!); });
    Object.assign(d, { icon: g.icon, logoModel: g.model, logoBytes: g.bytes });
    log({ kind: 'logo', desk: 'launch', callId: call.id, detail: `${d.symbol}: ${g.model}, ${g.bytes} bytes` });
    return { ok: true, by: g.model, note: g.model === 'drawn locally' ? 'The image model was unavailable, so a plain placeholder was drawn. Say so.' : 'Tell them the logo is on the launch page.' };
  }
  if ((name === 'set_auction' || name === 'set_team_allocation') && pad === 'justhoot')
    return refuse('JustHoot has no auction and no team share: the token trades the moment it launches. Skip this step.');
  if (name === 'set_auction') {
    const x = { durationMinutes: Number(a.duration_minutes), softCapNear: Number(a.soft_cap_near), hardCapNear: a.hard_cap_near ? Number(a.hard_cap_near) : undefined };
    const v = checkAuction(x, lp);
    if (!v.ok) return refuse(v.reason);
    Object.assign(d, x);
    return { ok: true };
  }
  if (name === 'set_team_allocation') {
    const t = { pct: Number(a.pct ?? 0), cliffDays: Number(a.cliff_days ?? 0), vestingDays: Number(a.vesting_days ?? 0) };
    const v = checkTeam(t, lp);
    if (!v.ok) return refuse(v.reason);
    d.team = t.pct ? t : undefined;
    return { ok: true };
  }
  if (name === 'set_socials') {
    d.socials = { twitter: url(a.twitter), telegram: url(a.telegram), website: url(a.website) };
    return { ok: true };
  }
  if (name === 'prepare_launch') {
    if (lp.rules.kill_switch) return refuse('Launches are paused by the desk operator today.');
    if (a.caller_confirmed !== true) return { ok: false, reason: 'Read the summary back and get a clear yes first.' };
    if (!padEnabled(pad, lp)) return refuse('That launchpad is switched off by the desk operator today.');
    const jh = pad === 'justhoot';
    const missing = (jh ? (['name', 'symbol', 'icon'] as const) : (['name', 'symbol', 'icon', 'durationMinutes', 'softCapNear'] as const)).filter((k) => d[k] == null);
    if (missing.length) return { ok: false, reason: `Still missing: ${missing.join(', ')}` };
    // Re-check everything at the last step: drafts can be edited between tools.
    const checks: Verdict[] = [checkName(d.name!, lp), await tickerFor(pad, d.symbol!, lp)];
    if (!jh) checks.push(checkAuction(d as any, lp), checkTeam(d.team ?? { pct: 0, cliffDays: 0, vestingDays: 0 }, lp));
    for (const v of checks) if (!v.ok) return refuse(v.reason);
    const icon = jh ? await smallIcon(d.icon!).catch(() => null) : d.icon!;
    if (!icon) return { ok: false, reason: 'The logo is too detailed for JustHoot. Make a simpler one (make_logo).' };
    const l = {
      id: id(), callId: call.id, createdAt: Date.now(), network: jh ? ('mainnet' as const) : env.network, launchpad: pad, status: 'prepared' as const, logoModel: d.logoModel,
      params: { name: d.name!, symbol: d.symbol!, description: d.description ?? '', icon, durationMinutes: jh ? 0 : d.durationMinutes!, softCapNear: jh ? 0 : d.softCapNear!, hardCapNear: jh ? undefined : d.hardCapNear, team: jh ? undefined : d.team, socials: d.socials, totalSupply: lp.rules.total_supply, decimals: lp.rules.decimals },
    };
    db.launches.push(l);
    call.launchId = l.id;
    save();
    const link = `${env.publicUrl}/launch/${l.id}`;
    log({ kind: 'launch_prepared', desk: 'launch', callId: call.id, launchId: l.id, detail: jh ? `$${l.params.symbol} ${l.params.name} on JustHoot, mainnet: ${link}` : `$${l.params.symbol} ${l.params.name}, ${l.params.durationMinutes} min, soft cap ${l.params.softCapNear} NEAR on ${env.network}: ${link}` });
    return { ok: true, linkSent: true, launchpad: pad, network: l.network, note: jh ? 'Tell them to open the link: it is mainnet, real NEAR, about 0.1 NEAR plus gas, and the coin trades on RHEA the moment they sign with their own wallet.' : 'Tell them to open the link, check the details and the exact NEAR cost, and sign with their own wallet.' };
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
