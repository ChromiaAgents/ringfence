/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import css from '../styles/app.css?url';
import skin from '../styles/dark-room.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Ringfence' }, { name: 'theme-color', content: '#0c0a08' }],
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
