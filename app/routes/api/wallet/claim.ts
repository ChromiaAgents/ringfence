// Claim a custodial wallet: code to the bound phone + the connected account -> custody proposes it as owner;
// then the page has them sign accept_owner, and {action:'done'} checks the chain and forgets custody control.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/claim')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { startClaim, finishClaim } = await import('../../../../src/wallet.ts');
        const b = await request.json().catch(() => ({}));
        const r = b.action === 'done' ? await finishClaim(String(b.phone ?? '').replace(/\D/g, ''))
          : await startClaim({ phone: String(b.phone ?? ''), code: String(b.code ?? ''), newOwner: String(b.owner ?? '') }).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e).slice(0, 160) }));
        return r.ok ? json(r) : json({ error: r.reason }, 400);
      },
    },
  },
});
