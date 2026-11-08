// Step 2: code + PIN + the connected NEAR account. Stores the binding (PIN as a salted scrypt hash) and returns what the
// user signs: create phone.<owner>, fund it, deploy the contract, init with owner = them, agent = our agent account.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/bind')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { bind, bindTx } = await import('../../../../src/wallet.ts');
        const { env } = await import('../../../../src/config.ts');
        if (!env.agentAccountId) return json({ error: 'This server has no AGENT_ACCOUNT_ID, so there is no agent to authorise yet.' }, 503);
        const b = await request.json().catch(() => ({}));
        const r = bind({ phone: b.phone, code: b.code, pin: b.pin, owner: String(b.owner ?? '') });
        return r.ok ? json(bindTx(r.binding)) : json({ error: r.reason }, 400);
      },
    },
  },
});
