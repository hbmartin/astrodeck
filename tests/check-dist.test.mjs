import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDist } from '../scripts/check-dist.mjs';

const FIX = join(import.meta.dirname, 'fixtures');
const rules = (findings) => [...new Set(findings.map((f) => f.rule))].sort();

test('good fixture has no findings in both modes', () => {
  assert.deepEqual(checkDist(join(FIX, 'dist-good'), { starter: false }), []);
  assert.deepEqual(checkDist(join(FIX, 'dist-good'), { starter: true }), []);
});

test('bad fixture triggers each rule', () => {
  const f = checkDist(join(FIX, 'dist-bad'), { starter: true });
  assert.deepEqual(rules(f), [
    'alt-quality',
    'demo-leftover',
    'form-novalidate',
    'h1-count',
    'image-link-name',
    'internal-link',
    'link-scheme',
    'meta-description',
    'meta-length',
    'title-empty',
    'title-unique',
  ]);
  const altMessages = f.filter((x) => x.rule === 'alt-quality').map(({ message }) => message);
  assert.equal(altMessages.length, 3);
  for (const src of ['/img/hero.png', '/b.png', '/blank.png']) {
    assert.ok(
      altMessages.some((message) => message.includes(src)),
      src
    );
  }
  assert.deepEqual(
    f.filter((x) => x.rule === 'image-link-name').map((x) => x.message),
    ['Image link to "/" has no accessible name', 'Image link to "/dup.html" has no accessible name']
  );
  assert.equal(f.filter((x) => x.rule === 'title-unique').length, 2);
  assert.deepEqual(
    f.filter((x) => x.rule === 'link-scheme').map((x) => x.message),
    [
      'href "tel:0511 000000" contains whitespace (W3C error; write tel:0511000000)',
      'href "mailto: hallo@example.org" contains whitespace (W3C error; write mailto:hallo@example.org)',
    ]
  );
  // vibe2prod gates S1/S2: home title 30-60 characters, descriptions 50-160 (max on every page)
  assert.deepEqual(
    f.filter((x) => x.rule === 'meta-length').map((x) => `${x.file}: ${x.message}`),
    [
      'dup.html: meta description is 179 characters (max 160)',
      'index.html: home page <title> is 4 characters (30-60)',
    ]
  );
});

test('demo-leftover only fires in starter mode', () => {
  const f = checkDist(join(FIX, 'dist-bad'), { starter: false });
  assert.ok(!rules(f).includes('demo-leftover'));
});

test('form-novalidate flags forms with required fields and novalidate, not optional-only forms', () => {
  const f = checkDist(join(FIX, 'dist-bad'), { starter: false }).filter(
    (x) => x.rule === 'form-novalidate'
  );
  assert.equal(f.length, 1);
  assert.equal(f[0].file, 'index.html');
  assert.match(f[0].message, /novalidate/);
  assert.match(f[0].message, /action="\/x"/);
});

// Indexing rules: canonical, sitemap-noindex, robots-sitemap. Each case writes a small build.
const ORIGIN = 'https://acme.test';
const INDEXING = new Set(['canonical', 'sitemap-noindex', 'robots-sitemap']);

function page({ canonical, ogUrl = canonical, robots } = {}) {
  const head = [
    ...[canonical ?? []].flat().map((href) => `<link rel="canonical" href="${href}">`),
    ogUrl ? `<meta property="og:url" content="${ogUrl}">` : '',
    robots ? `<meta name="robots" content="${robots}">` : '',
  ].join('');
  return `<!doctype html><html><head>${head}</head><body><h1>Page</h1></body></html>`;
}

function writeBuild(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-dist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const sitemap = (...paths) =>
  `<urlset>${paths.map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join('')}</urlset>`;
const indexing = (dir, opts = { starter: false, siteUrl: ORIGIN }) =>
  checkDist(dir, opts).filter((f) => INDEXING.has(f.rule));

test('indexing rules pass for self-canonical pages, a clean sitemap and matching robots', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }),
    'about/index.html': page({ canonical: `${ORIGIN}/about/` }),
    // noindex pages need no canonical
    '404.html': page({ robots: 'noindex, nofollow' }),
    'sitemap-0.xml': sitemap('/', '/about/'),
    'robots.txt': `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap-0.xml\n`,
  });
  assert.deepEqual(indexing(dir), []);
});

test('indexing rules flag wrong canonicals, listed noindex pages and a foreign sitemap', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: 'https://example.com/' }),
    'about/index.html': page({ canonical: `${ORIGIN}/old/` }),
    'team/index.html': page({ canonical: [`${ORIGIN}/team/`, `${ORIGIN}/`] }),
    'contact/index.html': page({ canonical: `${ORIGIN}/contact/`, ogUrl: `${ORIGIN}/` }),
    'thanks/index.html': page({ robots: 'none' }),
    'sitemap-0.xml': sitemap('/', '/thanks/'),
    'robots.txt':
      'Sitemap: https://example.com/sitemap-0.xml\nSitemap: https://acme.test/gone.xml\n',
  });
  assert.deepEqual(
    indexing(dir).map((f) => `${f.file} ${f.rule}: ${f.message}`),
    [
      'about/index.html canonical: canonical https://acme.test/old/ points at a missing page, not this page',
      'contact/index.html canonical: og:url https://acme.test/ differs from the canonical https://acme.test/contact/',
      'index.html canonical: canonical https://example.com/ is not on SITE_URL (https://acme.test)',
      'team/index.html canonical: expected one <link rel="canonical">, found 2',
      'thanks/index.html sitemap-noindex: noindex page is listed in sitemap-0.xml; exclude it with the sitemap filter in astro.config.mjs',
      'robots.txt robots-sitemap: Sitemap https://example.com/sitemap-0.xml is not on SITE_URL (https://acme.test); update public/robots.txt',
      'robots.txt robots-sitemap: Sitemap https://acme.test/gone.xml is not in the build',
    ]
  );
});

test('without siteUrl only sitemap-noindex runs', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: 'https://example.com/elsewhere/' }),
    'thanks/index.html': page({ robots: 'noindex' }),
    'sitemap-0.xml': sitemap('/thanks/'),
    'robots.txt': 'Sitemap: https://example.com/sitemap-0.xml\n',
  });
  assert.deepEqual(
    indexing(dir, { starter: false }).map((f) => `${f.file} ${f.rule}`),
    ['thanks/index.html sitemap-noindex']
  );
});
