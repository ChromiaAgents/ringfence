// After the wallet signs, the page reports the hash; we read the result back from chain rather than trusting the page.
import { createFileRoute } from '@tanstack/react-router';
import { confirmJustHoot } from '../../../../src/justhoot.ts';
import { log, save } from '../../../../src/store.ts';
import { findLaunch, json, publicLaunch } from '../../../backend.ts';

export const Route = createFileRoute('/api/launch/$id/signed')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const l = findLaunch(params.id);
        if (!l) return json({ error: 'no such launch' }, 404);
        const { txHash, signer } = await request.json().catch(() => ({}));
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(String(txHash)) || !signer) return json({ error: 'bad hash' }, 400);
        try {
          const r = await confirmJustHoot(String(txHash), String(signer));
          Object.assign(l, { txHash, signer, status: r.ok ? 'live' : 'failed', tokenId: r.tokenId, reason: r.reason });
          save();
          const what = `live on JustHoot${r.tokenId ? ` as ${r.tokenId}` : ''}`;
          log({ kind: 'launch_signed', desk: 'launch', launchId: l.id, callId: l.callId, detail: r.ok ? `$${l.params.symbol} is ${what} on ${l.network}, signed by ${signer}` : `tx ${txHash}: ${r.reason}` });
          const { announce } = await import('../../../../src/agent.ts');
          announce(l.callId, r.ok ? `It's live! $${l.params.symbol} is trading on JustHoot now. Congrats!` : `The launch didn't go through: ${String(r.reason ?? 'the transaction failed').slice(0, 80)}.`,
            r.ok ? `The caller signed the launch: $${l.params.symbol} is live on JustHoot as ${r.tokenId ?? 'a token'} (tx ${txHash}). You already told them.` : `The launch transaction failed: ${r.reason}. You already told them.`);
          return json(publicLaunch(l));
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      },
    },
  },
});
