// Step 1 of binding or claiming: a 6-digit code to the WhatsApp number, proving the caller holds it. The code is for one
// action and one account, and the message says which ("links this number to a wallet owned by X" / "gives ownership to X").
import { createFileRoute } from '@tanstack/react-router';
import { json } from '../../../backend.ts';

const last = new Map<string, number>();

export const Route = createFileRoute('/api/wallet/code')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { digits, newCode, codeText, ownerOk, devServer } = await import('../../../../src/wallet.ts');
        const { env } = await import('../../../../src/config.ts');
        const { sendText } = await import('../../../../src/whatsapp.ts');
        const b = await request.json().catch(() => ({}));
        const phone = digits(b.phone), purpose = b.purpose === 'claim' ? 'claim' : 'bind', owner = String(b.owner ?? '');
        if (phone.length < 8 || phone.length > 15) return json({ error: 'Enter your WhatsApp number with country code.' }, 400);
        if (!ownerOk(owner)) return json({ error: 'Connect your NEAR wallet first.' }, 400);
        if (Date.now() - (last.get(phone) ?? 0) < 60_000) return json({ error: 'A code was just sent. Wait a minute.' }, 429);
        if (!env.waToken && !devServer()) return json({ error: 'WhatsApp is not configured on this server.' }, 503);
        last.set(phone, Date.now());
        const code = newCode(phone, purpose, owner);
        if (!env.waToken) { console.log(`[wallet] dev server, no WhatsApp token: ${purpose} code for ${phone} is ${code}`); return json({ sent: false, note: 'WhatsApp is not configured on this server; the code is in the server log.' }); }
        try { await sendText(phone, codeText(code, purpose, owner)); return json({ sent: true }); } catch (e: any) {
          // Meta blocks texts until business verification: if this number is on a WhatsApp call right now, the code goes
          // to that call's live panel (only someone on that call has the panel code) and the agent says it.
          console.error('bind code text', String(e?.message ?? e).slice(0, 120));
          const { db } = await import('../../../../src/store.ts');
          const { liveLink } = await import('../../../../src/live.ts');
          const { noteToModel } = await import('../../../../src/agent.ts');
          const call = [...db.calls].reverse().find((c) => c.channel === 'whatsapp' && !c.endedAt && c.from === phone);
          if (!call) { const { dropCode } = await import('../../../../src/wallet.ts'); dropCode(phone); return json({ error: `WhatsApp can't text this number yet (Meta verification pending). Call ${env.publicUrl.includes('ringfence') ? '+1 555-144-4220' : 'our WhatsApp line'} from this number and say "bind my wallet": the code shows on your live panel.` }, 503); }
          const say = liveLink(call.id, { label: `Your ${purpose} code: ${code}`, url: `${env.publicUrl}/wallet/${purpose}` });
          noteToModel(call.id, `The ${purpose} code could not be texted, so it is on the caller's live panel${say ? ' (you just told them the panel code)' : ''}. If they ask, the code is ${code.split('').join(', ')}.`);
          return json({ sent: true, panel: true, note: 'WhatsApp could not text you, so the code is on your live panel (/live).' });
        }
      },
    },
  },
});
