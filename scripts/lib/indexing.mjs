/**
 * Built-page indexing metadata. `fileFor(urlPath)` maps a URL path to the built HTML file
 * (relative to the build directory) or returns undefined.
 */
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
  const head = root.querySelector('head');
  const links = (head?.querySelectorAll('link[rel]') ?? []).filter((link) =>
    tokens(link.getAttribute('rel')).includes('canonical')
  );
  if (links.length !== 1)
    return add('canonical', `expected one <link rel="canonical">, found ${links.length}`);
  const href = links[0].getAttribute('href') ?? '';
  const url = URL.parse(href);
  if (url?.origin !== siteUrl.origin)
    return add('canonical', `canonical ${href} is not on SITE_URL (${siteUrl.origin})`);
  const target = fileFor(url.pathname);
  if (target !== rel)
    add('canonical', `canonical ${href} points at ${target ?? 'a missing page'}, not this page`);
  const ogTags = head.querySelectorAll('meta[property="og:url"]');
  if (ogTags.length !== 1)
    return add('canonical', `expected one og:url in head, found ${ogTags.length}`);
  const ogUrl = ogTags[0].getAttribute('content');
  if (ogUrl !== href) add('canonical', `og:url ${ogUrl} differs from the canonical ${href}`);
}
