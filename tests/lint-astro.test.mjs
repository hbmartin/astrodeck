import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintAstro, lintAstroProject } from '../scripts/lint-astro.mjs';

const component = 'src/components/Example.astro';
const page = 'src/pages/index.astro';
const astro = (frontmatter, template = '') => `---\n${frontmatter}\n---\n${template}`;
const rules = (source, file = component) => lintAstro(source, file).map((finding) => finding.rule);

test('client:only requires a static renderer hint', () => {
  assert.deepEqual(rules('<Demo client:only />'), ['astro/missing-client-only-directive-value']);
  for (const hint of ['""', '"   "', '{null}', '{1}']) {
    assert.deepEqual(rules(`<Demo client:only=${hint} />`), [
      'astro/missing-client-only-directive-value',
    ]);
  }
  assert.deepEqual(rules('<Demo client:only={renderer} />'), [
    'astro/missing-client-only-directive-value',
  ]);
  assert.deepEqual(
    rules(astro("const renderer = 'react';", '<Demo client:only={renderer} />')),
    []
  );
  assert.deepEqual(rules('<Demo client:only="react" /><Demo client:load />'), []);
});

test('browser programs cannot shadow or write frontmatter bindings', () => {
  const source = astro(
    "const renderer = 'react'; let runtime = Astro;",
    `<Demo client:only={renderer} />
<p>{runtime.resolve()}</p>
<script>
  var renderer = document.documentElement.dataset.renderer;
  const runtime = { resolve() {} };
  runtime.resolve();
</script>
<script>
  runtime = { resolve() {} };
  runtime.resolve();
  Astro.resolve();
</script>`
  );
  assert.deepEqual(
    lintAstro(source, component).map(({ line, rule }) => ({ line, rule })),
    [{ line: 5, rule: 'astro/no-deprecated-astro-resolve' }]
  );
});

test('set directives conflict with each other and meaningful children', () => {
  const rule = 'astro/no-conflict-set-directives';
  assert.deepEqual(rules('<p set:text={value} set:html={markup} />'), [rule]);
  assert.deepEqual(rules('<p set:text={value}><strong>Text</strong></p>'), [rule]);
  assert.deepEqual(rules('<p set:html={markup}>Text</p>'), [rule]);
  assert.deepEqual(rules('<p set:html={markup}> \n<!-- retained comment -->\n </p>'), []);
  assert.deepEqual(rules('<p set:text={value}>{/* retained comment */}</p>'), []);
  assert.deepEqual(rules('<p set:text={value}>{/* note */}{value}</p>'), [rule]);
  assert.deepEqual(rules('<p data-value="set:text">Text</p>'), []);
});

test('checks deprecated Astro properties in frontmatter and template expressions', () => {
  const source = astro(
    "const runtime = Astro; const key = 'resolve'; const { canonicalURL: canonical } = runtime;",
    '<p>{runtime?.[key]("/old")}{Astro.fetchContent("./old.md")}</p>'
  );
  assert.deepEqual(rules(source), [
    'astro/no-deprecated-astro-canonicalurl',
    'astro/no-deprecated-astro-resolve',
    'astro/no-deprecated-astro-fetchcontent',
  ]);
  assert.deepEqual(
    rules(astro('const runtime = Astro; const url = runtime.url;', '<p>{Astro.site}</p>')),
    []
  );
  assert.deepEqual(
    rules(
      astro(
        'const resolve = (Astro) => Astro.resolve();',
        '<p>{resolve({ resolve: () => "" })}</p>'
      )
    ),
    []
  );
  assert.deepEqual(
    rules(astro('const runtime = { fetchContent() {} }; runtime.fetchContent();')),
    []
  );
});

test('Astro aliases are evaluated at the read, including during reassignment', () => {
  const code = [
    'let runtime = Astro;',
    'runtime.resolve();',
    'runtime = {};',
    'runtime.resolve();',
    'runtime = Astro;',
    'runtime = runtime.resolve();',
    'runtime.resolve();',
  ].join('\n');
  assert.deepEqual(
    lintAstro(astro(code), component).map(({ line }) => line),
    [3, 7]
  );
  assert.deepEqual(
    rules(astro('var runtime = Astro; runtime.resolve(); var runtime = {}; runtime.resolve();')),
    ['astro/no-deprecated-astro-resolve']
  );
  assert.deepEqual(
    rules(astro('let runtime = Astro;', '<p>{(runtime = {}, runtime.resolve())}</p>')),
    []
  );
});

test('initialized var declarations take effect at their position in a function', () => {
  const prefix = 'runtime.resolve(); var runtime = Astro;';
  const expected = ['astro/no-deprecated-astro-resolve'];
  assert.deepEqual(
    rules(astro('function f(runtime) {' + prefix + 'runtime.resolve(); }')),
    expected
  );
  assert.deepEqual(
    rules(astro('function f() {' + prefix + 'function runtime() {} runtime.resolve(); }')),
    expected
  );
  assert.deepEqual(
    rules(astro('function f() { var { runtime } = other; ' + prefix + 'runtime.resolve(); }')),
    expected
  );
});

test('namespace-local variables and erased declarations preserve the outer binding', () => {
  const code = [
    'const runtime = Astro;',
    'namespace Example { var runtime = {}; runtime.resolve(); }',
    'declare namespace Astro { export function resolve(): void; }',
    'runtime.resolve();',
    'Astro.resolve();',
    'const Named = class Astro { method() { Astro.resolve(); } };',
  ].join('\n');
  assert.deepEqual(
    lintAstro(astro(code), component).map(({ line }) => line),
    [5, 6]
  );
});

test('uncertain writes only resolve when the branch and execution order establish the value', () => {
  const resolve = ['astro/no-deprecated-astro-resolve'];
  assert.deepEqual(
    rules(astro('let x = Astro; x.resolve(); if (cond) x = {}; x.resolve();')),
    resolve
  );
  assert.deepEqual(
    rules(astro('let x = {}; if (cond) { x = Astro; x.resolve(); } x.resolve();')),
    resolve
  );
  for (const write of [
    'x ||= Astro;',
    '({ key: x } = other);',
    'for (var x of items) {}',
    'const result = maybe?.[x = Astro];',
    'const { y = (x = Astro) } = other;',
    'function replace() { x = Astro; }',
  ]) {
    assert.deepEqual(rules(astro('var x = {}; ' + write + ' x.resolve();')), [], write);
  }
  assert.deepEqual(rules(astro('let x = Astro; while (cond) { x.resolve(); x = {}; }')), []);
  assert.deepEqual(rules(astro('let x = Astro; function replace() { x = {}; } x.resolve();')), []);
});

test('keeps Astro aliases with no writes to the binding', () => {
  const resolveRule = 'astro/no-deprecated-astro-resolve';
  assert.deepEqual(
    rules(
      astro(
        'let runtime = Astro; function unrelated(runtime) { runtime = {}; } runtime.locals = {};',
        '<p>{runtime.resolve()}</p>'
      )
    ),
    [resolveRule]
  );
  assert.deepEqual(rules(astro('var runtime = Astro; var runtime; runtime.resolve();')), [
    resolveRule,
  ]);
  assert.deepEqual(
    rules(
      astro(
        'let runtime = Astro; class Demo { static { var runtime = {}; runtime = {}; } } runtime.resolve();'
      )
    ),
    [resolveRule]
  );
});

test('reports an aliased getEntryBySlug import from astro:content only', () => {
  assert.deepEqual(rules(astro("import { getEntryBySlug as find } from 'astro:content';")), [
    'astro/no-deprecated-getentrybyslug',
  ]);
  assert.deepEqual(rules(astro("import { getEntry as find } from 'astro:content';")), []);
  assert.deepEqual(rules(astro("import { getEntryBySlug } from './legacy';")), []);
});

test('allows types and route options and reports other exports', () => {
  const rule = 'astro/no-exports-from-components';
  assert.deepEqual(rules(astro('export const feature = true;')), [rule]);
  assert.deepEqual(rules(astro("export * from './module';")), [rule]);
  assert.deepEqual(rules(astro("export { value as feature } from './module';")), [rule]);
  assert.deepEqual(rules(astro('export default false;')), [rule]);
  assert.deepEqual(rules(astro('export enum Status { Ready }')), [rule]);
  assert.deepEqual(rules(astro('export namespace Tools { export const flag = true; }')), [rule]);
  assert.deepEqual(
    rules(
      astro(
        'export declare enum Status { Ready } export namespace Types { export type Label = string; }'
      )
    ),
    []
  );
  assert.deepEqual(
    rules(
      astro(
        "export interface Props { title: string }; export type { Entry } from './types'; export { type Item } from './types';"
      )
    ),
    []
  );
  assert.deepEqual(
    rules(
      astro('export function getStaticPaths() { return []; } export const partial = true;'),
      page
    ),
    []
  );
});

test('type-only overload signatures do not count as runtime exports', () => {
  const paths = astro(
    'export function getStaticPaths(): unknown[]; export function getStaticPaths() { return []; }'
  );
  assert.deepEqual(rules(paths, page), []);

  const helper = astro('export function helper(): number; export function helper() { return 1; }');
  assert.deepEqual(rules(helper), ['astro/no-exports-from-components']);
});

test('project Astro lint accepts a config without ignorePatterns', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-astro-'));
  try {
    writeFileSync(join(root, '.oxlintrc.json'), '{}');
    writeFileSync(join(root, 'page.astro'), '<Demo client:only />');
    assert.deepEqual(
      lintAstroProject(root).map(({ rule }) => rule),
      ['astro/missing-client-only-directive-value']
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prerender exports are limited to pages directories', () => {
  const rule = 'astro/no-prerender-export-outside-pages';
  assert.deepEqual(rules(astro('export const prerender = false;')), [rule]);
  assert.deepEqual(rules(astro('const value = false; export { value as prerender };')), [rule]);
  assert.deepEqual(rules(astro('export const prerender = true;'), page), []);
  assert.deepEqual(rules(astro('const prerender = true;')), []);
});

test('only frontmatter exports are checked for Astro route restrictions', () => {
  const script = '<script>export const init = () => {}; export const prerender = true;</script>';
  assert.deepEqual(rules(script), []);
  assert.deepEqual(rules(script, page), []);
  assert.deepEqual(
    rules(astro('export const feature = true; export const prerender = false;', script)),
    ['astro/no-exports-from-components', 'astro/no-prerender-export-outside-pages']
  );
});

test('define:vars requires a CSS use outside comments', () => {
  const source = astro(
    "const color = 'red'; const cssKey = 'accent-color';",
    '<style define:vars={{ color, [cssKey]: color, unused: color }}>p { color: var(--color, var(--accent-color)); } /* var(--unused) */</style>'
  );
  assert.deepEqual(lintAstro(source, component), [
    {
      file: component,
      line: 4,
      rule: 'astro/no-unused-define-vars-in-style',
      message: "'unused' is defined but never used.",
    },
  ]);
  assert.deepEqual(
    rules('<style define:vars={{ color: "red" }}>p { color: var(--color); }</style>'),
    []
  );
  assert.deepEqual(
    rules('<script define:vars={{ example: true }}>console.log(example);</script>'),
    []
  );
});

test('reports Astro parse errors with a source line', () => {
  const [finding] = lintAstro('<p>\n  <span></p>', component);
  assert.equal(finding.rule, 'astro/parse-error');
  assert.equal(finding.line, 2);
});
