import { createFileRoute } from '@tanstack/react-router';
import { json, snapshot } from '../../backend.ts';

// Owner only. server.ts also gates this path; checked here too so no path variant reaches the data unchecked.
export const Route = createFileRoute('/api/state')({
  server: { handlers: { GET: async ({ request }) => {
    const { env } = await import('../../../src/config.ts');
    const [, b64] = (request.headers.get('authorization') ?? '').split(' ');
    const pw = Buffer.from(b64 ?? '', 'base64').toString().split(':').slice(1).join(':');
    const ok = env.dashboardPassword ? pw === env.dashboardPassword : env.network !== 'mainnet';
    if (!ok) return new Response('', { status: 401, headers: { 'www-authenticate': 'Basic realm="owner"' } });
    return json(await snapshot());
  } } },
});
