import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import sax from 'sax';
import { walkFiles } from './walk-files.mjs';
import { builtFile } from './build-paths.mjs';

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

/** Parse XML once, retaining only the tree needed to distinguish sitemap locations. */
function parseSitemap(xml) {
  const roots = [];
  const stack = [];
  const attributes = new Set();
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  parser.onopentagstart = () => attributes.clear();
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
  parser.ondoctype = () => {
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
    return { kind: roots[0]?.name, locations: [], error: error.message.split('\n')[0] };
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
function sitemapFiles(dir) {
  const files = new Map();
  for (const path of [...walkFiles(dir, (name) => /\.xml$/iu.test(name))].sort()) {
    const name = relative(dir, path).split(sep).join('/');
    readSitemap(dir, name, files);
  }
  return files;
}

function readSitemap(dir, name, files) {
  const actual = builtFile(dir, name);
  if (actual === undefined) return undefined;
  if (!files.has(actual)) files.set(actual, parseSitemap(readFileSync(join(dir, actual), 'utf8')));
  return [actual, files.get(actual)];
}

function sitemapUrl(value, siteUrl) {
  const url = URL.parse(value);
  if (
    !url ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    value.includes('#')
  )
    return undefined;
  if (siteUrl && url.origin !== siteUrl.origin) return undefined;
  return url;
}

function targetSitemap(value, dir, files, siteUrl, add) {
  const url = sitemapUrl(value, siteUrl);
  if (!url) {
    add(`Sitemap ${value || '(empty)'} must be an absolute URL on SITE_URL (${siteUrl?.origin})`);
    return;
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\//u, '');
  } catch {
    add(`Sitemap ${value} has an invalid encoded path`);
    return;
  }
  // Referenced sitemaps may use a custom name without an .xml suffix.
  const target = readSitemap(dir, path, files);
  if (!target) {
    add(`Sitemap ${value} is not a built XML sitemap`);
    return;
  }
  const [, sitemap] = target;
  if (sitemap.error || !Object.hasOwn(ENTRY, sitemap.kind))
    add(
      `Sitemap ${value} is invalid: ${sitemap.error ?? 'expected a urlset or sitemapindex root'}`
    );
  else return target;
}

function checkRobots(dir, discovered, include, add) {
  const path = join(dir, 'robots.txt');
  const robots = existsSync(path) ? readFileSync(path, 'utf8').replace(/^\uFEFF/u, '') : '';
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
    const url = sitemapUrl(location, siteUrl);
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
export function checkSitemaps(dir, noindexFiles, fileFor, siteUrl) {
  const findings = [];
  const add = (file, rule, message) => findings.push({ file, rule, message });
  const files = sitemapFiles(dir);
  const discovered = new Map(
    [...files].filter(
      ([name, sitemap]) =>
        Object.hasOwn(ENTRY, sitemap.kind) || /^sitemap.*\.xml$/u.test(basename(name))
    )
  );
  const include = (value, source) => {
    const target = targetSitemap(value, dir, files, siteUrl, (message) => {
      if (siteUrl) {
        const remediation =
          source === 'robots.txt'
            ? 'update public/robots.txt'
            : `correct ${source} or its generating configuration`;
        add(source, 'robots-sitemap', `${message}; ${remediation}`);
      }
    });
    if (target) discovered.set(...target);
  };
  if (siteUrl) checkRobots(dir, discovered, include, add);
  for (const [name, sitemap] of discovered) {
    if (sitemap.error || !Object.hasOwn(ENTRY, sitemap.kind)) {
      if (siteUrl)
        add(
          name,
          'robots-sitemap',
          `invalid sitemap: ${sitemap.error ?? 'expected a urlset or sitemapindex root'}`
        );
      continue;
    }
    if (sitemap.kind === 'urlset') checkEntries(name, sitemap, noindexFiles, fileFor, siteUrl, add);
    else for (const location of sitemap.locations) include(location, name);
  }
  return findings;
}
