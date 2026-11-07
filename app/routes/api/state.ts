import { createFileRoute } from '@tanstack/react-router';
import { json, snapshot } from '../../backend.ts';

export const Route = createFileRoute('/api/state')({
  server: { handlers: { GET: async () => json(await snapshot()) } },
});
