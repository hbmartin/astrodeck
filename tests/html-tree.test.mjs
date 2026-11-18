import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDocument,
  findElements,
  findFirstElement,
  attribute,
  elementName,
  textContent,
} from '../scripts/lib/html-tree.mjs';
import { checkDist } from '../scripts/check-dist.mjs';

test('deep HTML traversal and text extraction retain all 5000 levels', () => {
  const root = parseDocument(
    `${'<div>'.repeat(5000)}<h1>Deep content</h1>${'</div>'.repeat(5000)}`
  );
  assert.equal(findElements(root, (node) => elementName(node) === 'div').length, 5000);
  assert.equal(textContent(root), 'Deep content');
});

test('document order, descendant-only lookup and inert templates remain intact', () => {
  const root = parseDocument(
    '<main id="root"><p id="match">First</p><p id="match">Second</p><template><p id="match">Inert</p></template></main>'
  );
  const byId = (id) => (node) => attribute(node, 'id') === id;
  const main = findFirstElement(root, byId('root'));
  assert.equal(findFirstElement(main, byId('root')), undefined);
  assert.equal(textContent(findFirstElement(main, byId('match'))), 'First');
  assert.deepEqual(findElements(main, (node) => elementName(node) === 'p').map(textContent), [
    'First',
    'Second',
  ]);
  assert.equal(textContent(main), 'FirstSecond');
});

test('first-element lookup stops after its first match', () => {
  const root = parseDocument('<main><p>First</p><p>Second</p></main>');
  const visited = [];
  const first = findFirstElement(root, (node) => {
    visited.push(elementName(node));
    return elementName(node) === 'p';
  });
  assert.equal(textContent(first), 'First');
  assert.deepEqual(visited, ['html', 'head', 'body', 'main', 'p']);
});

test('built-output checking returns findings normally for a deeply nested page', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'astrodeck-deep-html-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const head =
    '<title>Deep page</title><meta name="description" content="A description of this deep page.">';
  writeFileSync(
    join(dir, 'page.html'),
    `<html><head>${head}</head><body>${'<div>'.repeat(5000)}<h1>Deep content</h1>${'</div>'.repeat(5000)}</body></html>`
  );
  assert.deepEqual(checkDist(dir, { starter: false }), []);
});
