// Step 1 of binding: a 6-digit code to the WhatsApp number, proving the caller holds it.
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

const last = new Map<string, number>();

export const Route = createFileRoute('/api/wallet/code')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { digits, newCode } = await import('../../../../src/wallet.ts');
        const { env } = await import('../../../../src/config.ts');
        const { sendText } = await import('../../../../src/whatsapp.ts');
        const phone = digits((await request.json().catch(() => ({}))).phone);
        if (phone.length < 8 || phone.length > 15) return json({ error: 'Enter your WhatsApp number with country code.' }, 400);
        if (Date.now() - (last.get(phone) ?? 0) < 60_000) return json({ error: 'A code was just sent. Wait a minute.' }, 429);
        last.set(phone, Date.now());
        const code = newCode(phone);
        if (!env.waToken) { console.log(`[wallet] no WhatsApp token: code for ${phone} is ${code}`); return json({ sent: false, note: 'WhatsApp is not configured on this server; the code is in the server log.' }); }
        await sendText(phone, `Your callhand wallet code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this.`);
        return json({ sent: true });
      },
    },
  },
});
