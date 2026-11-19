import { basename } from 'node:path';
import sax from 'sax';

const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const ENTRY = { urlset: 'url', sitemapindex: 'sitemap' };

function validateCharacters(xml) {
  for (const character of xml) {
    const code = character.codePointAt(0);
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      throw new Error('invalid XML character');
  }
}

function sitemapFailure(parser, names, error) {
  const unfinishedRoot =
    parser.state === sax.STATE.OPEN_TAG ? parser.tagName.split(':').at(-1) : undefined;
  return {
    kind: names.find((name) => name !== undefined) ?? unfinishedRoot ?? doctypeRoot(parser.doctype),
    locations: [],
    error: error.message.split('\n')[0],
  };
}

function doctypeRoot(doctype) {
  if (typeof doctype !== 'string') return undefined;
  return doctype.trimStart().split(/\s|\[/u, 1)[0].split(':').at(-1);
}

/** Parse XML once, retaining only the tree needed to distinguish sitemap locations. */
function parseSitemap(xml) {
  const roots = [];
  const stack = [];
  const attributes = new Set();
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  let declaredRoot;
  let rootName;
  parser.onerror = (error) => {
    throw error;
  };
  parser.onopentagstart = (tag) => {
    attributes.clear();
    rootName ??= tag.name.split(':').at(-1);
  };
  parser.onattribute = (attribute) => {
    const name = `${attribute.uri}\0${attribute.local}`;
    if (attributes.has(name)) throw new Error(`duplicate attribute ${attribute.name}`);
    attributes.add(name);
  };
  parser.onopentag = (tag) => {
    const node = { name: tag.local, namespace: tag.uri, text: '', children: [] };
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  };
  parser.onclosetag = () => stack.pop();
  parser.ontext = parser.oncdata = (text) => {
    if (stack.length) stack.at(-1).text += text;
  };
  parser.ondoctype = (doctype) => {
    declaredRoot = doctypeRoot(doctype);
    throw new Error('sitemaps must not contain a DOCTYPE');
  };
  try {
    parser.write(xml).close();
    validateCharacters(xml);
    if (roots.length !== 1) throw new Error('expected one XML root');
    const root = roots[0];
    if (!Object.hasOwn(ENTRY, root.name) || !['', NAMESPACE].includes(root.namespace))
      return { kind: undefined, locations: [] };
    const locations = root.children
      .filter((node) => node.name === ENTRY[root.name] && node.namespace === root.namespace)
      .map((node) => sitemapLocation(node, root.namespace));
    return { kind: root.name, locations };
  } catch (error) {
    return sitemapFailure(parser, [roots[0]?.name, rootName, declaredRoot], error);
  }
}

function sitemapLocation(entry, namespace) {
  const locations = entry.children.filter(
    (node) => node.name === 'loc' && node.namespace === namespace
  );
  const location = locations[0];
  if (locations.length !== 1 || !location.text.trim() || location.children.length)
    throw new Error(`each ${entry.name} must have one nonempty text-only loc`);
  return location.text.trim();
}

/** XML files are keyed by their exact build paths, without HTML route aliases. */
function sitemapFiles(inventory) {
  const files = new Map();
  for (const name of inventory.files.filter((path) => /\.xml$/iu.test(path)))
    readSitemap(inventory, name, files);
  return files;
}

function readSitemap(inventory, name, files) {
  if (files.has(name)) return { status: 'ok', name, sitemap: files.get(name) };
  const result = inventory.readText(name);
  if (result.status !== 'ok') return result;
  const sitemap = parseSitemap(result.text);
  files.set(name, sitemap);
  return { status: 'ok', name, sitemap };
}

function sitemapUrl(value, siteUrl) {
  const url = URL.parse(value);
  if (!url || !['http:', 'https:'].includes(url.protocol))
    return { error: 'must be an absolute HTTP(S) URL' };
  if (url.username || url.password) return { error: 'must not contain credentials' };
  if (value.includes('#')) return { error: 'must not contain a fragment' };
  if (siteUrl && url.origin !== siteUrl.origin)
    return { error: `must be on SITE_URL (${siteUrl.origin})` };
  return { url };
}

function targetSitemap(value, inventory, files, siteUrl) {
  const { url, error } = sitemapUrl(value, siteUrl);
  if (error) return { error: `Sitemap ${value || '(empty)'} ${error}` };
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\//u, '');
  } catch {
    return { error: `Sitemap ${value} has an invalid encoded path` };
  }
  // Referenced sitemaps may use a custom name without an .xml suffix.
  const target = readSitemap(inventory, path, files);
  if (target.status === 'blocked') return target;
  if (target.status === 'missing') return { error: `Sitemap ${value} is not a built XML sitemap` };
  const { sitemap } = target;
  if (!Object.hasOwn(ENTRY, sitemap.kind))
    return {
      error: `Sitemap ${value} is not a built XML sitemap (expected a urlset or sitemapindex root)`,
    };
  return target;
}

function checkRobots(inventory, discovered, include, add) {
  const result = inventory.readText('robots.txt');
  if (result.status === 'blocked') return;
  const robots = result.status === 'ok' ? result.text.replace(/^\uFEFF/u, '') : '';
  const directives = [...robots.replace(/#.*$/gmu, '').matchAll(/^[\t ]*sitemap[\t ]*:(.*)$/gimu)];
  if (discovered.size && !directives.length)
    add(
      'robots.txt',
      'robots-sitemap',
      'build emits a sitemap; robots.txt must contain a Sitemap directive'
    );
  for (const [, value] of directives) include(value.trim(), 'robots.txt');
}

function checkEntries(name, sitemap, noindexFiles, fileFor, siteUrl, add) {
  for (const location of sitemap.locations) {
    const { url } = sitemapUrl(location, siteUrl);
    if (!url) {
      if (siteUrl)
        add(
          name,
          'robots-sitemap',
          `Page URL ${location} must be an absolute HTTP(S) URL on SITE_URL (${siteUrl.origin}) without credentials or a fragment`
        );
      continue;
    }
    const file = fileFor(url.pathname);
    if (file && noindexFiles.has(file))
      add(
        file,
        'sitemap-noindex',
        `noindex page is listed in ${name}; exclude it with the sitemap filter in astro.config.mjs`
      );
  }
}

/** Inspect all emitted sitemaps and exact local index/robots references without network requests. */
export function checkSitemaps(inventory, noindexFiles, fileFor, siteUrl) {
  const findings = [];
  const add = (file, rule, message) => findings.push({ file, rule, message });
  const files = sitemapFiles(inventory);
  const discovered = new Map(
    [...files].filter(
      ([name, sitemap]) =>
        Object.hasOwn(ENTRY, sitemap.kind) || /^sitemap.*\.xml$/u.test(basename(name))
    )
  );
  const include = (value, source) => {
    const target = targetSitemap(value, inventory, files, siteUrl);
    if (target.error && siteUrl) {
      const remediation =
        source === 'robots.txt'
          ? 'update public/robots.txt'
          : `correct ${source} or its generating configuration`;
      add(source, 'robots-sitemap', `${target.error}; ${remediation}`);
    }
    if (target.status === 'ok') discovered.set(target.name, target.sitemap);
  };
  if (siteUrl) checkRobots(inventory, discovered, include, add);
  for (const [name, sitemap] of discovered) {
    if (sitemap.error || !Object.hasOwn(ENTRY, sitemap.kind)) {
      add(
        name,
        'robots-sitemap',
        `invalid sitemap: ${sitemap.error ?? 'expected a urlset or sitemapindex root'}; repair ${name} or its generating configuration`
      );
      continue;
    }
    if (sitemap.kind === 'urlset') checkEntries(name, sitemap, noindexFiles, fileFor, siteUrl, add);
    else for (const location of sitemap.locations) include(location, name);
  }
  return findings;
}
