import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtFile } from '../scripts/lib/build-paths.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-paths-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('exact build lookup rejects outside paths and normalization aliases', (t) => {
  const dir = fixture(t);
  const build = join(dir, 'dist');
  mkdirSync(join(build, 'nested'), { recursive: true });
  mkdirSync(join(dir, 'dist-sibling'));
  writeFileSync(join(build, 'nested', 'map.xml'), '<urlset/>');
  writeFileSync(join(dir, 'outside.xml'), '<urlset/>');
  writeFileSync(join(dir, 'dist-sibling', 'map.xml'), '<urlset/>');
  assert.equal(builtFile(build, 'nested/map.xml'), 'nested/map.xml');
  for (const name of [
    '../outside.xml',
    '../dist-sibling/map.xml',
    join(dir, 'outside.xml'),
    'nested/../nested/map.xml',
    'nested//map.xml',
    'nested/map.xml/',
    'nested/map.xml/child',
  ]) {
    assert.equal(builtFile(build, name), undefined, name);
  }
});

test('exact build lookup enforces directory and filename case on every filesystem', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'Maps'));
  writeFileSync(join(dir, 'Maps', 'Pages.xml'), '<urlset/>');
  assert.equal(builtFile(dir, 'Maps/Pages.xml'), 'Maps/Pages.xml');
  assert.equal(builtFile(dir, 'maps/Pages.xml'), undefined);
  assert.equal(builtFile(dir, 'Maps/pages.xml'), undefined);
});

test('Unicode normalization comparisons return actual filesystem spelling', (t) => {
  const dir = fixture(t);
  const directory = 'cafe\u0301';
  const filename = 're\u0301sume\u0301.xml';
  mkdirSync(join(dir, directory));
  writeFileSync(join(dir, directory, filename), '<urlset/>');
  const [actualDirectory] = readdirSync(dir);
  const [actualFile] = readdirSync(join(dir, actualDirectory));
  const actual = `${actualDirectory}/${actualFile}`;
  assert.equal(builtFile(dir, 'caf\u00e9/r\u00e9sum\u00e9.xml'), actual);
  assert.equal(builtFile(dir, `${directory}/${filename}`), actual);
  assert.equal(builtFile(dir, 'Caf\u00e9/r\u00e9sum\u00e9.xml'), undefined);
});

test('decoded names keep spaces and literal percent signs', (t) => {
  const dir = fixture(t);
  for (const name of ['space name.xml', '100%.xml', '%20.xml']) {
    writeFileSync(join(dir, name), '<urlset/>');
    assert.equal(builtFile(dir, name), name);
  }
});
