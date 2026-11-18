/**
 * Built-page indexing metadata. `fileFor(urlPath)` maps a URL path to the built HTML file
 * (relative to the build directory) or returns undefined.
 */
import { findElements, elementName, attribute } from './html-tree.mjs';

const tokens = (value = '') => value.toLowerCase().split(/[\s,]+/u);
const relTokens = (value = '') => value.toLowerCase().split(/[\t\n\f\r ]+/u);

/** True when a robots meta tag asks search engines not to index the page. */
export function isNoindex(root) {
  return findElements(root, (node) => elementName(node) === 'meta')
    .filter((meta) => attribute(meta, 'name')?.toLowerCase() === 'robots')
    .some((meta) =>
      tokens(attribute(meta, 'content')).some((token) => token === 'noindex' || token === 'none')
    );
}

/** An indexable page has one canonical on the production origin that points at itself. */
export function checkCanonical(root, rel, siteUrl, fileFor, add) {
  const head = findElements(root, (node) => elementName(node) === 'head')[0];
  const links = findElements(
    head,
    (node) =>
      elementName(node) === 'link' && relTokens(attribute(node, 'rel')).includes('canonical')
  );
  if (links.length !== 1)
    return add('canonical', `expected one <link rel="canonical">, found ${links.length}`);
  const href = attribute(links[0], 'href') ?? '';
  const url = URL.parse(href);
  if (url?.origin !== siteUrl.origin)
    return add('canonical', `canonical ${href} is not on SITE_URL (${siteUrl.origin})`);
  const target = fileFor(url.pathname);
  if (target !== rel)
    add('canonical', `canonical ${href} points at ${target ?? 'a missing page'}, not this page`);
  const ogTags = findElements(
    head,
    (node) => elementName(node) === 'meta' && attribute(node, 'property') === 'og:url'
  );
  if (ogTags.length !== 1)
    return add('canonical', `expected one og:url in head, found ${ogTags.length}`);
  const ogUrl = attribute(ogTags[0], 'content');
  if (ogUrl !== href) add('canonical', `og:url ${ogUrl} differs from the canonical ${href}`);
}
