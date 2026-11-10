// Public numbers about the line: counts and totals only. Nothing here is taken from what anyone said: no transcripts,
// no phone numbers, no packet words, no account names. /dashboard (the owner's, behind a password) keeps those.
import { db } from './store.ts';
import { env } from './config.ts';
import { yoctoToNear } from './near.ts';
import { live } from './wallet.ts';
import { packetsLive } from './packets.ts';

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export function publicStats() {
  const turns = db.calls.flatMap((c) => c.turns);
  const refused = db.ledger.filter((l) => l.kind === 'refused').map((l) => l.detail);
  const sends = db.ledger.filter((l) => l.kind === 'wallet' && !/^approved on WhatsApp|held payment|custodial wallet/.test(l.detail)).map((l) => l.detail);
  const count = (xs: string[], re: RegExp) => xs.filter((x) => re.test(x)).length;
  const real = db.packets.filter((p) => !p.dryRun);
  return {
    network: env.network,
    realMoney: live(), realPackets: packetsLive(),
    since: db.calls[0]?.startedAt ?? null,
    calls: { total: db.calls.length, browser: db.calls.filter((c) => c.channel === 'web').length, whatsapp: db.calls.filter((c) => c.channel === 'whatsapp').length },
    replies: turns.filter((t) => t.who === 'agent').length,
    medianReplyMs: median(turns.map((t) => t.timing?.firstAudioMs ?? t.timing?.llmMs).filter((x): x is number => typeof x === 'number')),
    wallets: { total: db.wallets.filter((w) => !w.dryRun).length, phoneOnly: db.wallets.filter((w) => w.custodial && !w.dryRun).length },
    sends: { onChain: count(sends, /nearblocks/), dryRun: count(sends, /DRY RUN|BROWSER DEMO/) },
    packets: {
      made: db.packets.length, onChain: real.length,
      sharesOpened: db.packets.reduce((n, p) => n + p.claims.length, 0),
      nearGiven: Math.round(db.packets.reduce((n, p) => n + p.claims.reduce((m, c) => m + yoctoToNear(c.yocto), 0), 0) * 1e4) / 1e4,
      nearGivenOnChain: Math.round(real.reduce((n, p) => n + p.claims.reduce((m, c) => m + yoctoToNear(c.yocto), 0), 0) * 1e4) / 1e4,
    },
    refused: {
      total: refused.length,
      overLimit: count(refused, /limit/i),
      wrongPin: count(refused, /PIN/),
      wrongWords: count(refused, /words were not said/),
      notMe: count(refused, /Not me|Rejected on WhatsApp/),
    },
    filteredReplies: db.ledger.filter((l) => l.kind === 'filtered').length,
    models: { chat: env.llmModel, speech: env.sttModel },
  };
}
export type PublicStats = ReturnType<typeof publicStats>;
