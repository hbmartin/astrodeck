import { list, siteOrigin, sitePath } from './site-check-config.mjs';

const tokens = (text = '') => text.toLowerCase().split(/[\s,]+/u);

export function expectedMetadata(origin, pages) {
  const base = siteOrigin(origin);
  const expected = new Map();

  for (const { file, path, indexable } of list(pages, 'pages')) {
    if (
      typeof file !== 'string' ||
      !/^[\w.-]+(?:\/[\w.-]+)*\.html$/u.test(file) ||
      file.split('/').some((segment) => segment === '..' || segment === '.')
    ) {
      throw new Error('Set each file to a relative generated HTML path.');
    }
    if (typeof indexable !== 'boolean')
      throw new Error('Set indexable to true or false for ' + file);
    if (expected.has(file)) throw new Error('Duplicate expected HTML file: ' + file);
    expected.set(file, { canonical: sitePath(path, base).href, indexable });
  }
  return expected;
}

export function checkPageMetadata(root, expected, add) {
  const head = root.querySelector('head');
  if (!head) return add('seo-head', 'expected a document head');

  const titles = head.querySelectorAll('title');
  const descriptions = head.querySelectorAll('meta[name="description"]');
  const canonicals = head
    .querySelectorAll('link[rel]')
    .filter((node) => tokens(node.getAttribute('rel')).includes('canonical'));
  const ogURLs = head.querySelectorAll('meta[property="og:url"]');
  const robots = head
    .querySelectorAll('meta[name]')
    .filter((node) => node.getAttribute('name')?.toLowerCase() === 'robots');
  const noindex = robots.some((node) =>
    tokens(node.getAttribute('content')).some((token) => token === 'noindex' || token === 'none')
  );

  if (titles.length !== 1 || !titles[0].text.trim())
    add('seo-title', 'expected exactly one nonempty title in head');
  if (descriptions.length !== 1 || !descriptions[0].getAttribute('content')?.trim())
    add('seo-description', 'expected exactly one nonempty meta description in head');
  if (canonicals.length !== 1 || canonicals[0].getAttribute('href') !== expected.canonical)
    add('seo-canonical', 'expected one canonical: ' + expected.canonical);
  if (ogURLs.length !== 1 || ogURLs[0].getAttribute('content') !== expected.canonical)
    add('seo-og-url', 'expected one og:url matching the canonical');
  if (noindex === expected.indexable)
    add('seo-robots', 'robots meta disagrees with expected indexability');
}
