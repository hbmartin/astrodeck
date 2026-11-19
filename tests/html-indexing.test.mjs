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

function canonicalFindings(html, fileFor = () => 'index.html') {
  const findings = [];
  checkCanonical(parseDocument(html), 'index.html', new URL(ORIGIN), fileFor, (rule, message) =>
    findings.push({ rule, message })
  );
  return findings;
}

test('canonical targets accept legacy file paths and tri-state lookup results', () => {
  const html = `<head>${CANONICAL}${OG}</head>`;
  for (const target of [
    'index.html',
    { status: 'ok', path: 'index.html' },
    { status: 'blocked' },
    { status: 'blocked', path: 'other.html' },
  ])
    assert.deepEqual(
      canonicalFindings(html, () => target),
      [],
      JSON.stringify(target)
    );
  for (const target of [
    undefined,
    { status: 'missing' },
    { status: 'missing', path: 'index.html' },
    { status: 'missing', path: 'other.html' },
  ])
    assert.deepEqual(
      canonicalFindings(html, () => target),
      [
        {
          rule: 'canonical',
          message: `canonical ${ORIGIN}/ points at a missing page, not this page`,
        },
      ]
    );
  for (const target of ['other.html', { status: 'ok', path: 'other.html' }])
    assert.deepEqual(
      canonicalFindings(html, () => target),
      [
        {
          rule: 'canonical',
          message: `canonical ${ORIGIN}/ points at other.html, not this page`,
        },
      ]
    );
});

test('blocked canonical targets preserve independent metadata diagnostics despite stale paths', () => {
  const blocked = () => ({ status: 'blocked', path: 'index.html' });
  for (const [tags, expected] of [
    ['', 'expected one og:url in head, found 0'],
    [`${OG}${OG}`, 'expected one og:url in head, found 2'],
    [
      `<meta property="og:url" content="${ORIGIN}/other">`,
      `og:url ${ORIGIN}/other differs from the canonical ${ORIGIN}/`,
    ],
  ])
    assert.deepEqual(canonicalFindings(`<head>${CANONICAL}${tags}</head>`, blocked), [
      { rule: 'canonical', message: expected },
    ]);
  assert.deepEqual(canonicalFindings(`<head>${CANONICAL}${CANONICAL}${OG}</head>`, blocked), [
    { rule: 'canonical', message: 'expected one <link rel="canonical">, found 2' },
  ]);
  assert.deepEqual(canonicalFindings(`<head>${OG}</head>`, blocked), [
    { rule: 'canonical', message: 'expected one <link rel="canonical">, found 0' },
  ]);
  assert.deepEqual(
    canonicalFindings('<head><link rel="canonical" href="https://other.test/"></head>', blocked),
    [
      {
        rule: 'canonical',
        message: `canonical https://other.test/ is not on SITE_URL (${ORIGIN})`,
      },
    ]
  );
});

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
