// The exact transaction for a given signer, and its NEAR cost, from the contract's own views. Read-only.
import { createFileRoute } from '@tanstack/react-router';
import { buildJustHootTx, justhootArgs, justhootCost } from '../../../../src/justhoot.ts';
import { findLaunch, json } from '../../../backend.ts';

export const Route = createFileRoute('/api/launch/$id/tx')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const l = findLaunch(params.id);
        if (!l) return json({ error: 'no such launch' }, 404);
        const signer = new URL(request.url).searchParams.get('signer') ?? '';
        if (!/^[a-z0-9._-]{2,64}$/.test(signer)) return json({ error: 'connect a wallet first' }, 400);
        try {
          const args = justhootArgs(l.params);
          const cost = await justhootCost(args, signer);
          return json({ tx: buildJustHootTx(args, cost), cost: { createDeposit: cost.launchDeposit, registerDeposit: cost.registerDeposit, totalYocto: cost.totalYocto, gas: cost.gas, tokenId: cost.tokenId } });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      },
    },
  },
});
