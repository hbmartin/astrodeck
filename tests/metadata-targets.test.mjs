import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDist } from '../scripts/check-dist.mjs';

const ORIGIN = 'https://acme.test';

function metadataBuild(t, path) {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-metadata-targets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><head><title>Canonical blocked target regression checks</title><meta name="description" content="A complete description for checking blocked metadata route targets."><link rel="canonical" href="${ORIGIN}${path}"><meta property="og:url" content="${ORIGIN}${path}"></head><body><h1>Metadata</h1><a href="${path}">Target</a><a href="${path}">Target again</a></body>`
  );
  return dir;
}

test('canonical file and directory symlinks retain only their build finding', async (t) => {
  for (const kind of ['file', 'directory']) {
    await t.test(kind, () => {
      const dir = metadataBuild(t, kind === 'file' ? '/blocked' : '/blocked/page');
      if (kind === 'directory') {
        mkdirSync(join(dir, 'real'));
        writeFileSync(join(dir, 'real', 'page'), 'Linked content');
        symlinkSync('real', join(dir, 'blocked'), 'dir');
      } else symlinkSync('missing', join(dir, 'blocked'));
      assert.deepEqual(checkDist(dir, { starter: false, siteUrl: ORIGIN }), [
        {
          file: 'blocked',
          rule: 'build-symlink',
          message: 'build output must contain regular files and directories, not symbolic links',
        },
      ]);
    });
  }
});

test('blocked canonical and sitemap targets never fall through to a later HTML alias', (t) => {
  const dir = metadataBuild(t, '/alias');
  symlinkSync('missing', join(dir, 'alias'));
  writeFileSync(
    join(dir, 'alias.html'),
    '<title>A later noindex alias</title><meta name="description" content="An alternate route file."><meta name="robots" content="noindex"><h1>Alias</h1>'
  );
  writeFileSync(join(dir, 'sitemap.xml'), `<urlset><url><loc>${ORIGIN}/alias</loc></url></urlset>`);
  writeFileSync(join(dir, 'robots.txt'), `Sitemap: ${ORIGIN}/sitemap.xml\n`);
  assert.deepEqual(
    checkDist(dir, { starter: false, siteUrl: ORIGIN }).map(({ file, rule }) => ({ file, rule })),
    [{ file: 'alias', rule: 'build-symlink' }]
  );
});
