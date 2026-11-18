import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDist } from '../scripts/check-dist.mjs';
import { createBuildInventory } from '../scripts/lib/build-paths.mjs';
import { checkSitemaps } from '../scripts/lib/sitemaps.mjs';

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
      'robots.txt robots-sitemap: Sitemap https://example.com/sitemap-0.xml must be on SITE_URL (https://acme.test); update public/robots.txt',
      'robots.txt robots-sitemap: Sitemap https://acme.test/gone.xml is not a built XML sitemap; update public/robots.txt',
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

test('canonical rel uses ASCII-whitespace tokens while robots still accepts commas', (t) => {
  for (const rel of [
    'canonical,alternate',
    'canonical\u00a0alternate',
    'canonical\u000balternate',
  ]) {
    const dir = writeBuild(t, {
      'index.html': page({ canonical: `${ORIGIN}/` }).replace('rel="canonical"', `rel="${rel}"`),
    });
    assert.deepEqual(
      indexing(dir).map((f) => f.rule),
      ['canonical'],
      rel
    );
  }
  for (const rel of ['alternate canonical', 'alternate\tCANONICAL', 'alternate\ncanonical\f']) {
    const dir = writeBuild(t, {
      'index.html': page({ canonical: `${ORIGIN}/` }).replace('rel="canonical"', `rel="${rel}"`),
      'private.html': page({ robots: 'nofollow,noindex' }),
    });
    assert.deepEqual(indexing(dir), [], rel);
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
    [
      ['a&b/index.html', 'sitemap-noindex'],
      ['maps/pages', 'robots-sitemap'],
    ]
  );
});

test('robots and index references cannot escape the output directory', async (t) => {
  for (const source of ['robots', 'index']) {
    await t.test(source, () => {
      const outside = `${ORIGIN}/..%2Foutside.xml`;
      const files = {
        'outside.xml': sitemap('/'),
        'dist/index.html': page({ canonical: `${ORIGIN}/` }),
        'dist/robots.txt': `Sitemap: ${outside}\n`,
      };
      if (source === 'index') {
        files['dist/robots.txt'] = `Sitemap: ${ORIGIN}/sitemap-index.xml\n`;
        files['dist/sitemap-index.xml'] = sitemapIndex('/..%2Foutside.xml');
      }
      const dir = writeBuild(t, files);
      const findings = indexing(join(dir, 'dist'));
      assert.ok(findings.some((f) => f.rule === 'robots-sitemap' && f.message.includes(outside)));
    });
  }
});

test('internal links cannot resolve into a sibling with the build directory prefix', (t) => {
  const href = '/..%2Fdist-sibling%2Foutside.html';
  const dir = writeBuild(t, {
    'dist/index.html': page().replace('</body>', `<a href="${href}">Outside</a></body>`),
    'dist-sibling/outside.html': page(),
  });
  const findings = checkDist(join(dir, 'dist'), { starter: false }).filter(
    (f) => f.rule === 'internal-link'
  );
  assert.deepEqual(
    findings.map((f) => f.message),
    [`${href} does not resolve to a file`]
  );
});

test('sitemap references and HTML links enforce directory and filename case', async (t) => {
  for (const path of ['/maps/Pages.xml', '/Maps/pages.xml']) {
    await t.test(path, () => {
      const dir = writeBuild(t, {
        'index.html': page().replace('</body>', `<a href="${path}">Map</a></body>`),
        'Maps/Pages.xml': sitemap('/'),
        'robots.txt': `Sitemap: ${ORIGIN}${path}\n`,
      });
      const findings = checkDist(dir, { starter: false, siteUrl: ORIGIN });
      assert.ok(findings.some((f) => f.rule === 'internal-link' && f.message.includes(path)));
      assert.ok(findings.some((f) => f.rule === 'robots-sitemap' && f.message.includes(path)));
    });
  }
});

test('HTML aliases and percent-encoded filenames retain their resolution behavior', (t) => {
  const paths = [
    '/',
    '/guide',
    '/guide/',
    '/guide.html',
    '/space%20name.txt',
    '/100%25.txt',
    '/%2520.txt',
  ];
  const links = paths.map((path) => `<a href="${path}">Page</a>`).join('');
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }).replace('</body>', `${links}</body>`),
    'guide/index.html': page({ canonical: `${ORIGIN}/guide` }),
    'guide.html': page({ canonical: `${ORIGIN}/guide.html` }),
    'space name.txt': '',
    '100%.txt': '',
    '%20.txt': '',
  });
  const findings = checkDist(dir, { starter: false, siteUrl: ORIGIN });
  assert.deepEqual(
    findings.filter((f) => f.rule === 'internal-link' || INDEXING.has(f.rule)),
    []
  );
});

test('exact Unicode URLs and encoded sitemap names find actual build files', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }),
    'cafe\u0301/index.html': page({ canonical: `${ORIGIN}/cafe%CC%81/` }),
    'Maps/space name.xml': sitemap('/', '/cafe%CC%81/'),
    'Maps/100%.xml': sitemap('/'),
    'Maps/%20.xml': sitemap('/'),
    'robots.txt': `Sitemap: ${ORIGIN}/Maps/space%20name.xml\nSitemap: ${ORIGIN}/Maps/100%25.xml\nSitemap: ${ORIGIN}/Maps/%2520.xml\n`,
  });
  assert.deepEqual(indexing(dir), []);
});

test('page sitemap locations must be absolute HTTP(S) URLs on the production origin', async (t) => {
  const invalid = [
    'not-a-url',
    '/thanks/',
    'ftp://acme.test/thanks/',
    'http://acme.test/thanks/',
    'https://other.test/thanks/',
    `${ORIGIN}/thanks/#section`,
    `${ORIGIN}/thanks/#`,
    `https://user:password@acme.test/thanks/`,
  ];
  for (const location of invalid) {
    await t.test(location, () => {
      const dir = writeBuild(t, {
        'index.html': page({ canonical: `${ORIGIN}/` }),
        'thanks/index.html': page({ robots: 'noindex' }),
        'sitemap.xml': `<urlset><url><loc>${location}</loc></url></urlset>`,
        'robots.txt': `Sitemap: ${ORIGIN}/sitemap.xml\n`,
      });
      const findings = indexing(dir);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].file, 'sitemap.xml');
      assert.equal(findings[0].rule, 'robots-sitemap');
      assert.ok(findings[0].message.includes(location));
    });
  }
});

test('BOM-prefixed robots accepts same-origin custom pages outside the build', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }),
    'sitemap.xml': sitemap('/', '/account/'),
    'robots.txt': `\uFEFFSitemap: ${ORIGIN}/sitemap.xml\n`,
  });
  assert.deepEqual(indexing(dir), []);
});

test('invalid sitemap references identify the source to correct', (t) => {
  const dir = writeBuild(t, {
    'index.html': page({ canonical: `${ORIGIN}/` }),
    'sitemap-index.xml': sitemapIndex('/missing.xml'),
    'robots.txt': `Sitemap: ${ORIGIN}/sitemap-index.xml\nSitemap: https://other.test/pages.xml\n`,
  });
  const findings = indexing(dir);
  const robots = findings.find((f) => f.file === 'robots.txt');
  const index = findings.find((f) => f.file === 'sitemap-index.xml');
  assert.match(robots.message, /update public\/robots\.txt/u);
  assert.match(index.message, /correct sitemap-index\.xml or its generating configuration/u);
  assert.doesNotMatch(index.message, /public\/robots\.txt/u);
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

test('truncated documents and incomplete trailing markup fail with and without siteUrl', async (t) => {
  const documents = [
    '<urlset>',
    '<urlset><url><loc>https://acme.test/</loc></url>',
    '<urlset></urlset',
    ...['<', '<!--', '<?pi', '<!'].map((suffix) => `<urlset/>${suffix}`),
    '<!DOCTYPE urlset><urlset/>',
  ];
  for (const xml of documents) {
    await t.test(xml, () => {
      const dir = writeBuild(t, {
        'sitemap.xml': xml,
        'robots.txt': `Sitemap: ${ORIGIN}/sitemap.xml\n`,
      });
      for (const opts of [{ starter: false }, { starter: false, siteUrl: ORIGIN }]) {
        const findings = indexing(dir, opts);
        assert.equal(findings.length, 1);
        assert.equal(findings[0].file, 'sitemap.xml');
        assert.match(findings[0].message, /invalid sitemap:.*repair sitemap\.xml/u);
        assert.doesNotMatch(findings[0].message, /public\/robots/u);
      }
    });
  }
});

test('a malformed target referenced repeatedly is reported once at the target file', (t) => {
  const dir = writeBuild(t, {
    'sitemap-index.xml': sitemapIndex('/maps/broken', '/maps/broken', '/sitemap-index.xml'),
    'another.xml': sitemapIndex('/maps/broken'),
    'maps/broken': '<urlset><url/></urlset>',
    'unrelated.xml': '<rss><unfinished>',
    'robots.txt': `Sitemap: ${ORIGIN}/sitemap-index.xml\nSitemap: ${ORIGIN}/maps/broken\n`,
  });
  for (const opts of [{ starter: false }, { starter: false, siteUrl: ORIGIN }]) {
    const findings = indexing(dir, opts);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'maps/broken');
    assert.match(findings[0].message, /repair maps\/broken or its generating configuration/u);
  }
});

test('unreferenced sitemap roots are discovered before attribute or DOCTYPE errors', (t) => {
  for (const xml of [
    '<urlset',
    '<sitemapindex',
    '<s:urlset',
    '<?xml version="1.0"?>\n<!-- comment --><urlset',
    '<urlset x="&bad;"><url><loc>https://acme.test/</loc></url></urlset>',
    '<urlset x="1" x="2"/>',
    '<!DOCTYPE s:urlset><s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
  ]) {
    const dir = writeBuild(t, {
      'archive/maps.xml': xml,
      'sitemap.xml': sitemap('/'),
      'robots.txt': `Sitemap: ${ORIGIN}/sitemap.xml\n`,
    });
    for (const opts of [{ starter: false }, { starter: false, siteUrl: ORIGIN }]) {
      const findings = indexing(dir, opts);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].file, 'archive/maps.xml');
      assert.match(findings[0].message, /invalid sitemap/u);
    }
  }
});

test('unfinished sitemap-looking text inside unrelated XML is not a discovered sitemap', (t) => {
  for (const xml of ['<rss', '<rss><urlset', '<!-- <urlset', '<![CDATA[<urlset', '<urlsetting']) {
    const dir = writeBuild(t, { 'archive/maps.xml': xml });
    assert.deepEqual(indexing(dir), [], xml);
    assert.deepEqual(indexing(dir, { starter: false }), [], xml);
  }
});

test('reference diagnostics explain credentials and fragments without blaming the origin', (t) => {
  const dir = writeBuild(t, {
    'sitemap.xml': sitemapIndex('/pages.xml#fragment'),
    'pages.xml': sitemap('/'),
    'robots.txt': `Sitemap: ${ORIGIN}/sitemap.xml\nSitemap: https://user:pass@acme.test/pages.xml\n`,
  });
  const findings = indexing(dir);
  assert.equal(findings.length, 2);
  const credentials = findings.find((f) => f.file === 'robots.txt');
  const fragment = findings.find((f) => f.file === 'sitemap.xml');
  assert.match(credentials.message, /must not contain credentials; update public\/robots/u);
  assert.match(fragment.message, /must not contain a fragment; correct sitemap\.xml/u);
  assert.ok(findings.every((f) => !f.message.includes('must be on SITE_URL')));
});

test('sitemap I/O errors are not misreported as invalid XML or missing robots', (t) => {
  const dir = writeBuild(t, {
    'sitemap.xml': sitemap('/'),
    'robots.txt': `Sitemap: ${ORIGIN}/sitemap.xml\n`,
  });
  for (const unreadable of ['robots.txt', 'sitemap.xml']) {
    const inventory = createBuildInventory(dir, {
      readFileSync(path) {
        if (path.endsWith(unreadable))
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        return unreadable === 'robots.txt' ? sitemap('/') : `Sitemap: ${ORIGIN}/sitemap.xml\n`;
      },
    });
    assert.deepEqual(
      checkSitemaps(inventory, new Set(), () => undefined, new URL(ORIGIN)),
      []
    );
    assert.equal(inventory.findings.length, 1);
    assert.equal(inventory.findings[0].file, unreadable);
    assert.equal(inventory.findings[0].rule, 'build-io');
  }
});

test('build symlinks produce findings even when no page links to them', (t) => {
  const dir = writeBuild(t, { 'index.html': page({ canonical: `${ORIGIN}/` }) });
  symlinkSync('index.html', join(dir, 'copy.html'));
  symlinkSync('missing', join(dir, 'unused-directory'));
  const findings = checkDist(dir, { starter: false, siteUrl: ORIGIN });
  assert.deepEqual(
    findings.filter((f) => f.rule.startsWith('build-')).map((f) => f.rule),
    ['build-symlink', 'build-symlink']
  );
});

test('normalization-equivalent URLs do not hide incorrect canonical or sitemap file spelling', (t) => {
  const dir = writeBuild(t, {
    'cafe\u0301/index.html': page({ canonical: `${ORIGIN}/caf%C3%A9/` }).replace(
      '</body>',
      '<a href="/caf%C3%A9/">Cafe</a></body>'
    ),
    'cafe\u0301.xml': sitemap('/'),
    'robots.txt': `Sitemap: ${ORIGIN}/caf%C3%A9.xml\n`,
  });
  const findings = checkDist(dir, { starter: false, siteUrl: ORIGIN });
  assert.deepEqual(
    rules(findings.filter((f) => INDEXING.has(f.rule) || f.rule === 'internal-link')),
    ['canonical', 'internal-link', 'robots-sitemap']
  );
});
