import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDist } from '../scripts/check-dist.mjs';

function build(t, body) {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><title>Internal link validation regression</title><meta name="description" content="Regression coverage for HTML and inline SVG document links."><h1>Links</h1>${body}`
  );
  return dir;
}

test('SVG href and namespaced xlink:href targets are checked without changing HTML namespaces', (t) => {
  const dir = build(
    t,
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a href="/missing">Modern link</a><a xlink:href="/legacy">Legacy link</a><title>Not an HTML title</title></svg>'
  );
  assert.deepEqual(checkDist(dir, { starter: false }), [
    { file: 'index.html', rule: 'internal-link', message: '/missing does not resolve to a file' },
    { file: 'index.html', rule: 'internal-link', message: '/legacy does not resolve to a file' },
  ]);
});

test('SVG href takes precedence over xlink:href, including an explicitly empty href', (t) => {
  const dir = build(
    t,
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a href="/" xlink:href="/missing">Home</a><a href="" xlink:href="/missing">Current page</a><a xlink:href="/">Legacy home</a><a href="https://other.test/missing">External</a></svg>'
  );
  assert.deepEqual(checkDist(dir, { starter: false }), []);
});

test('blocked HTML link targets retain one source finding instead of a missing-file duplicate', (t) => {
  const dir = build(t, '<a href="/blocked/page">Blocked</a><a href="/absent">Missing</a>');
  const real = join(dir, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'page.txt'), 'A non-HTML file');
  symlinkSync(real, join(dir, 'blocked'));
  assert.deepEqual(checkDist(dir, { starter: false }), [
    { file: 'index.html', rule: 'internal-link', message: '/absent does not resolve to a file' },
    {
      file: 'blocked',
      rule: 'build-symlink',
      message: 'build output must contain regular files and directories, not symbolic links',
    },
  ]);
});

test('a blocked first route candidate is not replaced by a later HTML alias', (t) => {
  const dir = build(t, '<a href="/alias">Blocked route</a>');
  writeFileSync(join(dir, 'target.txt'), 'Blocked first candidate');
  symlinkSync(join(dir, 'target.txt'), join(dir, 'alias'));
  writeFileSync(
    join(dir, 'alias.html'),
    '<title>Later alias</title><meta name="description" content="An alternate route file."><meta name="robots" content="noindex"><h1>Alias</h1>'
  );
  writeFileSync(
    join(dir, 'sitemap.xml'),
    '<urlset><url><loc>https://acme.test/alias</loc></url></urlset>'
  );
  assert.deepEqual(
    checkDist(dir, { starter: false }).map(({ file, rule }) => ({ file, rule })),
    [{ file: 'alias', rule: 'build-symlink' }]
  );
});
