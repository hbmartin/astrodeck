import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedAstroSlots } from '../scripts/lib/astro-slots.mjs';
import { compactionForFiles } from '../scripts/lib/formatter-config.mjs';

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
    const javascript = join(root, 'example.js');
    writeFileSync(javascript, 'const value="hello"');
    const run = () =>
      spawnSync(process.execPath, [script, 'example.astro', 'example.js'], {
        cwd: root,
        encoding: 'utf8',
      });
    check(
      run,
      () => readFileSync(file, 'utf8'),
      () => readFileSync(javascript, 'utf8')
    );
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
    checkFormatting(source, 45, (run, read, readJavaScript) => {
      const result = run();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /example\.astro: Formatting changes rendered Astro slot text/);
      assert.match(result.stderr, slot);
      assert.match(result.stderr, /explicit string expression/);
      assert.equal(read(), source);
      assert.equal(readJavaScript(), "const value = 'hello';\n");
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

test('format ignores excluded paths and only writes changed targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'format-list-'));
  try {
    const run = (...files) =>
      spawnSync(process.execPath, [script, ...files], { cwd: root, encoding: 'utf8' });
    const read = (file) => readFileSync(join(root, file), 'utf8');
    const write = (file, contents) => writeFileSync(join(root, file), contents);
    write('.oxfmtrc.json', JSON.stringify({ ignorePatterns: ['ignored.js'], singleQuote: true }));
    write('ignored.js', 'const ignored="value"');
    write('changed.js', 'const changed="value"');

    const ignored = run('ignored.js');
    assert.equal(ignored.status, 0, ignored.stderr);
    assert.match(ignored.stdout, /Formatted 0 file/);

    const mixed = run('ignored.js', 'changed.js');
    assert.equal(mixed.status, 0, mixed.stderr);
    assert.match(mixed.stdout, /Formatted 1 file/);
    assert.equal(read('ignored.js'), 'const ignored="value"');
    assert.equal(read('changed.js'), "const changed = 'value';\n");

    const unchanged = run('changed.js');
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.match(unchanged.stdout, /Formatted 0 file/);

    write('.oxfmtrc.json', '{not valid JSON');
    const invalid = run('changed.js');
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Failed to load configuration file/i);
    assert.equal(read('changed.js'), "const changed = 'value';\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('slot safety uses Astro compaction from Oxfmt and protects uncertain config modes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'slot-mode-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inline = '<Demo><b>One</b><i>Two</i></Demo>';
  const wrapped = '<Demo>\n  <b>One</b>\n  <i>Two</i>\n</Demo>';
  const file = 'example.astro';
  const config = join(root, '.oxfmtrc.json');
  for (const [setting, mode] of [
    ['jsx', 'jsx'],
    ['html', true],
    ['none', false],
  ]) {
    writeFileSync(config, JSON.stringify({ astro: { compressHTML: setting } }));
    const modes = compactionForFiles(root)(file);
    assert.deepEqual(modes, [mode]);
    assert.deepEqual(
      changedAstroSlots(inline, wrapped, file, mode),
      mode === 'jsx' ? [] : ['Demo (default)']
    );
  }
  writeFileSync(
    config,
    JSON.stringify({
      overrides: [{ files: ['*.astro'], options: { astro: { compressHTML: 'none' } } }],
    })
  );
  assert.deepEqual(compactionForFiles(root)(file), ['jsx', true, false]);
});
