/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import css from '../styles/app.css?url';
import skin from '../styles/dark-room.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Ringfence' }, { name: 'theme-color', content: '#0c0a08' },
      { name: 'description', content: 'Mum can make a phone call. She doesn’t know how to use MetaMask. Ringfence lets her pay by phone call; a NEAR contract the family owns sets what the AI may spend.' },
      { property: 'og:type', content: 'website' }, { property: 'og:site_name', content: 'Ringfence' },
      { property: 'og:title', content: 'Ringfence: pay by phone call, inside limits your family sets' },
      { property: 'og:description', content: 'Mum can make a phone call. She doesn’t know how to use MetaMask. A NEAR contract the family owns caps what the AI can spend.' },
      { property: 'og:url', content: 'https://ringfence.evalengine.ai/' },
      { property: 'og:image', content: 'https://ringfence.evalengine.ai/og.png' }, { property: 'og:image:width', content: '1200' }, { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Ringfence: Mum can make a phone call. She doesn’t know how to use MetaMask.' },
      { name: 'twitter:card', content: 'summary_large_image' }, { name: 'twitter:image', content: 'https://ringfence.evalengine.ai/og.png' },
      { name: 'twitter:title', content: 'Ringfence: pay by phone call, inside limits your family sets' },
      { name: 'twitter:description', content: 'A NEAR contract the family owns caps what the AI can spend.' }],
    links: [{ rel: 'preload', href: '/fonts/geist-latin.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' }, { rel: 'preload', href: '/fonts/battlefin-black.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' }, { rel: 'stylesheet', href: css }, { rel: 'stylesheet', href: skin }, { rel: 'icon', href: '/favicon.svg' }],
  }),
  component: () => <Doc><Outlet /></Doc>,
});

function Doc({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
