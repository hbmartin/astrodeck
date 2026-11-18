import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDocument,
  findElements,
  elementName,
  attribute,
  textContent,
} from '../scripts/lib/html-tree.mjs';
import { checkCanonical, isNoindex } from '../scripts/lib/indexing.mjs';

const ORIGIN = 'https://acme.test';
const CANONICAL = `<link rel="canonical" href="${ORIGIN}/">`;
const OG = `<meta property="og:url" content="${ORIGIN}/">`;

function canonicalFindings(html) {
  const findings = [];
  checkCanonical(
    parseDocument(html),
    'index.html',
    new URL(ORIGIN),
    () => 'index.html',
    (rule, message) => findings.push({ rule, message })
  );
  return findings;
}

test('browser document construction supplies an implicit head', () => {
  assert.deepEqual(canonicalFindings(`<!doctype html>${CANONICAL}${OG}<h1>Page</h1>`), []);
});

test('body-starting content closes head before later canonical and Open Graph tags', () => {
  assert.deepEqual(
    canonicalFindings(
      `<html><head><div>Body starts</div>${CANONICAL}${OG}</head><body><h1>Page</h1></body></html>`
    ),
    [{ rule: 'canonical', message: 'expected one <link rel="canonical">, found 0' }]
  );
  assert.deepEqual(canonicalFindings(`<head>${CANONICAL}<div>Body starts</div>${OG}</head>`), [
    { rule: 'canonical', message: 'expected one og:url in head, found 0' },
  ]);
});

test('canonical metadata inside inert templates and script text is not in the document head', () => {
  const inert = `<template>${CANONICAL}${OG}<meta name="robots" content="noindex"></template>`;
  assert.deepEqual(canonicalFindings(`<head>${CANONICAL}${OG}${inert}</head><h1>Page</h1>`), []);
  assert.equal(isNoindex(parseDocument(`<head>${inert}</head><h1>Page</h1>`)), false);
  assert.deepEqual(
    canonicalFindings(`<head><script>const markup = '${CANONICAL}${OG}';</script>${inert}</head>`),
    [{ rule: 'canonical', message: 'expected one <link rel="canonical">, found 0' }]
  );
});

test('scripting-enabled noscript metadata does not supply canonical metadata', () => {
  assert.deepEqual(
    canonicalFindings(`<head><noscript>${CANONICAL}${OG}</noscript></head><h1>Page</h1>`),
    [{ rule: 'canonical', message: 'expected one <link rel="canonical">, found 0' }]
  );
});

test('head metadata is counted by browser location and decoded HTML attributes', () => {
  const url = `${ORIGIN}/?a=1&amp;b=2`;
  assert.deepEqual(
    canonicalFindings(
      `<HEAD><LINK REL="alternate CANONICAL" HREF="${url}"><META PROPERTY="og:url" CONTENT="${url}"></HEAD>`
    ),
    []
  );
  assert.deepEqual(canonicalFindings(`<head>${CANONICAL}${CANONICAL}${OG}</head>`), [
    { rule: 'canonical', message: 'expected one <link rel="canonical">, found 2' },
  ]);
  assert.deepEqual(
    canonicalFindings(`<head>${CANONICAL}${OG}</head><body>${CANONICAL}${OG}</body>`),
    []
  );
});

test('one tree exposes active HTML elements, namespaces, text and decoded attributes', () => {
  const root = parseDocument(
    '<title>A &amp; B</title><h1>Heading</h1><template><h1>Inert</h1><img src="missing"></template><svg><title>Foreign title</title><a href="/foreign">Foreign link</a></svg><a href="/?a=1&amp;b=2">Link</a>'
  );
  const titles = findElements(root, (node) => elementName(node) === 'title');
  assert.deepEqual(titles.map(textContent), ['A & B']);
  assert.equal(findElements(root, (node) => elementName(node) === 'h1').length, 1);
  assert.equal(findElements(root, (node) => elementName(node) === 'img').length, 0);
  const links = findElements(root, (node) => elementName(node) === 'a');
  assert.equal(links.length, 1);
  assert.equal(attribute(links[0], 'href'), '/?a=1&b=2');
});
