import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/config/site-url.mjs';

export default defineConfig({
  site: SITE_URL,
  integrations: [
    react(),
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      // These utility pages are marked noindex where rendered.
      filter: (page) =>
        !['/404', '/login', '/thanks'].includes(new URL(page).pathname.replace(/\/$/, '')),
      // No lastmod: a build-time date would mark every page as changed on every deploy
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
