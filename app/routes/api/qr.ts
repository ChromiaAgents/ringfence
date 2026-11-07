import { createFileRoute } from '@tanstack/react-router';
import QRCode from 'qrcode';

export const Route = createFileRoute('/api/qr')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const text = new URL(request.url).searchParams.get('text') ?? '';
        return new Response(await QRCode.toString(text, { type: 'svg', margin: 0 }), { headers: { 'content-type': 'image/svg+xml' } });
      },
    },
  },
});
