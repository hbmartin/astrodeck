#!/usr/bin/env node
/**
 * Built-HTML check: scans every .html file in a build output directory.
 * Rules: h1-count, title-empty, title-unique, meta-description, meta-length, internal-link,
 * link-scheme, alt-quality, image-link-name, form-novalidate, sitemap-noindex, canonical,
 * robots-sitemap, demo-leftover (starter mode only).
 * canonical: every indexable page has one self-referencing canonical on the SITE_URL origin
 * and one matching og:url in head. sitemap-noindex: no noindex page is listed in a sitemap.
 * robots-sitemap: emitted sitemaps need a robots.txt declaration; every declared sitemap and
 * nested index reference resolves to sitemap XML in this build on the SITE_URL origin.
 * meta-length mirrors the vibe2prod gates S1/S2: the home page title has 30-60 characters and
 * its description at least 50; no description is longer than 160 characters.
 * Usage: node scripts/check-dist.mjs [--starter] [dir=dist]   (exit 1 on any finding)
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { walkFiles } from './lib/walk-files.mjs';
import { formatFindings } from './lib/findings.mjs';
import { checkImageLinks } from './lib/image-links.mjs';
import { checkCanonical, isNoindex } from './lib/indexing.mjs';
import { checkSitemaps } from './lib/sitemaps.mjs';
import { SITE_URL } from '../src/config/site-url.mjs';

const BAD_ALT = [
  /\.(png|jpe?g|webp|avif|gif|svg)$/i,
  /^(img|image|photo|picture|screenshot|logo|icon|banner|placeholder)[\s_-]*\d*$/i,
  /^IMG_\d+/i,
];
const CREDIT = /<!--\s*astrodeck-credit\s*-->\s*(<a\b[^>]*>[\s\S]*?<\/a>|[^<]*)/g;

/** The build-output file (relative, `/`-separated) a root-relative URL path resolves to. */
function fileFor(dir, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    p = urlPath;
  }
  const base = join(dir, p);
  if (!resolve(base).startsWith(resolve(dir))) return undefined;
  const isFile = (f) => existsSync(f) && statSync(f).isFile();
  const candidates =
    p.endsWith('/') || p === ''
      ? [join(base, 'index.html')]
      : [base, join(base, 'index.html'), `${base}.html`];
  const hit = candidates.find(isFile);
  return hit && relative(dir, hit).split(sep).join('/');
}

const resolves = (dir, urlPath) => fileFor(dir, urlPath) !== undefined;

function isGenericAlt(text, src) {
  if (BAD_ALT.some((re) => re.test(text))) return true;
  const name = basename(src.split(/[?#]/)[0]);
  const stem = name.slice(0, name.length - extname(name).length);
  return name !== '' && [name, stem].some((part) => part.toLowerCase() === text.toLowerCase());
}

function checkImg(img, add) {
  const alt = img.getAttribute('alt');
  const src = img.getAttribute('src') ?? '';
  if (alt === undefined) return add('alt-quality', `<img src="${src}"> has no alt attribute`);
  const text = alt.trim();
  if (alt && !text) add('alt-quality', `whitespace-only alt (src ${src})`);
  if (text && isGenericAlt(text, src))
    add('alt-quality', `generic or filename-like alt "${text}" (src ${src})`);
}

function checkMetadata(root, rel, titles, add) {
  const title = root.querySelector('title')?.text.trim() ?? '';
  if (!title) add('title-empty', '<title> is missing or empty');
  else titles.set(title, [...(titles.get(title) ?? []), rel]);

  const description = root
    .querySelector('meta[name="description"]')
    ?.getAttribute('content')
    ?.trim();
  if (!description) add('meta-description', '<meta name="description"> is missing or empty');
  if (description?.length > 160)
    add('meta-length', `meta description is ${description.length} characters (max 160)`);
  if (rel === 'index.html') checkHomeMetadata(title, description, add);
}

function checkHomeMetadata(title, description, add) {
  if (description && description.length < 50)
    add('meta-length', `home page meta description is ${description.length} characters (50-160)`);
  if (title && (title.length < 30 || title.length > 60))
    add('meta-length', `home page <title> is ${title.length} characters (30-60)`);
}

function checkLinks(root, dir, add) {
  for (const a of root.querySelectorAll('a[href], link[href]')) {
    const href = a.getAttribute('href') ?? '';
    // Whitespace after a tel: or mailto: scheme is invalid HTML.
    if (/^(tel|mailto):/i.test(href) && /\s/.test(href))
      add(
        'link-scheme',
        `href "${href}" contains whitespace (W3C error; write ${href.replace(/\s+/g, '')})`
      );
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const path = href.split('#')[0].split('?')[0];
    if (path && !resolves(dir, path)) add('internal-link', `${href} does not resolve to a file`);
  }
}

function checkForms(root, add) {
  for (const form of root.querySelectorAll('form[novalidate]'))
    if (form.querySelector('[required]'))
      add(
        'form-novalidate',
        `<form action="${form.getAttribute('action') ?? ''}"> has required fields but novalidate (remove novalidate)`
      );
}

function checkDemoLeftovers(html, add) {
  const stripped = html.replace(CREDIT, '');
  if (/\sdata-demo(\s|=|>)/.test(stripped))
    add('demo-leftover', 'data-demo attribute in rendered HTML');
  const hit = stripped.match(/AstroDeck|astrodeck\.dev/i);
  if (hit) add('demo-leftover', `"${hit[0]}" found in rendered HTML`);
}

function checkPage(html, dir, rel, opts, titles, add) {
  const root = parse(html);
  const h1s = root.querySelectorAll('h1').length;
  if (h1s !== 1) add('h1-count', `expected exactly one <h1>, found ${h1s}`);
  checkMetadata(root, rel, titles, add);
  checkLinks(root, dir, add);
  for (const img of root.querySelectorAll('img')) checkImg(img, add);
  checkImageLinks(root, add);
  checkForms(root, add);
  if (opts.starter) checkDemoLeftovers(html, add);
  return root;
}

/**
 * @param {string} dir build output directory
 * @param {{ starter: boolean; siteUrl?: string }} opts siteUrl enables the canonical and
 *   robots-sitemap rules
 * @returns {import('./lib/findings.mjs').Finding[]}
 */
export function checkDist(dir, opts) {
  /** @type {import('./lib/findings.mjs').Finding[]} */
  const findings = [];
  if (!existsSync(dir))
    return [{ file: dir, rule: 'missing-dir', message: 'directory does not exist' }];
  const titles = new Map();
  const noindex = new Set();
  const siteUrl = opts.siteUrl ? new URL(opts.siteUrl) : undefined;
  const fileIn = (urlPath) => fileFor(dir, urlPath);

  for (const abs of [...walkFiles(dir, (name) => name.endsWith('.html'))].sort()) {
    const rel = relative(dir, abs).split(sep).join('/');
    const add = (rule, message) => findings.push({ file: rel, rule, message });
    const root = checkPage(readFileSync(abs, 'utf8'), dir, rel, opts, titles, add);
    if (isNoindex(root)) noindex.add(rel);
    else if (siteUrl) checkCanonical(root, rel, siteUrl, fileIn, add);
  }
  findings.push(...checkSitemaps(dir, noindex, fileIn, siteUrl));

  for (const [title, files] of titles)
    if (files.length > 1)
      for (const f of files)
        findings.push({
          file: f,
          rule: 'title-unique',
          message: `title "${title}" is shared with ${files.length - 1} other page(s)`,
        });

  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const starter = args.includes('--starter');
  const dir = resolve(
    args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, '..', 'dist')
  );
  const findings = checkDist(dir, { starter, siteUrl: SITE_URL });
  if (findings.length) console.error(formatFindings(findings));
  console.log(`check:dist - ${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}
