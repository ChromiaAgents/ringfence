// Optional: fund a launch from any chain via NEAR Intents 1Click. Mainnet only (1Click has no testnet).
import { createFileRoute } from '@tanstack/react-router';
import { listTokens, quoteFunding } from '../../../../src/pay.ts';
import { findLaunch, json } from '../../../backend.ts';

export const Route = createFileRoute('/api/fund/$id')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const l = findLaunch(params.id);
        if (!l) return json({ error: 'no such launch' }, 404);
        if (l.network !== 'mainnet') return json({ error: 'Funding through NEAR Intents is mainnet only.' }, 400);
        const { originAsset, refundTo, recipient, yocto } = await request.json().catch(() => ({}));
        const t = (await listTokens()).find((x) => x.assetId === originAsset);
        if (!t || !refundTo || !/^[a-z0-9._-]{2,64}$/.test(String(recipient)) || !/^\d{1,30}$/.test(String(yocto))) return json({ error: 'pick a token, a refund address and connect your wallet' }, 400);
        if (BigInt(yocto) > 5n * 10n ** 24n) return json({ error: 'Funding is for the launch cost only (5 NEAR max).' }, 400);
        try {
          const quote = await quoteFunding({ yocto: String(yocto), recipient: String(recipient), originAsset, refundTo: String(refundTo).trim(), dry: false });
          return json({ quote, symbol: t.symbol, chain: t.blockchain });
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      },
    },
  },
});
