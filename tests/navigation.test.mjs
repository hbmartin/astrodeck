import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navigationState } from '../src/lib/navigation.ts';

test('navigation distinguishes current pages, descendants and fragments', () => {
  const cases = [
    ['/', '/', true, true],
    ['/docs', '/docs/', true, true],
    ['/docs/', '/docs/guide', false, true],
    ['/docs', '/docs-other', false, false],
    ['/', '/docs', false, false],
    ['/docs?mode=full', '/docs', true, true],
    ['/#program', '/', false, false],
    ['/#venue', '/', false, false],
    ['/docs#guide', '/docs', false, false],
    ['/docs#guide', '/docs/guide', false, false],
    ['/docs#', '/docs', false, false],
    ['#guide', '/docs', false, false],
    ['//elsewhere.test/docs', '/docs', false, false],
    ['https://elsewhere.test/docs', '/docs', false, false],
    ['/docs%23guide', '/docs%23guide', true, true],
  ];
  for (const [href, path, exact, active] of cases)
    assert.deepEqual(
      navigationState(href, new URL(path, 'https://acme.test')),
      { exact, active },
      href
    );
});
