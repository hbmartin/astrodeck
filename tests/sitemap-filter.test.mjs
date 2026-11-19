import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includeDemoPage } from '../scripts/lib/sitemap-filter.mjs';

test('demo exclusions respect the configured base and either trailing-slash policy', () => {
  for (const base of ['', '/', '///', 'docs', 'docs/', '/docs', '/docs/', '//docs//']) {
    const prefix = base.includes('docs') ? '/docs' : '';
    for (const slash of ['', '/']) {
      for (const route of ['/login', '/thanks'])
        assert.equal(includeDemoPage(`https://acme.test${prefix}${route}${slash}`, base), false);
      for (const route of ['', '/about', '/sub/thanks', '/thanksgiving', '/login-help'])
        assert.equal(includeDemoPage(`https://acme.test${prefix}${route}${slash}`, base), true);
    }
  }
  for (const base of ['docs', 'docs/', '/docs', '/docs/']) {
    assert.equal(includeDemoPage('https://acme.test/docs-else/thanks', base), true);
    assert.equal(includeDemoPage('https://acme.test/thanks', base), true);
  }
});
