import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkDist } from '../scripts/check-dist.mjs';
import { checkHost } from '../scripts/check-host.mjs';
import { expectedMetadata } from '../scripts/lib/page-metadata.mjs';
import { resolveHeaderCta, resolveHostedAction } from '../src/lib/starter/hosted-action.mjs';
import { boundedImageWidths } from '../src/lib/starter/image-widths.mjs';

test('the hosted CTA distinguishes missing, valid and invalid configuration', () => {
  const config = {
    label: 'Book now',
    allowedOrigins: ['https://book.example'],
    fallback: { href: '/contact/', label: 'Contact us' },
  };
  assert.deepEqual(resolveHeaderCta(' ', config), { ...config.fallback, external: false });
  assert.deepEqual(resolveHeaderCta('https://book.example/meet', config), {
    label: 'Book now',
    href: 'https://book.example/meet',
    external: true,
  });
  assert.throws(() => resolveHeaderCta('https://book.example.invalid/diagnostic-data', config), {
    message: 'HOSTED_CTA_URL must be an HTTPS URL on an approved origin.',
  });
});

test('the hosted action cannot turn a fallback into an external navigation', () => {
  const options = { allowedOrigins: ['https://book.example'], fallbackHref: '/contact/' };
  assert.deepEqual(resolveHostedAction('https://n@book.example/a', options), {
    status: 'unavailable',
    reason: 'invalid-configuration',
    href: '/contact/',
  });
  assert.throws(() =>
    resolveHostedAction(undefined, { ...options, fallbackHref: '//other.example/' })
  );
});

test('responsive candidates are sorted and never exceed the source width', () => {
  assert.deepEqual(boundedImageWidths(800, [1200, 480, 800, 480]), [480, 800]);
  assert.deepEqual(boundedImageWidths(320, [480, 800, 1200]), []);
});

test('built metadata checks catch canonical and robots drift and missing expected pages', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-kit-html-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origin = 'https://example.test';
  const metadata = expectedMetadata(origin, [
    { path: '/', file: 'index.html', indexable: true },
    { path: '/404/', file: '404.html', indexable: false },
  ]);
  const html = (title, path, robots) =>
    '<!doctype html><html><head><title>' +
    title +
    '</title>' +
    '<meta name="description" content="A starter site for testing its generated page metadata.">' +
    '<link rel="canonical" href="' +
    origin +
    path +
    '">' +
    '<meta property="og:url" content="' +
    origin +
    path +
    '">' +
    robots +
    '</head><body><h1>' +
    title +
    '</h1></body></html>';
  const home = 'A new website rendered from the starter';
  const robots = '<meta name="robots" content="none">';
  writeFileSync(join(dir, 'index.html'), html(home, '/', ''));
  writeFileSync(join(dir, '404.html'), html('Page not found', '/404/', robots));
  assert.deepEqual(checkDist(dir, { starter: false, metadata }), []);

  writeFileSync(join(dir, 'index.html'), html(home, '/old/', robots));
  rmSync(join(dir, '404.html'));
  assert.deepEqual(
    checkDist(dir, { starter: false, metadata })
      .map(({ rule }) => rule)
      .sort(),
    ['seo-canonical', 'seo-og-url', 'seo-page-missing', 'seo-robots']
  );
});

test('host smoke rejects a soft 404 and does not follow redirects', async (t) => {
  let missingStatus = 404;
  let followed = false;
  const server = createServer((request, response) => {
    if (request.url === '/old/') {
      response.writeHead(308, { location: '/new/' }).end();
      return;
    }
    if (request.url === '/new/') followed = true;
    response.writeHead(missingStatus, { 'content-type': 'text/html' }).end('<h1>404</h1>');
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  t.after(() => new Promise((done) => server.close(done)));

  const origin = 'http://127.0.0.1:' + server.address().port;
  const rows = [
    { path: '/old/', status: 308, location: '/new/' },
    {
      path: '/missing/',
      status: 404,
      headerIncludes: { 'content-type': 'text/html' },
      bodyIncludes: '<h1>404</h1>',
    },
  ];
  const lines = [];
  const capture = (line) => lines.push(line);
  assert.equal(await checkHost(origin, rows, capture), 0);
  assert.equal(followed, false);
  missingStatus = 200;
  assert.equal(await checkHost(origin, rows, capture), 1);
  assert.match(lines.at(-1), /expected status 404, got 200/u);
});
