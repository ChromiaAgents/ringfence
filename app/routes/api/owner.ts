// The owner desk from the dashboard: one conversation per page session, text in, text out. Behind DASHBOARD_PASSWORD.
import { createFileRoute } from '@tanstack/react-router';
import { reply, startCall } from '../../../src/agent.ts';
import { db, json } from '../../backend.ts';

export const Route = createFileRoute('/api/owner')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { callId, text } = await request.json().catch(() => ({}));
        let call = db.calls.find((c) => c.id === callId && c.desk === 'owner' && c.channel === 'dashboard');
        if (!call) {
          const s = startCall('dashboard', undefined, 'owner');
          call = s.call;
          if (!text) return json({ callId: call.id, say: s.greeting });
        }
        if (!String(text ?? '').trim()) return json({ error: 'say something' }, 400);
        try {
          return json({ callId: call.id, say: await reply(call.id, String(text).slice(0, 500)) });
        } catch (e: any) {
          return json({ callId: call.id, error: e.message }, 502);
        }
      },
    },
  },
});
