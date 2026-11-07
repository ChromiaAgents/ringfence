// The owner desk: the business owner changes the rules by talking ("day rate 300, max 10% off, no roofs").
// The model only proposes a diff; code checks it against hard bounds, the owner confirms, then owner.yaml is rewritten.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { owner, OWNER_FILE, type Owner } from '../config.ts';
import { log, type Call } from '../store.ts';
import type { DeskDef } from './types.ts';

/** Limits no conversation can move: the owner's agent can't be talked into a 90% discount either. */
export const BOUNDS = {
  max_discount_pct: [0, 30],
  deposit_pct: [10, 50],
  min_deposit_usd: [0, 500],
  max_deposit_usd: [50, 10_000],
  price_usd: [50, 500_000],
} as const;

export type RuleChange = {
  max_discount_pct?: number; deposit_pct?: number; min_deposit_usd?: number; max_deposit_usd?: number;
  kill_switch?: boolean; refuse_work_add?: string[]; refuse_work_remove?: string[];
  service_prices?: { id: string; from_usd: number; to_usd: number }[];
};
type Diff = { path: (string | number)[]; label: string; from: unknown; to: unknown }[];

const inRange = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;

/** Turns a proposed change into a diff against the current file, or explains which bound it breaks. */
export function planChange(c: RuleChange, o: Owner = owner()): { ok: true; diff: Diff } | { ok: false; reason: string } {
  const diff: Diff = [];
  for (const k of ['max_discount_pct', 'deposit_pct', 'min_deposit_usd', 'max_deposit_usd'] as const) {
    if (c[k] == null) continue;
    const v = Number(c[k]);
    if (!inRange(v, BOUNDS[k])) return { ok: false, reason: `${k.replace(/_/g, ' ')} must stay between ${BOUNDS[k][0]} and ${BOUNDS[k][1]}.` };
    if (v !== o.rules[k]) diff.push({ path: ['rules', k], label: k.replace(/_/g, ' '), from: o.rules[k], to: v });
  }
  const min = c.min_deposit_usd ?? o.rules.min_deposit_usd, max = c.max_deposit_usd ?? o.rules.max_deposit_usd;
  if (min > max) return { ok: false, reason: 'The minimum deposit cannot be above the maximum.' };
  if (c.kill_switch != null && c.kill_switch !== o.rules.kill_switch) diff.push({ path: ['rules', 'kill_switch'], label: 'kill switch', from: o.rules.kill_switch, to: !!c.kill_switch });
  const refuse = new Set((o.rules.refuse_work ?? []).map(String));
  const before = [...refuse];
  for (const w of c.refuse_work_add ?? []) if (String(w).trim()) refuse.add(String(w).trim().toLowerCase().slice(0, 40));
  for (const w of c.refuse_work_remove ?? []) refuse.delete(String(w).trim().toLowerCase());
  if ([...refuse].join() !== before.join()) diff.push({ path: ['rules', 'refuse_work'], label: 'work refused', from: before, to: [...refuse] });
  for (const p of c.service_prices ?? []) {
    const i = o.services.findIndex((s) => s.id === p.id);
    if (i < 0) return { ok: false, reason: `No service called ${p.id}. Services: ${o.services.map((s) => s.id).join(', ')}.` };
    if (!inRange(p.from_usd, BOUNDS.price_usd) || !inRange(p.to_usd, BOUNDS.price_usd) || p.from_usd > p.to_usd)
      return { ok: false, reason: `Prices must be between $${BOUNDS.price_usd[0]} and $${BOUNDS.price_usd[1]}, with from not above to.` };
    const s = o.services[i];
    if (s.from_usd !== p.from_usd) diff.push({ path: ['services', i, 'from_usd'], label: `${s.name} from`, from: s.from_usd, to: p.from_usd });
    if (s.to_usd !== p.to_usd) diff.push({ path: ['services', i, 'to_usd'], label: `${s.name} to`, from: s.to_usd, to: p.to_usd });
  }
  if (!diff.length) return { ok: false, reason: 'That is already how the rules are set.' };
  return { ok: true, diff };
}

/** Writes the diff into owner.yaml, keeping its comments and the ${OWNER_NEAR_ACCOUNT} placeholder. */
export function applyDiff(diff: Diff, file = OWNER_FILE) {
  const doc = parseDocument(readFileSync(file, 'utf8'));
  for (const d of diff) doc.setIn(d.path, d.to);
  writeFileSync(file, doc.toString());
}

const pending = new Map<string, Diff>();
export const pendingOf = (callId: string) => pending.get(callId);
const show = (diff: Diff) => diff.map((d) => `${d.label}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`).join('; ');

const tools = [
  { type: 'function', function: { name: 'propose_rules', description: 'Propose a change to the business rules. Code checks it against hard bounds and returns the diff to read back.', parameters: { type: 'object', properties: {
    max_discount_pct: { type: 'number' }, deposit_pct: { type: 'number' }, min_deposit_usd: { type: 'number' }, max_deposit_usd: { type: 'number' },
    kill_switch: { type: 'boolean', description: 'true pauses quotes and bookings' },
    refuse_work_add: { type: 'array', items: { type: 'string' }, description: 'kinds of work to refuse, e.g. roofs' },
    refuse_work_remove: { type: 'array', items: { type: 'string' } },
    service_prices: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, from_usd: { type: 'number' }, to_usd: { type: 'number' } }, required: ['id', 'from_usd', 'to_usd'] } },
  } } } },
  { type: 'function', function: { name: 'confirm_rules', description: 'Apply the last proposed change. Only after the owner clearly said yes to the diff you read back.', parameters: { type: 'object', properties: { owner_confirmed: { type: 'boolean' } }, required: ['owner_confirmed'] } } },
];

function system() {
  const o = owner();
  return `You are the settings line for ${o.business.owner}, owner of ${o.business.name}. You change the rules the customer-facing agent follows.
Current rules: ${JSON.stringify(o.rules)}. Services (USD ranges): ${o.services.map((s) => `${s.id} ${s.from_usd}-${s.to_usd}`).join(', ')}.
A "day rate" maps to the repair service (a half day is half the day rate). Turn what the owner says into one propose_rules call, read the returned diff back in one short sentence, and ask "shall I apply that?". Only call confirm_rules after a clear yes. Short spoken sentences, no lists.`;
}

async function run(call: Call, name: string, a: any): Promise<unknown> {
  if (name === 'propose_rules') {
    const p = planChange(a ?? {});
    if (!p.ok) { log({ kind: 'refused', desk: 'owner', callId: call.id, detail: `rules: ${p.reason}` }); return p; }
    pending.set(call.id, p.diff);
    log({ kind: 'rules_proposed', desk: 'owner', callId: call.id, detail: show(p.diff) });
    return { ok: true, diff: show(p.diff), note: 'Read this back and ask to confirm.' };
  }
  if (name === 'confirm_rules') {
    const diff = pending.get(call.id);
    if (!diff) return { ok: false, reason: 'Nothing proposed yet.' };
    if (a.owner_confirmed !== true) return { ok: false, reason: 'Ask the owner to confirm first.' };
    applyDiff(diff);
    pending.delete(call.id);
    log({ kind: 'rules_changed', desk: 'owner', callId: call.id, detail: show(diff) });
    return { ok: true, applied: show(diff) };
  }
  return { error: 'unknown tool' };
}

export const ownerDesk: DeskDef = {
  id: 'owner',
  greeting: () => `Hi ${owner().business.owner}, settings line. What would you like to change?`,
  system,
  tools,
  run,
};
