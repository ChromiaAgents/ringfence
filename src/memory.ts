// Caller memory: when a known number calls back, the agent gets a short recap of earlier calls,
// and an unfinished coin draft carries over. Built from the local db; it only leaves this machine
// inside the system prompt sent to the TEE model.
// ponytail: drafts live in memory, so carry-over survives hang-up but not a server restart.
import { db, type Call } from './store.ts';
import { env } from './config.ts';
import { draftOf, carryDraft } from './desks/launch.ts';

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function earlier(call: Call) {
  if (!call.from) return [];
  return db.calls.filter((c) => c.from === call.from && c.id !== call.id && c.turns.some((t) => t.who === 'caller'));
}

export const isKnown = (call: Call) => earlier(call).length > 0;

/** Copies an unfinished draft from the caller's latest call; returns the coin it carried, if any. */
export function resume(call: Call): { ticker?: string; name?: string } | null {
  const prev = earlier(call).filter((c) => !c.launchId).reverse().find((c) => draftOf(c.id).symbol || draftOf(c.id).name);
  if (!prev) return null;
  const d = draftOf(prev.id);
  carryDraft(prev.id, call.id);
  return { ticker: d.symbol, name: d.name };
}

/** A few lines for the system prompt; empty for a first-time caller. */
export function recap(call: Call): string {
  const prev = earlier(call).slice(-3);
  // The bound wallet (never balances: those are read live by the wallet desk).
  const w = call.from ? db.wallets.find((x) => x.phone === call.from!.replace(/\D/g, '')) : undefined;
  const wallet = w ? `\nThis number is bound to the NEAR ${env.network} wallet ${w.contract} (owner ${w.owner}).` : '';
  if (!prev.length) return wallet;
  const lines = prev.map((c) => {
    const bits = [`${day(c.startedAt)}, ${c.desk ?? 'no'} desk`];
    if (c.caller?.name) bits.push(`name ${c.caller.name}`);
    const l = db.launches.find((x) => x.callId === c.id);
    if (l) bits.push(`coin ${l.params.name} (${l.params.symbol}) on ${l.launchpad === 'justhoot' ? 'JustHoot' : 'meme.cooking'}, ${l.status}`);
    else {
      const d = draftOf(c.id);
      if (d.symbol || d.name) bits.push(`unfinished coin draft ${d.name ?? ''}${d.symbol ? ` (${d.symbol})` : ''}${d.pad ? ` for ${d.pad === 'justhoot' ? 'JustHoot' : 'meme.cooking'}` : ''}`);
    }
    const said = c.turns.filter((t) => t.who === 'caller').slice(-2).map((t) => `"${t.text.slice(0, 80)}"`).join(', ');
    if (said) bits.push(`they last said ${said}`);
    return `- ${bits.join('; ')}`;
  });
  return `\nThis caller has called before (same number). Earlier calls:\n${lines.join('\n')}\nGreet them like you remember them, use their name if you know it, and offer to pick up where they left off. Don't recite this list.${wallet}`;
}
