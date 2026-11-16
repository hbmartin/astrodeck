import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, '..', 'scripts', 'format.mjs');

function checkFormatting(source, printWidth, check) {
  const root = mkdtempSync(join(tmpdir(), 'astro-format-'));
  try {
    const file = join(root, 'example.astro');
    writeFileSync(
      join(root, '.oxfmtrc.json'),
      JSON.stringify({
        astro: { compressHTML: 'jsx' },
        singleQuote: true,
        printWidth,
      })
    );
    writeFileSync(file, source);
    const run = () =>
      spawnSync(process.execPath, [script, 'example.astro'], { cwd: root, encoding: 'utf8' });
    check(run, () => readFileSync(file, 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const unsafe = [
  ['hydrated label', '<Demo client:load variant="secondary">Secondary</Demo>', /Demo \(default\)/],
  [
    'long plain text',
    '<Demo>This text is long enough to wrap when formatting its slot.</Demo>',
    /Demo \(default\)/,
  ],
  [
    'mixed markup',
    '<Demo>Start <strong>important text</strong> and end with a long description</Demo>',
    /Demo \(default\)/,
  ],
  [
    'named slot',
    '<Demo><Fragment slot="label">A named slot with text long enough to wrap</Fragment></Demo>',
    /Demo \(label\)/,
  ],
];

for (const [name, source, slot] of unsafe) {
  test(`unsafe Astro formatting preserves the original ${name}`, () => {
    checkFormatting(source, 45, (run, read) => {
      const result = run();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /example\.astro: Formatting changes rendered Astro slot text/);
      assert.match(result.stderr, slot);
      assert.match(result.stderr, /explicit string expression/);
      assert.equal(read(), source);
    });
  });
}

test('safe Astro formatting writes the checked output and is idempotent', () => {
  const source = '<Demo client:load variant="secondary">{"Secondary"}</Demo>';
  checkFormatting(source, 45, (run, read) => {
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const formatted = read();
    assert.notEqual(formatted, source);
    assert.match(formatted, /\{'Secondary'\}/);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Formatted 0 file/);
    assert.equal(read(), formatted);
  });
});
