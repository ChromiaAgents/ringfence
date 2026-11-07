import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';

// The UI lives in app/ (TanStack Start). src/ holds the call, AI and payment modules.
// server.ts runs Vite in middleware mode so voice + WhatsApp share the port; installDevServerMiddleware keeps Start's SSR on.
export default defineConfig({
  plugins: [tanstackStart({ srcDirectory: 'app', vite: { installDevServerMiddleware: true } }), viteReact()],
  ssr: { external: ['werift', 'opusscript', 'kokoro-js', 'ethers', 'sharp'] },
});
