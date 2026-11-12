/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import css from '../styles/app.css?url';
import skin from '../styles/dark-room.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Ringfence: a phone call is the wallet, on NEAR' }, { name: 'theme-color', content: '#0c0a08' },
      { name: 'description', content: 'A phone call is the wallet. Pay, send money packets, top up from any chain through NEAR Intents, launch a coin and gift in live rooms, by WhatsApp or browser call. A NEAR contract caps what the AI may spend; the AI runs privately on NEAR AI Cloud. Built at NEAR HACKATHON 2026.' },
      { property: 'og:type', content: 'website' }, { property: 'og:site_name', content: 'Ringfence' },
      { property: 'og:title', content: 'Ringfence: a phone call is the wallet, on NEAR' },
      { property: 'og:description', content: 'A phone call is the wallet. Pay, send money packets, top up from any chain through NEAR Intents, launch a coin and gift in live rooms, by WhatsApp or browser call. A NEAR contract caps what the AI may spend; the AI runs privately on NEAR AI Cloud. Built at NEAR HACKATHON 2026.' },
      { property: 'og:url', content: 'https://ringfence.evalengine.ai/' },
      { property: 'og:image', content: 'https://ringfence.evalengine.ai/og.png' }, { property: 'og:image:width', content: '1200' }, { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Ringfence: a phone call is the wallet. WhatsApp calls, money packets, NEAR contract limits, top up via NEAR Intents, launch on JustHoot, live-room gifts.' },
      { name: 'twitter:card', content: 'summary_large_image' }, { name: 'twitter:image', content: 'https://ringfence.evalengine.ai/og.png' },
      { name: 'twitter:title', content: 'Ringfence: a phone call is the wallet, on NEAR' },
      { name: 'twitter:description', content: 'Pay, gift and send money packets by phone call. A NEAR contract caps what the AI can spend. Built at NEAR HACKATHON 2026 #NEARHackathon.' }, { name: 'twitter:site', content: '@NEARProtocol' },
      { name: 'keywords', content: 'NEAR, NEAR Protocol, NEAR AI, NEAR Intents, WhatsApp wallet, voice payments, red packet, money packet, AI agent, crypto by phone call, live stream gifts, JustHoot, NEARON, NEAR HACKATHON, NEAR Hackathon 2026, NEARHackathon, NEAR hackathon project, Social Money, Real-World Money, AI agent wallet' }],
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
