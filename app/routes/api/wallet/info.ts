// The bound wallet behind a number, with live balances. Needs the one-use proof from a link sent on that number's call
// (it is not consumed here), so nobody can look up which wallet a phone number has.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/info')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { proofOk, bindingOf, digits, walletState, ftBalance } = await import('../../../../src/wallet.ts');
        const { env } = await import('../../../../src/config.ts');
        const u = new URL(request.url);
        const phone = digits(u.searchParams.get('phone') ?? ''), proof = u.searchParams.get('proof') ?? '';
        if (!proofOk(proof, phone)) return json({ error: 'Open a fresh link from your call.' }, 403);
        const b = bindingOf(phone);
        if (!b) return json({ bound: false });
        const s: any = await walletState(b).catch(() => null);
        const usdc = await ftBalance(env.usdcToken, b.contract).catch(() => null);
        return json({ bound: true, wallet: b.contract, owner: b.owner, near: s?.balance ?? null, usdc, limits: s ? { perTx: s.near_limit?.per_tx, perDay: s.near_limit?.per_day, delay: s.new_recipient_delay_sec } : null, saved: s?.allowlist ?? [] });
      },
    },
  },
});
