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
    ...[ogUrl || []].flat().map((url) => `<meta property="og:url" content="${url}">`),
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
    indexing(dir)
      .map((f) => `${f.file} ${f.rule}: ${f.message}`)
      .sort(),
    [
      'about/index.html canonical: canonical https://acme.test/old/ points at a missing page, not this page',
      'contact/index.html canonical: og:url https://acme.test/ differs from the canonical https://acme.test/contact/',
      'index.html canonical: canonical https://example.com/ is not on SITE_URL (https://acme.test)',
      'team/index.html canonical: expected one <link rel="canonical">, found 2',
      'thanks/index.html sitemap-noindex: noindex page is listed in sitemap-0.xml; exclude it with the sitemap filter in astro.config.mjs',
      'robots.txt robots-sitemap: Sitemap https://example.com/sitemap-0.xml must be an absolute URL on SITE_URL (https://acme.test); update public/robots.txt',
      'robots.txt robots-sitemap: Sitemap https://acme.test/gone.xml is not a built XML sitemap',
    ].sort()
  );
});

test('canonical and og:url must each appear once inside head', async (t) => {
  const cases = {
    'body-only canonical': page({ ogUrl: `${ORIGIN}/` }).replace(
      '<body>',
      `<body><link rel="canonical" href="${ORIGIN}/">`
    ),
    'missing og:url': page({ canonical: `${ORIGIN}/`, ogUrl: false }),
    'body-only og:url': page({ canonical: `${ORIGIN}/`, ogUrl: false }).replace(
      '<body>',
      `<body><meta property="og:url" content="${ORIGIN}/">`
    ),
    'duplicate og:url': page({
      canonical: `${ORIGIN}/`,
      ogUrl: [`${ORIGIN}/`, `${ORIGIN}/other/`],
    }),
  };
  for (const [name, html] of Object.entries(cases)) {
    await t.test(name, () => {
      const findings = indexing(writeBuild(t, { 'index.html': html }));
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'canonical');
    });
  }
});

const sitemapIndex = (...paths) =>
  `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<sitemap><loc>${ORIGIN}${p}</loc></sitemap>`).join('')}</sitemapindex>`;

test('sitemap indexes, aliases and unrelated XML pass with a valid robots directive', (t) => {
  const index = sitemapIndex('/maps/pages.xml');
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }),
    'sitemap-index.xml': index,
    'sitemap.xml': index,
    'maps/pages.xml': sitemap('/'),
    'feed.xml': '<rss><channel><title>News</title></channel></rss>',
    'robots.txt': `User-agent: *\r\n  sItEmAp : ${ORIGIN}/sitemap-index.xml # main index\r\n`,
  });
  assert.deepEqual(indexing(dir), []);
});

test('a build without sitemaps or Sitemap directives passes', (t) => {
  for (const files of [{}, { 'robots.txt': 'User-agent: *\nAllow: /\n' }]) {
    const dir = writeBuild(t, { 'index.html': page({ canonical: `${ORIGIN}/` }), ...files });
    assert.deepEqual(indexing(dir), []);
  }
});

test('emitted sitemaps require robots discovery and actual XML sitemap targets', async (t) => {
  const cases = {
    'missing robots.txt': {},
    'missing directive': { 'robots.txt': 'User-agent: *\nAllow: /\n' },
    'blank directive': { 'robots.txt': 'Sitemap: # supply a URL\n' },
    'relative URL': { 'robots.txt': 'Sitemap: /sitemap-0.xml\n' },
    'HTML homepage': { 'robots.txt': `Sitemap: ${ORIGIN}/\n` },
    'HTML alias': {
      'robots.txt': `Sitemap: ${ORIGIN}/fake.xml\n`,
      'fake.xml.html': '<h1>HTML</h1>',
    },
    'unrelated XML': { 'robots.txt': `Sitemap: ${ORIGIN}/feed.xml\n`, 'feed.xml': '<rss/>' },
    'malformed XML': {
      'robots.txt': `Sitemap: ${ORIGIN}/maps/bad.xml\n`,
      'maps/bad.xml': '<urlset><url></urlset>',
    },
    'invalid index reference': {
      'robots.txt': `Sitemap: ${ORIGIN}/sitemap-index.xml\n`,
      'sitemap-index.xml': sitemapIndex('/feed.xml'),
      'feed.xml': '<rss/>',
    },
  };
  for (const [name, files] of Object.entries(cases)) {
    await t.test(name, () => {
      const dir = writeBuild(t, {
        'index.html': page({ canonical: `${ORIGIN}/` }),
        'sitemap-0.xml': sitemap('/'),
        ...files,
      });
      const findings = indexing(dir);
      assert.ok(
        findings.some((f) => f.rule === 'robots-sitemap'),
        name
      );
    });
  }
});

test('nested sitemap XML decodes locations and distinguishes page and extension entries', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }),
    'a&b/index.html': page({ robots: 'noindex' }),
    'images/index.html': page({ robots: 'none' }),
    'sitemap-index.xml': sitemapIndex('/maps/deeper.xml'),
    'maps/deeper.xml': sitemapIndex('/maps/pages', '/sitemap-index.xml'),
    'maps/pages': `<s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <!-- <url><loc>${ORIGIN}/images/</loc></url> -->
      <s:url><s:loc>${ORIGIN}/a&amp;b/</s:loc></s:url>
      <s:url><s:loc><![CDATA[${ORIGIN}/]]></s:loc><image:image><image:loc>${ORIGIN}/images/</image:loc></image:image></s:url>
      <s:url><s:loc>https://other.test/images/</s:loc></s:url>
    </s:urlset>`,
    'robots.txt': `Sitemap: ${ORIGIN}/sitemap-index.xml\n`,
  });
  const findings = indexing(dir);
  assert.deepEqual(
    findings.map((f) => [f.file, f.rule]),
    [['a&b/index.html', 'sitemap-noindex']]
  );
});

test('malformed sitemap structure is reported even with a valid robots URL', async (t) => {
  for (const xml of [
    '<urlset/><urlset/>',
    '<urlset><url/></urlset>',
    '<urlset><url><loc>&unknown;</loc></url></urlset>',
    '<urlset x="1" x="2"/>',
    '<urlset>\u0001</urlset>',
  ]) {
    await t.test(xml, () => {
      const dir = writeBuild(t, {
        'index.html': page({ canonical: `${ORIGIN}/` }),
        'sitemap-0.xml': xml,
        'robots.txt': `Sitemap: ${ORIGIN}/sitemap-0.xml\n`,
      });
      assert.ok(indexing(dir).some((f) => f.rule === 'robots-sitemap'));
    });
  }
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
