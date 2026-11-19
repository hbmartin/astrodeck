import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyNavigation } from './browser/history.mjs';

function navigationFixture(links, responses) {
  const requests = [];
  let disposed = 0;
  const origin = 'https://acme.test';
  const navigation = {
    evaluateAll: async () => links.map((link) => ({ target: null, download: false, ...link })),
    nth: (index) => ({ index }),
  };
  const page = {
    url: () => `${origin}/#main-content`,
    locator: () => navigation,
    request: {
      async get(href, options) {
        assert.equal(options.maxRedirects, 0);
        requests.push(href);
        const response = responses[new URL(href).pathname];
        if (response instanceof Error) throw response;
        const { status = 200, ...headers } = response ?? { status: 404 };
        return {
          status: () => status,
          headers: () => headers,
          dispose: async () => disposed++,
        };
      },
    },
  };
  return { page, requests, disposed: () => disposed };
}

test('history navigation skips fragments, downloads, new tabs and non-HTML responses', async () => {
  const h = navigationFixture(
    [
      { href: '/#venue' },
      { href: '/download', download: true },
      { href: '/new-tab', target: '_blank' },
      { href: 'mailto:hello@acme.test' },
      { href: 'https://other.test/page' },
      { href: '/rss.xml' },
      { href: '/guide.pdf' },
      { href: 'https://acme.test/docs', target: '_SELF' },
    ],
    {
      '/rss.xml': { 'content-type': 'application/rss+xml' },
      '/guide.pdf': { 'content-type': 'application/pdf' },
      '/docs': { 'content-type': 'text/html; charset=utf-8' },
    }
  );
  assert.deepEqual(await historyNavigation(h.page), { index: 7 });
  assert.deepEqual(h.requests, [
    'https://acme.test/rss.xml',
    'https://acme.test/guide.pdf',
    'https://acme.test/docs',
  ]);
  assert.equal(h.disposed(), 3);
});

test('history probes follow local redirects without requesting foreign destinations', async () => {
  const h = navigationFixture([{ href: '/foreign-redirect' }, { href: '/local-redirect' }], {
    '/foreign-redirect': { status: 302, location: 'https://other.test/page' },
    '/local-redirect': { status: 308, location: '/docs/' },
    '/docs/': { 'content-type': 'text/html' },
  });
  assert.deepEqual(await historyNavigation(h.page), { index: 1 });
  assert.deepEqual(h.requests, [
    'https://acme.test/foreign-redirect',
    'https://acme.test/local-redirect',
    'https://acme.test/docs/',
  ]);
});

test('failed, looping and malformed probes cannot prevent a later document check', async () => {
  const h = navigationFixture(
    ['/broken', '/loop', '/empty-redirect', '/home-redirect', '/missing', '/docs'].map((href) => ({
      href,
    })),
    {
      '/broken': new Error('connection reset'),
      '/loop': { status: 302, location: '/loop' },
      '/empty-redirect': { status: 301 },
      '/home-redirect': { status: 302, location: '/' },
      '/': { 'content-type': 'text/html' },
      '/docs': { 'content-type': 'text/html' },
    }
  );
  assert.deepEqual(await historyNavigation(h.page), { index: 5 });
  assert.equal(h.requests.filter((href) => href.endsWith('/loop')).length, 6);
  assert.equal(h.requests.at(-1), 'https://acme.test/docs');
});

test('history navigation is unavailable for a home-only menu', async () => {
  const h = navigationFixture([{ href: '/' }, { href: '/#contact' }], {});
  assert.equal(await historyNavigation(h.page), undefined);
  assert.deepEqual(h.requests, []);
});

test('history probes skip successful responses that do not navigate to a document', async (t) => {
  const rejected = [
    { status: 204 },
    { status: 205 },
    { 'content-disposition': 'attachment' },
    { 'content-disposition': 'Attachment; filename="export.html"' },
    { 'content-disposition': '\t ATTACHMENT ; filename="export.html"' },
    { 'content-disposition': 'download; filename="export.html"' },
    { 'content-disposition': 'form-data' },
    { 'content-disposition': 'unknown-disposition' },
  ];
  for (const response of rejected) {
    await t.test(JSON.stringify(response), async () => {
      const h = navigationFixture([{ href: '/export' }, { href: '/docs' }], {
        '/export': { 'content-type': 'text/html', ...response },
        '/docs': {
          'content-type': 'text/html',
          'content-disposition': 'inline; filename="docs.html"',
        },
      });
      assert.deepEqual(await historyNavigation(h.page), { index: 1 });
      assert.deepEqual(h.requests, ['https://acme.test/export', 'https://acme.test/docs']);
      assert.equal(h.disposed(), 2);
    });
  }
});

test('history probes accept empty and case-insensitive inline dispositions', async () => {
  for (const disposition of ['', ' \t ', 'INLINE', ' \t InLiNe ; filename="docs.html"']) {
    const h = navigationFixture([{ href: '/docs' }], {
      '/docs': { 'content-type': 'text/html', 'content-disposition': disposition },
    });
    assert.deepEqual(await historyNavigation(h.page), { index: 0 }, disposition);
    assert.equal(h.disposed(), 1);
  }
});
