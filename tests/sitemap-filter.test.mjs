import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includeDemoPage } from '../scripts/lib/sitemap-filter.mjs';

test('demo exclusions respect the configured base and either trailing-slash policy', () => {
  for (const base of ['/', '/docs', '/docs/']) {
    const prefix = base.replace(/\/+$/u, '');
    for (const slash of ['', '/']) {
      for (const route of ['/login', '/thanks'])
        assert.equal(includeDemoPage(`https://acme.test${prefix}${route}${slash}`, base), false);
      for (const route of ['', '/about', '/sub/thanks', '/thanksgiving', '/login-help'])
        assert.equal(includeDemoPage(`https://acme.test${prefix}${route}${slash}`, base), true);
    }
  }
  assert.equal(includeDemoPage('https://acme.test/docs-else/thanks', '/docs'), true);
  assert.equal(includeDemoPage('https://acme.test/thanks', '/docs'), true);
});
