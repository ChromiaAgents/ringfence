// Public: the TEE attestation of every model, verified by this server (Intel TDX quote + NVIDIA GPU via NRAS).
// ?fresh=1 re-fetches with a new nonce instead of using the 10-minute cache.
import { createFileRoute } from '@tanstack/react-router';
import { json, attestationAll } from '../../backend.ts';

export const Route = createFileRoute('/api/proof')({
  server: { handlers: { GET: async ({ request }) => json(await attestationAll(new URL(request.url).searchParams.has('fresh'))) } },
});
