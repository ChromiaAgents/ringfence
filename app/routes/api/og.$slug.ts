// Public: live share cards (/api/og/stats, /api/og/wallets) with today's numbers; falls back to the static card.
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/og/$slug')({
  server: { handlers: { GET: async ({ params }) => {
    const slug = params.slug.replace(/\.png$/, '');
    if (slug !== 'stats' && slug !== 'wallets') return new Response('not found', { status: 404 });
    const headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' };
    try { const { liveCard } = await import('../../../src/og.ts'); return new Response(new Uint8Array(await liveCard(slug)), { headers }); }
    catch { return Response.redirect(`https://ringfence.evalengine.ai/og/${slug}.png`, 302); }
  } } },
});
