// The launch desk's ticker and name rules exactly as its set_coin tool applies them. Used by the landing page demo.
import { createFileRoute } from '@tanstack/react-router';
import { checkName, checkTicker } from '../../../src/desks/launch.ts';
import { json, launchpad } from '../../backend.ts';

export const Route = createFileRoute('/api/ticker')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams;
        const lp = launchpad();
        const name = q.get('name') ?? '';
        const n = name ? checkName(name, lp) : { ok: true as const };
        const t = checkTicker(q.get('ticker') ?? '', lp);
        return json({ result: !n.ok ? n : t });
      },
    },
  },
});
