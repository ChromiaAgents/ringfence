// The receptionist. The model talks; these tools decide. Every limit in owner.yaml is enforced here,
// so a jailbroken or confused model still cannot quote below the floor or skip the deposit rules.
import { chat, type Msg } from './ai.ts';
import { owner, env } from './config.ts';
import { db, save, id, log, type Call } from './store.ts';

const tools = [
  {
    type: 'function',
    function: {
      name: 'save_caller',
      description: "Save the caller's details once you have them.",
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, postcode: { type: 'string' }, area: { type: 'string', description: 'town or borough' }, phone: { type: 'string' } },
        required: ['name', 'postcode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quote_job',
      description: 'Get an allowed price for a job. Call before saying any number. Ask for a discount only if the caller asks for one.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string' },
          size: { type: 'string', enum: ['small', 'medium', 'large'] },
          discount_pct: { type: 'number', description: 'discount the caller asked for, 0 if none' },
        },
        required: ['service_id', 'size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_visit',
      description: 'Book the site visit after the caller agrees to the quote. Creates the job and the deposit link.',
      parameters: {
        type: 'object',
        properties: { service_id: { type: 'string' }, size: { type: 'string', enum: ['small', 'medium', 'large'] }, discount_pct: { type: 'number' }, preferred_date: { type: 'string' }, notes: { type: 'string', description: 'style, colours, scope' } },
        required: ['service_id', 'size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_message',
      description: 'Leave a message for the owner (when you cannot quote or book).',
      parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    },
  },
];

function system() {
  const o = owner();
  const list = o.services.map((s) => `- ${s.id}: ${s.name}`).join('\n');
  return `You are the phone receptionist for ${o.business.name}, a building firm in ${o.business.area}. The owner is ${o.business.owner}.
You are on a live voice call: reply in one or two short spoken sentences, no lists, no markdown, no emojis. Ask one question at a time.
Follow this order: greet, find out which service, ask about the scope (size, rooms, current state), ask about style and colours, take the caller's name and postcode (call save_caller), then quote (call quote_job, never invent a number), mention ${o.business.owner} will do the site visit, and if they agree call book_visit. Tell them the deposit link is on its way, confirm, and wrap up.
Services:
${list}
Never say a price that quote_job did not give you. If a tool refuses, explain kindly and offer to take a message. Say prices in US dollars.${o.rules.kill_switch ? '\nThe owner has paused bookings today: do not quote or book, only take a message.' : ''}`;
}

const SIZE = { small: 0, medium: 0.5, large: 1 } as const;

function priceFor(serviceId: string, size: keyof typeof SIZE, discountPct = 0) {
  const o = owner();
  if (o.rules.kill_switch) return { ok: false as const, reason: 'Bookings are paused by the owner today.' };
  const s = o.services.find((x) => x.id === serviceId);
  if (!s) return { ok: false as const, reason: `Unknown service. Options: ${o.services.map((x) => x.id).join(', ')}` };
  const base = Math.round(s.from_usd + (s.to_usd - s.from_usd) * (SIZE[size] ?? 0.5));
  const d = Math.max(0, discountPct || 0);
  if (d > o.rules.max_discount_pct) return { ok: false as const, reason: `Max discount is ${o.rules.max_discount_pct}%.`, maxDiscountPct: o.rules.max_discount_pct, priceUsd: base };
  const price = Math.round(base * (1 - d / 100));
  const deposit = Math.min(Math.max(Math.round((price * o.rules.deposit_pct) / 100), o.rules.min_deposit_usd), o.rules.max_deposit_usd);
  return { ok: true as const, service: s, priceUsd: price, discountPct: d, depositUsd: deposit, note: 'Estimate, confirmed at the site visit.' };
}

async function runTool(call: Call, name: string, args: any): Promise<unknown> {
  const o = owner();
  if (name === 'save_caller') {
    call.caller = { ...(call.caller ?? {}), ...args, ...(call.from ? { phone: call.from } : {}) };
    save();
    return { saved: true };
  }
  if (name === 'quote_job') {
    const p = priceFor(args.service_id, args.size, args.discount_pct);
    log({ kind: p.ok ? 'quote' : 'refused', callId: call.id, detail: p.ok ? `${p.service.name} ${args.size}: $${p.priceUsd} (${p.discountPct}% off)` : p.reason });
    return p.ok ? { priceUsd: p.priceUsd, discountPct: p.discountPct, depositUsd: p.depositUsd, note: p.note } : p;
  }
  if (name === 'book_visit') {
    if (!call.caller?.name) return { ok: false, reason: 'Get the caller name and postcode first (save_caller).' };
    const p = priceFor(args.service_id, args.size, args.discount_pct);
    if (!p.ok) {
      log({ kind: 'refused', callId: call.id, detail: p.reason });
      return p;
    }
    const job = {
      id: id(), callId: call.id, serviceId: p.service.id, serviceName: p.service.name, quotedUsd: p.priceUsd, discountPct: p.discountPct,
      depositUsd: p.depositUsd, preferredDate: args.preferred_date, notes: args.notes, caller: call.caller, createdAt: Date.now(),
    };
    db.jobs.push(job);
    call.jobId = job.id;
    log({ kind: 'booking', jobId: job.id, callId: call.id, detail: `${job.serviceName} for ${job.caller.name}, $${job.quotedUsd}, deposit $${job.depositUsd}` });
    const link = `${env.publicUrl}/pay/${job.id}`;
    log({ kind: 'deposit_link', jobId: job.id, callId: call.id, detail: link });
    onBooked?.(call, job.id, link);
    return { ok: true, jobId: job.id, depositUsd: job.depositUsd, depositLinkSent: true };
  }
  if (name === 'take_message') {
    log({ kind: 'message', callId: call.id, detail: `${call.caller?.name ?? call.from ?? 'caller'}: ${args.message}` });
    return { ok: true };
  }
  return { error: 'unknown tool' };
}

// Hook for channels (WhatsApp sends the link as a message).
export let onBooked: ((call: Call, jobId: string, link: string) => void) | undefined;
export const setOnBooked = (f: typeof onBooked) => (onBooked = f);

const histories = new Map<string, Msg[]>();

export function startCall(channel: Call['channel'], from?: string): { call: Call; greeting: string } {
  const call: Call = { id: id(), channel, from, startedAt: Date.now(), turns: [] };
  db.calls.push(call);
  const greeting = owner().business.greeting;
  call.turns.push({ at: Date.now(), who: 'agent', text: greeting });
  histories.set(call.id, [{ role: 'system', content: system() }, { role: 'assistant', content: greeting }]);
  save();
  return { call, greeting };
}

export async function reply(callId: string, text: string): Promise<string> {
  const call = db.calls.find((c) => c.id === callId);
  const h = histories.get(callId);
  if (!call || !h) throw new Error('no such call');
  h[0] = { role: 'system', content: system() }; // pick up owner.yaml changes mid-call
  call.turns.push({ at: Date.now(), who: 'caller', text });
  h.push({ role: 'user', content: text });
  for (let step = 0; step < 5; step++) {
    const { msg, proof } = await chat(h, tools);
    h.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const out = await runTool(call, tc.function.name, args);
        call.turns.push({ at: Date.now(), who: 'tool', text: `${tc.function.name}(${JSON.stringify(args)}) → ${JSON.stringify(out)}`, proof });
        h.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      continue;
    }
    const say = (msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    call.turns.push({ at: Date.now(), who: 'agent', text: say, proof });
    save();
    return say;
  }
  save();
  return 'Sorry, give me one moment, could you say that again?';
}

export function endCall(callId: string) {
  const call = db.calls.find((c) => c.id === callId);
  if (call && !call.endedAt) { call.endedAt = Date.now(); save(); }
  histories.delete(callId);
}

export { priceFor }; // for tests
