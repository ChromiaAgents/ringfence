import { createFileRoute } from '@tanstack/react-router';
import { depositStatus } from '../../../../src/pay.ts';
import { log } from '../../../../src/store.ts';
import { findJob, json, publicJob } from '../../../backend.ts';

export const Route = createFileRoute('/api/pay/$jobId/status')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const job = findJob(params.jobId);
        if (!job) return json({ error: 'no such job' }, 404);
        if (!job.payment?.quote.depositAddress) return json(publicJob(job));
        const s = await depositStatus(job.payment.quote.depositAddress, job.payment.quote.depositMemo);
        if (s.status !== job.payment.status) {
          job.payment.status = s.status;
          job.payment.updatedAt = Date.now();
          log({ kind: 'payment', jobId: job.id, detail: `${s.status}: $${job.depositUsd} deposit via ${job.payment.originSymbol} on ${job.payment.chain}` });
        }
        return json(publicJob(job));
      },
    },
  },
});
