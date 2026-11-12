// Unbind: the server forgets which wallet this number uses. Needs the one-use proof from a link sent on the caller's call.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/unbind')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { unbind } = await import('../../../../src/wallet.ts');
        const b = await request.json().catch(() => ({}));
        const r = unbind(String(b.phone ?? ''), String(b.proof ?? ''));
        return r.ok ? json(r) : json({ error: r.reason }, 400);
      },
    },
  },
});
