// Step 2: code + PIN + the connected NEAR account. Stores the binding (PIN as a salted scrypt hash) and returns what the
// user signs: one call to the factory, create_wallet, with owner = them (or the guardian), agent = our agent account.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/bind')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { bind, bindTx, walletOnChain } = await import('../../../../src/wallet.ts');
        const b = await request.json().catch(() => ({}));
        const r = bind({ phone: b.phone, code: b.code, pin: b.pin, owner: String(b.owner ?? ''), proof: b.proof });
        if (!r.ok) return json({ error: r.reason }, 400);
        // The factory keeps one wallet per number for good: binding again re-uses it, nothing to sign.
        const existing = await walletOnChain(r.binding.phone).catch(() => null);
        if (existing) {
          // Re-using a wallet already on chain for this number: only if this caller owns it (a freed phone_hash can be
          // claimed on chain by anyone, so never trust the factory record alone).
          const { view } = await import('../../../../src/near.ts');
          const { env } = await import('../../../../src/config.ts');
          const st: any = await view('get_state', {}, env.network, existing).catch(() => null);
          if (!st || st.owner !== r.binding.owner) {
            const { db, save } = await import('../../../../src/store.ts');
            db.wallets = db.wallets.filter((w) => w.phone !== r.binding.phone); save();
            return json({ error: `This number already has a wallet on chain (${existing}) owned by another account. Connect that account, or contact us.` }, 409);
          }
        }
        if (existing && r.binding.contract !== existing) { const { save } = await import('../../../../src/store.ts'); r.binding.contract = existing; save(); }
        const { sayOnCall } = await import('../../../../src/whatsapp.ts');
        if (existing) sayOnCall(r.binding.phone, 'Done, your number is linked to your wallet again. Ask me your balance any time.', `The caller re-bound this number to their existing wallet ${existing} with a new PIN. From now on use it, not the demo wallet.`);
        else sayOnCall(r.binding.phone, 'Got your PIN. Now tap Sign and create on the page, and I will tell you when the wallet is ready.', 'The caller saved their PIN on the bind page and is now signing create_wallet. Wait for them; the server tells you when it is done.');
        return json({ ...bindTx(r.binding), existing });
      },
    },
  },
});
