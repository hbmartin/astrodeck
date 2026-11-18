import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/config/site-url.mjs';
import { includeDemoPage } from './scripts/lib/sitemap-filter.mjs';
import { documentationLinksPlugin } from './scripts/lib/documentation-links-plugin.mjs';

// Set a subpath here when needed; sitemap exclusions use the same base.
const base = '/';

export default defineConfig({
  site: SITE_URL,
  base,
  integrations: [
    react(),
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      // Keep noindex pages out of the sitemap (check:dist rule sitemap-noindex).
      // These two are demo pages; 404 is excluded by the integration itself.
      filter: (page) => includeDemoPage(page, base),
      // No lastmod: a build-time date would mark every page as changed on every deploy
    }),
  ],
  vite: {
    plugins: [tailwindcss(), documentationLinksPlugin()],
  },
});
