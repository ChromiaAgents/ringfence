// After the wallet signs, the page reports the hash; we read the result back from chain rather than trusting the page.
import { createFileRoute } from '@tanstack/react-router';
import { confirmTx } from '../../../../src/memecook.ts';
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
          const jh = l.launchpad === 'justhoot';
          const r: { ok: boolean; memeId?: number; tokenId?: string; reason?: string } = jh ? await confirmJustHoot(String(txHash), String(signer)) : await confirmTx(String(txHash), String(signer), l.network);
          Object.assign(l, { txHash, signer, status: r.ok ? 'live' : 'failed', memeId: r.memeId, tokenId: r.tokenId, reason: r.reason });
          save();
          const what = jh ? `live on JustHoot${r.tokenId ? ` as ${r.tokenId}` : ''}` : `meme #${r.memeId}`;
          log({ kind: 'launch_signed', desk: 'launch', launchId: l.id, callId: l.callId, detail: r.ok ? `$${l.params.symbol} is ${what} on ${l.network}, signed by ${signer}` : `tx ${txHash}: ${r.reason}` });
          return json(publicLaunch(l));
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      },
    },
  },
});
