/**
 * Search-indexing checks for the built site: canonical URLs, noindex pages in the sitemap and
 * the robots.txt sitemap location. `fileFor(urlPath)` maps a URL path to the built HTML file
 * (relative to the build directory) or returns undefined.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const tokens = (value = '') => value.toLowerCase().split(/[\s,]+/u);

/** True when a robots meta tag asks search engines not to index the page. */
export function isNoindex(root) {
  return root
    .querySelectorAll('meta[name]')
    .filter((meta) => meta.getAttribute('name')?.toLowerCase() === 'robots')
    .some((meta) =>
      tokens(meta.getAttribute('content')).some((token) => token === 'noindex' || token === 'none')
    );
}

/** An indexable page has one canonical on the production origin that points at itself. */
export function checkCanonical(root, rel, siteUrl, fileFor, add) {
  const links = root
    .querySelectorAll('link[rel]')
    .filter((link) => tokens(link.getAttribute('rel')).includes('canonical'));
  if (links.length !== 1)
    return add('canonical', `expected one <link rel="canonical">, found ${links.length}`);
  const href = links[0].getAttribute('href') ?? '';
  const url = URL.parse(href);
  if (url?.origin !== siteUrl.origin)
    return add('canonical', `canonical ${href} is not on SITE_URL (${siteUrl.origin})`);
  const target = fileFor(url.pathname);
  if (target !== rel)
    add('canonical', `canonical ${href} points at ${target ?? 'a missing page'}, not this page`);
  const ogUrl = root.querySelector('meta[property="og:url"]')?.getAttribute('content');
  if (ogUrl !== undefined && ogUrl !== href)
    add('canonical', `og:url ${ogUrl} differs from the canonical ${href}`);
}

/** Pages marked noindex must not be listed in any sitemap*.xml at the build root. */
export function checkSitemaps(dir, noindexFiles, fileFor) {
  const findings = [];
  const sitemaps = readdirSync(dir).filter((n) => /^sitemap.*\.xml$/u.test(n));
  for (const name of sitemaps.sort()) {
    const xml = readFileSync(join(dir, name), 'utf8');
    for (const [, loc] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gu)) {
      const file = fileFor(URL.parse(loc)?.pathname ?? '');
      if (file && noindexFiles.has(file))
        findings.push({
          file,
          rule: 'sitemap-noindex',
          message: `noindex page is listed in ${name}; exclude it with the sitemap filter in astro.config.mjs`,
        });
    }
  }
  return findings;
}

/** Every Sitemap line in robots.txt points at a sitemap of this build on the production origin. */
export function checkRobots(dir, siteUrl, fileFor) {
  const path = join(dir, 'robots.txt');
  if (!existsSync(path)) return [];
  const findings = [];
  const add = (message) => findings.push({ file: 'robots.txt', rule: 'robots-sitemap', message });
  for (const [, value] of readFileSync(path, 'utf8').matchAll(/^\s*sitemap\s*:\s*(\S+)/gimu)) {
    const url = URL.parse(value);
    if (url?.origin !== siteUrl.origin)
      add(`Sitemap ${value} is not on SITE_URL (${siteUrl.origin}); update public/robots.txt`);
    else if (!fileFor(url.pathname)) add(`Sitemap ${value} is not in the build`);
  }
  return findings;
}
