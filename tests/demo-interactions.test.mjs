import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const KIT_ONLY =
  process.env.ASTRODECK_KIT_CHECKS !== '1' && 'kit check (set ASTRODECK_KIT_CHECKS=1)';

function copyHarness(createToggle) {
  const copyRequests = [];
  const callbacks = new Map();
  const classes = new Set();
  const button = {
    textContent: 'Copy Code',
    classList: { toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)) },
    setAttribute(name, value) {
      assert.equal(name, 'aria-expanded');
      this.expanded = value;
    },
  };
  const panel = { hidden: true, querySelector: () => ({ textContent: 'sample code' }) };
  let nextTimer = 0;
  const toggle = createToggle(
    (text) => {
      assert.equal(text, 'sample code');
      const { promise, resolve } = Promise.withResolvers();
      copyRequests.push(resolve);
      return promise;
    },
    {
      setTimeout(callback, delay) {
        assert.equal(delay, 1500);
        callbacks.set(++nextTimer, callback);
        return nextTimer;
      },
      clearTimeout: (timer) => callbacks.delete(timer),
    }
  );
  return { toggle: () => toggle(button, panel), button, panel, copyRequests, callbacks, classes };
}

test(
  'demo clipboard feedback belongs to the current panel opening',
  { skip: KIT_ONLY },
  async () => {
    const { createDemoCopyToggle } = await import('../src/components/demos/demo-copy-toggle.ts');
    const h = copyHarness(createDemoCopyToggle);
    const first = h.toggle();
    await h.toggle();
    const second = h.toggle();
    h.copyRequests[1](true);
    await second;
    assert.equal(h.button.textContent, 'Copied!');
    assert.equal(h.button.expanded, 'true');
    assert.equal(h.classes.size, 2);
    h.copyRequests[0](true);
    await first;
    assert.equal(h.callbacks.size, 1);

    const [staleTimer] = h.callbacks.values();
    await h.toggle();
    assert.equal(h.button.textContent, 'Copy Code');
    assert.equal(h.button.expanded, 'false');
    assert.equal(h.panel.hidden, true);
    assert.equal(h.classes.size, 0);
    assert.equal(h.callbacks.size, 0);

    const third = h.toggle();
    h.copyRequests[2](true);
    await third;
    staleTimer();
    assert.equal(h.button.textContent, 'Copied!');
    const [currentTimer] = h.callbacks.values();
    currentTimer();
    assert.equal(h.button.textContent, 'Hide Code');
    assert.equal(h.classes.size, 0);
  }
);

test(
  'demo clipboard denial keeps the code available without success feedback',
  { skip: KIT_ONLY },
  async () => {
    const { createDemoCopyToggle } = await import('../src/components/demos/demo-copy-toggle.ts');
    const h = copyHarness(createDemoCopyToggle);
    const pending = h.toggle();
    h.copyRequests[0](false);
    await pending;
    assert.equal(h.button.textContent, 'Hide Code');
    assert.equal(h.panel.hidden, false);
    assert.equal(h.classes.size, 0);
    assert.equal(h.callbacks.size, 0);
  }
);

test('date-only releases display the same day in different time zones', { skip: KIT_ONLY }, () => {
  const releaseText = new URL('../src/components/demos/release-text.ts', import.meta.url);
  const expression = `import {formatReleaseDate} from ${JSON.stringify(releaseText.href)}; console.log(formatReleaseDate('2026-11-06'));`;
  for (const TZ of ['UTC', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', expression], {
      env: { ...process.env, TZ },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'November 6, 2026', TZ);
  }
});
