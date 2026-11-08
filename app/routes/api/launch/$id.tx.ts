// The exact transaction for a given signer, and its NEAR cost, from the contract's own views. Read-only.
import { createFileRoute } from '@tanstack/react-router';
import { buildTx, createMemeArgs, launchCost, pinReference } from '../../../../src/memecook.ts';
import { buildJustHootTx, justhootArgs, justhootCost } from '../../../../src/justhoot.ts';
import { findLaunch, json } from '../../../backend.ts';

const refs = new Map<string, { reference: string; reference_hash: string }>(); // pin once per launch

export const Route = createFileRoute('/api/launch/$id/tx')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const l = findLaunch(params.id);
        if (!l) return json({ error: 'no such launch' }, 404);
        const signer = new URL(request.url).searchParams.get('signer') ?? '';
        if (!/^[a-z0-9._-]{2,64}$/.test(signer)) return json({ error: 'connect a wallet first' }, 400);
        try {
          if (l.launchpad === 'justhoot') {
            const args = justhootArgs(l.params);
            const cost = await justhootCost(args, signer);
            return json({ tx: buildJustHootTx(args, cost), cost: { createDeposit: cost.launchDeposit, registerDeposit: cost.registerDeposit, totalYocto: cost.totalYocto, gas: cost.gas, tokenId: cost.tokenId } });
          }
          if (!refs.has(l.id)) refs.set(l.id, await pinReference(l.params));
          const args = createMemeArgs(l.params, refs.get(l.id)!, l.network);
          const cost = await launchCost(args, signer, l.network);
          return json({ tx: buildTx(args, cost, l.network), cost });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      },
    },
  },
});
