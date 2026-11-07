import { createFileRoute } from '@tanstack/react-router';
import { findLaunch, json, publicLaunch } from '../../../backend.ts';

export const Route = createFileRoute('/api/launch/$id')({
  server: { handlers: { GET: ({ params }) => { const l = findLaunch(params.id); return l ? json(publicLaunch(l)) : json({ error: 'no such launch' }, 404); } } },
});
