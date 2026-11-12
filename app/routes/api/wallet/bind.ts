// Step 2: code + PIN + the connected NEAR account. Stores the binding (PIN as a salted scrypt hash) and returns what the
// user signs: one call to the factory, create_wallet, with owner = them (or the guardian), agent = our agent account.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/bind')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { bind, bindTx } = await import('../../../../src/wallet.ts');
        const b = await request.json().catch(() => ({}));
        const r = bind({ phone: b.phone, code: b.code, pin: b.pin, owner: String(b.owner ?? ''), proof: b.proof });
        if (!r.ok) return json({ error: r.reason }, 400);
        return json(bindTx(r.binding));
      },
    },
  },
});
