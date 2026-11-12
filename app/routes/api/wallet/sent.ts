// The self-sign page reports a signed transaction: if the signer owns a phone wallet whose number is on a call now,
// the agent says it went through. Checked on chain first (status of that hash from that signer).
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

export const Route = createFileRoute('/api/wallet/sent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { db } = await import('../../../../src/store.ts');
        const { rpc } = await import('../../../../src/near.ts');
        const { sayOnCall } = await import('../../../../src/whatsapp.ts');
        const b = await request.json().catch(() => ({}));
        const hash = String(b.hash ?? ''), signer = String(b.signer ?? '');
        if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !signer) return json({ error: 'bad request' }, 400);
        const tx: any = await rpc('tx', { tx_hash: hash, sender_account_id: signer, wait_until: 'EXECUTED_OPTIMISTIC' }).catch(() => null);
        if (!tx || !('SuccessValue' in (tx.status ?? {}))) return json({ ok: false, said: false });
        const t = tx.transaction, deposit = t.actions?.find((a: any) => a.Transfer)?.Transfer?.deposit;
        const what = deposit ? `${(Number(BigInt(deposit)) / 1e24).toFixed(3).replace(/\.?0+$/, '')} NEAR to ${t.receiver_id}` : `your transaction to ${t.receiver_id}`;
        let said = false;
        for (const w of db.wallets.filter((x) => x.owner === signer)) said = sayOnCall(w.phone, `I see it: ${what} went through.`, `The caller signed ${what} from their own account ${signer} (tx ${hash}); it succeeded. This was from their own account, not the phone wallet.`) || said;
        return json({ ok: true, said });
      },
    },
  },
});
