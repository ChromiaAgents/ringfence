// After the bind page signs create_wallet: tell the caller's WhatsApp call (if one is on) that the wallet is ready.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/bound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { digits, bindingOf, proofOk, walletOnChain } = await import('../../../../src/wallet.ts');
        const { sayOnCall } = await import('../../../../src/whatsapp.ts');
        const b = await request.json().catch(() => ({}));
        const phone = digits(b.phone);
        const w = bindingOf(phone);
        if (!proofOk(b.proof, phone)) return json({ error: 'Open a fresh link from your call.' }, 403);
        const wallet = await walletOnChain(phone); // the factory's record, never the page's word
        if (!w) return json({ error: 'No binding for that number.' }, 404);
        const said = sayOnCall(phone, `Your wallet is ready${wallet && !/^[0-9a-f]{12,}$/.test(wallet.split('.')[0]) ? `: ${wallet.split('.')[0]} dot ringfence-wallet dot near` : ''}. Fund it with a little NEAR, then tell me what to send.`,
          `The caller's own phone wallet is now created${wallet ? ` (${wallet})` : ''} and bound to this number with their PIN. From now on sends, packets and top-ups use it, not the demo wallet.`);
        return json({ ok: true, said });
      },
    },
  },
});
