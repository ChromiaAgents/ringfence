import { createFileRoute } from '@tanstack/react-router';
import { findJob, json, publicJob } from '../../../backend.ts';

export const Route = createFileRoute('/api/pay/$jobId')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const job = findJob(params.jobId);
        return job ? json(publicJob(job)) : json({ error: 'no such job' }, 404);
      },
    },
  },
});
