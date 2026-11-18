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
      // Keep noindex pages out of the sitemap (check:dist rule sitemap-noindex).
      // These two are demo pages; 404 is excluded by the integration itself.
      filter: (page) => !['/login', '/thanks'].includes(new URL(page).pathname.replace(/\/$/, '')),
      // No lastmod: a build-time date would mark every page as changed on every deploy
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
