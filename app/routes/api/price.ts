// The owner's pricing rule exactly as the agent's quote_job tool applies it. Used by the landing page's rule demo.
import { createFileRoute } from '@tanstack/react-router';
import { priceFor } from '../../../src/agent.ts';
import { json, owner } from '../../backend.ts';

export const Route = createFileRoute('/api/price')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const q = new URL(request.url).searchParams;
        const size = (q.get('size') ?? 'medium') as 'small' | 'medium' | 'large';
        const p = priceFor(q.get('service') ?? '', size, Number(q.get('discount') ?? 0));
        const o = owner();
        return json({ result: p, maxDiscountPct: o.rules.max_discount_pct, services: o.services.map((s) => ({ id: s.id, name: s.name })) });
      },
    },
  },
});
