import { createFileRoute } from '@tanstack/react-router';
import { attest } from '../../../src/ai.ts';
import { db, env, json, owner } from '../../backend.ts';

export const Route = createFileRoute('/api/state')({
  server: {
    handlers: {
      GET: async () => {
        const a = await attest().catch((e) => ({ error: String(e.message) }));
        return json({ owner: owner(), attestation: a, model: env.llmModel, calls: db.calls.slice(-30).reverse(), jobs: db.jobs.slice(-30).reverse(), ledger: db.ledger.slice(-100).reverse() });
      },
    },
  },
});
