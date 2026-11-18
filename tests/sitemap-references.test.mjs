import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDist } from '../scripts/check-dist.mjs';
import { createBuildInventory } from '../scripts/lib/build-paths.mjs';
import { checkSitemaps } from '../scripts/lib/sitemaps.mjs';

const ORIGIN = 'https://acme.test';
const sitemapIndex = (...paths) =>
  `<sitemapindex>${paths.map((path) => `<sitemap><loc>${ORIGIN}${path}</loc></sitemap>`).join('')}</sitemapindex>`;

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-sitemap-references-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const sitemapFindings = (dir, siteUrl = ORIGIN) =>
  checkDist(dir, { starter: false, siteUrl }).filter(
    (finding) => finding.rule === 'robots-sitemap'
  );

test('robots and index references to plain text or unrelated XML identify the source', async (t) => {
  for (const source of ['robots.txt', 'maps/index.xml']) {
    for (const xml of [
      '',
      'not XML',
      '<rss/>',
      '<rss><channel>',
      '<html><body>page</body></html>',
    ]) {
      await t.test(`${source}: ${xml || '(empty)'}`, () => {
        const target = 'maps/pages.xml';
        const files = { [target]: xml };
        if (source === 'robots.txt') files[source] = `Sitemap: ${ORIGIN}/${target}\n`;
        else {
          files[source] = sitemapIndex(`/${target}`);
          files['robots.txt'] = `Sitemap: ${ORIGIN}/${source}\n`;
        }
        const dir = fixture(t, files);
        const findings = sitemapFindings(dir);
        assert.equal(findings.length, 1);
        assert.equal(findings[0].file, source);
        assert.match(findings[0].message, /not a built XML sitemap/u);
        assert.doesNotMatch(findings[0].message, /invalid sitemap:|repair maps\/pages/u);
        if (source === 'robots.txt')
          assert.match(findings[0].message, /update public\/robots\.txt/u);
        else {
          assert.match(
            findings[0].message,
            /correct maps\/index\.xml or its generating configuration/u
          );
          assert.doesNotMatch(findings[0].message, /public\/robots\.txt/u);
        }
        assert.deepEqual(checkDist(dir, { starter: false }), []);
      });
    }
  }
});

test('malformed identifiable sitemaps referenced by robots and indexes report the target once', async (t) => {
  for (const xml of [
    '<urlset',
    '<s:urlset',
    '<urlset><url/></urlset>',
    '<!DOCTYPE urlset[<!ENTITY page "https://acme.test/">]><urlset/>',
    '<!DOCTYPE s:urlset[<!ENTITY page "https://acme.test/">]><s:urlset/>',
  ]) {
    await t.test(xml, () => {
      const dir = fixture(t, {
        'maps/pages': xml,
        'maps/index.xml': sitemapIndex('/maps/pages', '/maps/pages', '/maps/other-index.xml'),
        'maps/other-index.xml': sitemapIndex('/maps/pages', '/maps/index.xml'),
        'robots.txt': `Sitemap: ${ORIGIN}/maps/index.xml\nSitemap: ${ORIGIN}/maps/pages\n`,
      });
      for (const siteUrl of [ORIGIN, undefined]) {
        const findings = checkDist(dir, { starter: false, siteUrl });
        assert.equal(findings.length, 1);
        assert.equal(findings[0].file, 'maps/pages');
        assert.equal(findings[0].rule, 'robots-sitemap');
        assert.match(
          findings[0].message,
          /invalid sitemap:.*repair maps\/pages or its generating configuration/u
        );
        assert.doesNotMatch(findings[0].message, /correct maps\/index|public\/robots/u);
      }
    });
  }
});

test('DOCTYPE root names identify unreferenced custom sitemap filenames with or without siteUrl', async (t) => {
  for (const root of ['urlset', 's:urlset', 'sitemapindex', 's:sitemapindex']) {
    for (const suffix of ['[<!ENTITY page "https://acme.test/">]>', '[']) {
      await t.test(`${root}${suffix}`, () => {
        const dir = fixture(t, {
          'archive/maps.xml': `<!DOCTYPE ${root}${suffix}`,
          'sitemap.xml': '<urlset/>',
          'robots.txt': `Sitemap: ${ORIGIN}/sitemap.xml\n`,
        });
        for (const siteUrl of [ORIGIN, undefined]) {
          const findings = checkDist(dir, { starter: false, siteUrl });
          assert.equal(findings.length, 1);
          assert.equal(findings[0].file, 'archive/maps.xml');
          assert.match(findings[0].message, /invalid sitemap:.*repair archive\/maps\.xml/u);
        }
      });
    }
  }
});

test('DOCTYPE declarations for unrelated XML do not discover a sitemap', (t) => {
  for (const xml of [
    '<!DOCTYPE rss[<!ENTITY page "<urlset/>">]><rss/>',
    '<!DOCTYPE s:rss[',
    '<!DOCTYPE urlsetting[',
    '<rss><urlset',
  ]) {
    const dir = fixture(t, { 'archive/maps.xml': xml });
    for (const siteUrl of [ORIGIN, undefined])
      assert.deepEqual(checkDist(dir, { starter: false, siteUrl }), [], xml);
  }
});

test('without siteUrl references still reach noindex pages without origin or robots checks', (t) => {
  const dir = fixture(t, {
    'maps/index.xml':
      '<sitemapindex><sitemap><loc>https://other.test/maps/pages</loc></sitemap></sitemapindex>',
    'maps/pages': `<urlset>${[
      'not-a-url',
      '/thanks/',
      'ftp://other.test/thanks/',
      'https://user:pass@other.test/thanks/',
      'https://other.test/thanks/#fragment',
      'https://other.test/thanks/',
    ]
      .map((url) => `<url><loc>${url}</loc></url>`)
      .join('')}</urlset>`,
    'robots.txt': 'Sitemap: /invalid-reference\n',
  });
  assert.deepEqual(
    checkSitemaps(
      createBuildInventory(dir),
      new Set(['thanks.html']),
      (path) => (path === '/thanks/' ? 'thanks.html' : undefined),
      undefined
    ),
    [
      {
        file: 'thanks.html',
        rule: 'sitemap-noindex',
        message:
          'noindex page is listed in maps/pages; exclude it with the sitemap filter in astro.config.mjs',
      },
    ]
  );
});
