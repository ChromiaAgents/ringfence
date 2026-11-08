import { createFileRoute } from '@tanstack/react-router';
import { listTokens } from '../../../src/fund.ts';
import { json } from '../../backend.ts';

export const Route = createFileRoute('/api/tokens')({
  server: {
    handlers: {
      GET: async () => {
        const t = await listTokens();
        return json(t.filter((x) => x.price > 0).map(({ assetId, blockchain, symbol, decimals, price }) => ({ assetId, blockchain, symbol, decimals, price })));
      },
    },
  },
});
