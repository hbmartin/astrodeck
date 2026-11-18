import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createBuildInventory } from '../scripts/lib/build-paths.mjs';

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
  const inventory = createBuildInventory(build);
  assert.equal(inventory.file('nested/map.xml'), 'nested/map.xml');
  for (const name of [
    '../outside.xml',
    '../dist-sibling/map.xml',
    join(dir, 'outside.xml'),
    'nested/../nested/map.xml',
    'nested//map.xml',
    'nested/map.xml/',
    'nested/map.xml/child',
  ]) {
    assert.equal(inventory.file(name), undefined, name);
  }
});

test('exact build lookup enforces directory and filename case on every filesystem', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'Maps'));
  writeFileSync(join(dir, 'Maps', 'Pages.xml'), '<urlset/>');
  const inventory = createBuildInventory(dir);
  assert.equal(inventory.file('Maps/Pages.xml'), 'Maps/Pages.xml');
  assert.equal(inventory.file('maps/Pages.xml'), undefined);
  assert.equal(inventory.file('Maps/pages.xml'), undefined);
});

test('Unicode URLs must match the actual filesystem spelling exactly', (t) => {
  const dir = fixture(t);
  const directory = 'cafe\u0301';
  const filename = 're\u0301sume\u0301.xml';
  mkdirSync(join(dir, directory));
  writeFileSync(join(dir, directory, filename), '<urlset/>');
  const [actualDirectory] = readdirSync(dir);
  const [actualFile] = readdirSync(join(dir, actualDirectory));
  const actual = `${actualDirectory}/${actualFile}`;
  const inventory = createBuildInventory(dir);
  const alternate =
    actual.normalize('NFC') === actual ? actual.normalize('NFD') : actual.normalize('NFC');
  assert.notEqual(alternate, actual);
  assert.equal(inventory.file(alternate), undefined);
  assert.equal(inventory.file(actual), actual);
  assert.equal(inventory.file('Caf\u00e9/r\u00e9sum\u00e9.xml'), undefined);
});

test('decoded names keep spaces and literal percent signs', (t) => {
  const dir = fixture(t);
  for (const name of ['space name.xml', '100%.xml', '%20.xml']) {
    writeFileSync(join(dir, name), '<urlset/>');
    assert.equal(createBuildInventory(dir).file(name), name);
  }
});

test('every symlink is rejected without following targets or loops', (t) => {
  const dir = fixture(t);
  const build = join(dir, 'dist');
  mkdirSync(join(build, 'pages'), { recursive: true });
  writeFileSync(join(build, 'pages', 'real.html'), 'real');
  writeFileSync(join(dir, 'outside.xml'), '<urlset/>');
  const links = {
    'internal.html': 'pages/real.html',
    'external.xml': '../outside.xml',
    'internal-directory': 'pages',
    'external-directory': '..',
    dangling: 'missing',
    loop: 'loop',
    'mutual-a': 'mutual-b',
    'mutual-b': 'mutual-a',
  };
  for (const [name, target] of Object.entries(links)) symlinkSync(target, join(build, name));
  const inventory = createBuildInventory(build);
  assert.deepEqual(inventory.files, ['pages/real.html']);
  assert.deepEqual(inventory.findings.map((f) => f.file).sort(), Object.keys(links).sort());
  assert.ok(inventory.findings.every((f) => f.rule === 'build-symlink'));
  for (const name of Object.keys(links)) assert.equal(inventory.lookup(name).status, 'blocked');
  assert.equal(inventory.lookup('external-directory/outside.xml').status, 'blocked');
  symlinkSync(build, join(dir, 'linked-root'));
  assert.equal(createBuildInventory(join(dir, 'linked-root')).findings[0].rule, 'build-symlink');
});

test('inventory lists directories once, caches reads, and refreshes between runs', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'maps'));
  writeFileSync(join(dir, 'maps', 'pages.xml'), '<urlset/>');
  const listings = new Map();
  let reads = 0;
  const inventory = createBuildInventory(dir, {
    readdirSync(path, options) {
      listings.set(path, (listings.get(path) ?? 0) + 1);
      return readdirSync(path, options);
    },
    readFileSync(...args) {
      reads++;
      return readFileSync(...args);
    },
  });
  for (let i = 0; i < 10; i++) {
    assert.equal(inventory.file('maps/pages.xml'), 'maps/pages.xml');
    assert.equal(inventory.file('maps/missing.xml'), undefined);
    assert.equal(inventory.readText('maps/pages.xml').text, '<urlset/>');
  }
  assert.deepEqual([...listings.values()], [1, 1]);
  assert.equal(reads, 1);
  writeFileSync(join(dir, 'new.xml'), '<urlset/>');
  assert.equal(inventory.file('new.xml'), undefined);
  assert.equal(createBuildInventory(dir).file('new.xml'), 'new.xml');
});

test('operational scan and read errors become stable, memoized findings', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'private'));
  for (const name of ['index.html', 'sitemap.xml', 'robots.txt'])
    writeFileSync(join(dir, name), '');
  let reads = 0;
  const inventory = createBuildInventory(dir, {
    readdirSync(path, options) {
      if (path.endsWith('/private')) throw Object.assign(new Error('private'), { code: 'EACCES' });
      return readdirSync(path, options);
    },
    readFileSync() {
      reads++;
      throw Object.assign(new Error('unreadable'), { code: 'EIO' });
    },
  });
  assert.equal(inventory.lookup('private/file.xml').status, 'blocked');
  assert.equal(inventory.readText('absent').status, 'missing');
  for (const name of inventory.files) {
    assert.equal(inventory.readText(name).status, 'blocked');
    assert.equal(inventory.readText(name).status, 'blocked');
  }
  assert.equal(reads, 3);
  assert.equal(inventory.findings.length, 4);
  assert.ok(inventory.findings.every((f) => f.rule === 'build-io'));
  assert.match(inventory.findings[0].message, /read directory \(EACCES\)/u);
  assert.match(inventory.findings[1].message, /read file \(EIO\)/u);
  assert.equal(createBuildInventory(join(dir, 'absent')).findings[0].rule, 'missing-dir');
});

test('unsupported FIFO and socket entries are blocked without being opened', async (t) => {
  // Keep Unix socket paths below macOS's limit, including the temporary directory prefix.
  const dir = mkdtempSync('/tmp/astrodeck-entries-');
  const server = createServer();
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const result = spawnSync('mkfifo', [join(dir, 'stream.xml')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(join(dir, 'state.sock'), resolve)
  );
  const inventory = createBuildInventory(dir, {
    readFileSync() {
      assert.fail('unsupported entries must never be opened');
    },
  });
  assert.deepEqual(inventory.files, []);
  for (const name of ['stream.xml', 'state.sock'])
    assert.equal(inventory.readText(name).status, 'blocked');
  assert.equal(inventory.findings.length, 2);
  assert.ok(
    inventory.findings.every((f) => f.rule === 'build-io' && /unsupported/u.test(f.message))
  );
});
