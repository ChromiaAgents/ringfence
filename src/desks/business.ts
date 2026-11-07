// The business desk: a builder's line. Customers describe the job or send a photo of it; a vision model in a TEE
// scopes it, but every price, discount and deposit comes from owner.yaml through code.
import { owner, env } from '../config.ts';
import { db, save, id, log, type Call } from '../store.ts';
import type { DeskDef } from './types.ts';

const tools = [
  { type: 'function', function: { name: 'save_caller', description: "Save the caller's details once you have them.", parameters: { type: 'object', properties: { name: { type: 'string' }, postcode: { type: 'string' }, area: { type: 'string', description: 'town or borough' }, phone: { type: 'string' } }, required: ['name', 'postcode'] } } },
  { type: 'function', function: { name: 'quote_job', description: 'Get an allowed price for a job. Call before saying any number. Ask for a discount only if the caller asks for one.', parameters: { type: 'object', properties: { service_id: { type: 'string' }, size: { type: 'string', enum: ['small', 'medium', 'large'] }, discount_pct: { type: 'number', description: 'discount the caller asked for, 0 if none' }, scope: { type: 'string', description: 'what the work involves, in a few words (from the caller or their photo)' } }, required: ['service_id', 'size'] } } },
  { type: 'function', function: { name: 'book_visit', description: 'Book the site visit after the caller agrees to the quote. Creates the job and the deposit link.', parameters: { type: 'object', properties: { service_id: { type: 'string' }, size: { type: 'string', enum: ['small', 'medium', 'large'] }, discount_pct: { type: 'number' }, preferred_date: { type: 'string' }, notes: { type: 'string', description: 'style, colours, scope' } }, required: ['service_id', 'size'] } } },
  { type: 'function', function: { name: 'take_message', description: 'Leave a message for the owner (when you cannot quote or book).', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } },
];

function system(call: Call) {
  const o = owner();
  const list = o.services.map((s) => `- ${s.id}: ${s.name}`).join('\n');
  return `You answer the phone for ${o.business.name}, a building firm in ${o.business.area}. The owner is ${o.business.owner}.
You are on a live phone call. Every reply is one or two short spoken sentences, under 30 words, like a person on the phone: no lists, no markdown, no emojis, no preamble. Ask one question at a time.
Callers can send a photo of the job (on WhatsApp, or the upload button on the web page). When a message starts with [Photo], it is a TEE vision model's description of their photo: use it to fill in the scope and size instead of asking again.
Order: find out which service, the scope (size, current state), style, the caller's name and postcode (save_caller), then quote (quote_job, never invent a number), mention ${o.business.owner} does the site visit, and if they agree call book_visit. Tell them the deposit link is on its way and wrap up.
Services:
${list}
Never say a price that quote_job did not give you. If a tool refuses, explain kindly and offer to take a message. Prices are in US dollars.${o.rules.kill_switch ? '\nThe owner has paused bookings today: do not quote or book, only take a message.' : ''}${call.photos?.length ? `\nThis caller sent ${call.photos.length} photo(s).` : ''}`;
}

const SIZE = { small: 0, medium: 0.5, large: 1 } as const;

export function priceFor(serviceId: string, size: keyof typeof SIZE, discountPct = 0, scope = '') {
  const o = owner();
  if (o.rules.kill_switch) return { ok: false as const, reason: 'Bookings are paused by the owner today.' };
  const s = o.services.find((x) => x.id === serviceId);
  if (!s) return { ok: false as const, reason: `Unknown service. Options: ${o.services.map((x) => x.id).join(', ')}` };
  const banned = (o.rules.refuse_work ?? []).find((w) => `${scope} ${s.name}`.toLowerCase().includes(String(w).toLowerCase()));
  if (banned) return { ok: false as const, reason: `${o.business.owner} doesn't take ${banned} work.` };
  const base = Math.round(s.from_usd + (s.to_usd - s.from_usd) * (SIZE[size] ?? 0.5));
  const d = Math.max(0, discountPct || 0);
  if (d > o.rules.max_discount_pct) return { ok: false as const, reason: `Max discount is ${o.rules.max_discount_pct}%.`, maxDiscountPct: o.rules.max_discount_pct, priceUsd: base };
  const price = Math.round(base * (1 - d / 100));
  const deposit = Math.min(Math.max(Math.round((price * o.rules.deposit_pct) / 100), o.rules.min_deposit_usd), o.rules.max_deposit_usd);
  return { ok: true as const, service: s, priceUsd: price, discountPct: d, depositUsd: deposit, note: 'Estimate, confirmed at the site visit.' };
}

async function run(call: Call, name: string, args: any): Promise<unknown> {
  if (name === 'save_caller') {
    call.caller = { ...(call.caller ?? {}), ...args, ...(call.from ? { phone: call.from } : {}) };
    save();
    return { saved: true };
  }
  if (name === 'quote_job') {
    const p = priceFor(args.service_id, args.size, args.discount_pct, args.scope);
    log({ kind: p.ok ? 'quote' : 'refused', desk: 'business', callId: call.id, detail: p.ok ? `${p.service.name} ${args.size}: $${p.priceUsd} (${p.discountPct}% off)` : p.reason });
    return p.ok ? { priceUsd: p.priceUsd, discountPct: p.discountPct, depositUsd: p.depositUsd, note: p.note } : p;
  }
  if (name === 'book_visit') {
    if (!call.caller?.name) return { ok: false, reason: 'Get the caller name and postcode first (save_caller).' };
    const p = priceFor(args.service_id, args.size, args.discount_pct, args.notes);
    if (!p.ok) {
      log({ kind: 'refused', desk: 'business', callId: call.id, detail: p.reason });
      return p;
    }
    const job = {
      id: id(), callId: call.id, serviceId: p.service.id, serviceName: p.service.name, quotedUsd: p.priceUsd, discountPct: p.discountPct,
      depositUsd: p.depositUsd, preferredDate: args.preferred_date, notes: args.notes, caller: call.caller, createdAt: Date.now(), photo: call.photos?.at(-1),
    };
    db.jobs.push(job);
    call.jobId = job.id;
    log({ kind: 'booking', desk: 'business', jobId: job.id, callId: call.id, detail: `${job.serviceName} for ${job.caller.name}, $${job.quotedUsd}, deposit $${job.depositUsd}` });
    log({ kind: 'deposit_link', desk: 'business', jobId: job.id, callId: call.id, detail: `${env.publicUrl}/pay/${job.id}` });
    return { ok: true, jobId: job.id, depositUsd: job.depositUsd, depositLinkSent: true };
  }
  if (name === 'take_message') {
    log({ kind: 'message', desk: 'business', callId: call.id, detail: `${call.caller?.name ?? call.from ?? 'caller'}: ${args.message}` });
    return { ok: true };
  }
  return { error: 'unknown tool' };
}

export const businessDesk: DeskDef = {
  id: 'business',
  greeting: () => owner().business.greeting,
  system,
  tools,
  run,
  link: (call) => (call.jobId ? { url: `${env.publicUrl}/pay/${call.jobId}`, label: 'Pay the deposit' } : null),
};
