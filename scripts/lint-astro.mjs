#!/usr/bin/env node
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@astrojs/compiler-rs';
import { formatFindings } from './lib/findings.mjs';

const ROUTE_EXPORTS = new Set(['getStaticPaths', 'partial', 'prerender']);
const DEPRECATED_APIS = new Map([
  ['canonicalURL', 'no-deprecated-astro-canonicalurl'],
  ['fetchContent', 'no-deprecated-astro-fetchcontent'],
  ['resolve', 'no-deprecated-astro-resolve'],
]);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const BLOCKS = new Set([
  'BlockStatement',
  'CatchClause',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'SwitchStatement',
]);
const UNKNOWN = Symbol('unknown value');
const ASTRO = Symbol('Astro global');

function* boundNames(pattern) {
  pattern = unwrap(pattern);
  switch (pattern?.type) {
    case 'Identifier':
      yield pattern.name;
      break;
    case 'AssignmentPattern':
      yield* boundNames(pattern.left);
      break;
    case 'RestElement':
      yield* boundNames(pattern.argument);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) yield* boundNames(prop.value ?? prop.argument);
      break;
    case 'ArrayPattern':
      for (const item of pattern.elements) yield* boundNames(item);
      break;
    case 'VariableDeclaration':
      for (const { id } of pattern.declarations) yield* boundNames(id);
      break;
  }
}

/** Index bindings before checking references so a later declaration can shadow an outer name. */
function collectNodes(node, scope, nodes) {
  if (!node?.type) return;
  const isFunction = FUNCTIONS.has(node.type);
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id) scope.bindings.set(node.id.name, null);
  }
  const isVarScope = isFunction || node.type === 'StaticBlock';
  if (node.type === 'Program') {
    scope = { parent: null, bindings: new Map(), isVarScope: true, hasAstroGlobal: false };
  } else if (isVarScope || BLOCKS.has(node.type)) {
    scope = {
      parent: scope,
      bindings: new Map(),
      isVarScope,
      hasAstroGlobal: scope.hasAstroGlobal,
    };
  }
  if (isFunction) {
    if (node.id) scope.bindings.set(node.id.name, null);
    for (const param of node.params)
      for (const name of boundNames(param)) scope.bindings.set(name, null);
  }
  if (node.type === 'CatchClause')
    for (const name of boundNames(node.param)) scope.bindings.set(name, null);
  if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
    for (const specifier of node.specifiers)
      if (specifier.importKind !== 'type') scope.bindings.set(specifier.local.name, null);
  }
  if (node.type === 'VariableDeclaration') {
    let owner = scope;
    if (node.kind === 'var') while (owner.parent && !owner.isVarScope) owner = owner.parent;
    for (const { id, init } of node.declarations) {
      for (const name of boundNames(id)) {
        const previous = owner.bindings.get(name);
        if (node.kind === 'var' && previous) {
          if (init) previous.written = true;
          continue;
        }
        owner.bindings.set(
          name,
          id.type === 'Identifier' && init
            ? { node: init, scope, constant: node.kind === 'const', written: false }
            : null
        );
      }
    }
  }
  nodes.push({ node, scope });
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) collectNodes(child, scope, nodes);
    else collectNodes(value, scope, nodes);
  }
}

function bindingFor(scope, name) {
  for (let current = scope; current; current = current.parent)
    if (current.bindings.has(name)) return current.bindings.get(name);
}

/** Any write makes an initializer unreliable for static evaluation throughout its scope. */
function markBindingWrites(nodes) {
  for (const { node, scope } of nodes) {
    let target;
    switch (node.type) {
      case 'AssignmentExpression':
      case 'ForInStatement':
      case 'ForOfStatement':
        target = node.left;
        break;
      case 'UpdateExpression':
        target = node.argument;
        break;
      default:
        continue;
    }
    for (const name of boundNames(target)) {
      const binding = bindingFor(scope, name);
      if (binding) binding.written = true;
    }
  }
}

function unwrap(node) {
  while (
    node &&
    [
      'JSXExpressionContainer',
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TSTypeAssertion',
      'ChainExpression',
      'ParenthesizedExpression',
    ].includes(node.type)
  ) {
    node = node.expression;
  }
  return node;
}

/** Evaluate literal values and aliases without running project code. */
function staticValue(node, scope, seen = new Set()) {
  node = unwrap(node);
  switch (node?.type) {
    case 'Literal':
      return node.value;
    case 'Identifier': {
      const binding = bindingFor(scope, node.name);
      if (binding === undefined && node.name === 'Astro' && scope.hasAstroGlobal) return ASTRO;
      if (binding === undefined && node.name === 'undefined') return undefined;
      if (!binding || binding.written || seen.has(binding)) return UNKNOWN;
      const value = staticValue(binding.node, binding.scope, new Set(seen).add(binding));
      return binding.constant || value === ASTRO ? value : UNKNOWN;
    }
    case 'TemplateLiteral': {
      const values = node.expressions.map((expression) => staticValue(expression, scope, seen));
      if (values.some((value) => typeof value === 'symbol')) return UNKNOWN;
      return node.quasis
        .map(
          (part, index) => part.value.cooked + (index < values.length ? String(values[index]) : '')
        )
        .join('');
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return UNKNOWN;
      const left = staticValue(node.left, scope, seen);
      const right = staticValue(node.right, scope, seen);
      if (typeof left === 'symbol' || typeof right === 'symbol') return UNKNOWN;
      if (typeof left === 'string' || typeof right === 'string')
        return String(left) + String(right);
      return Number(left) + Number(right);
    }
    case 'ConditionalExpression': {
      const test = staticValue(node.test, scope, seen);
      if (typeof test === 'symbol') return UNKNOWN;
      return staticValue(test ? node.consequent : node.alternate, scope, seen);
    }
    default:
      return UNKNOWN;
  }
}

function propertyName(key, computed, scope) {
  if (!computed && key.type === 'Identifier') return key.name;
  const value = staticValue(key, scope);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function exportedNames(node) {
  if (node.type === 'ExportAllDeclaration') return ['*'];
  const { declaration, specifiers } = node;
  if (node.type === 'ExportDefaultDeclaration')
    return declaration.type === 'TSInterfaceDeclaration' ? [] : ['default'];
  if (declaration?.type === 'FunctionDeclaration') return [declaration.id?.name ?? 'default'];
  if (declaration?.type === 'VariableDeclaration')
    return declaration.declarations.map(({ id }) => (id.type === 'Identifier' ? id.name : null));
  if (declaration && !declaration.type.startsWith('TS')) return [null];
  return specifiers
    .filter((specifier) => specifier.exportKind !== 'type')
    .map(({ exported }) => exported.name ?? exported.value);
}

/** Ignore comments, and read custom property names from CSS words or quoted values. */
function cssVariables(css, inlineComments) {
  const tokens =
    /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[-\w\u0080-\uFFFF]+/gu;
  const pattern = inlineComments
    ? new RegExp(/\/\/[^\r\n]*/.source + '|' + tokens.source, 'gu')
    : tokens;
  const variables = new Set();
  for (const [token] of css.matchAll(pattern)) {
    const word = token[0] === '"' || token[0] === "'" ? token.slice(1, -1) : token;
    if (word.startsWith('--')) variables.add(word.slice(2));
  }
  return variables;
}

function lintElement(node, scope, report) {
  const { attributes, name } = node.openingElement;
  const only = attributes.find((attr) => attr.name?.name === 'client:only');
  if (only && (!only.value || typeof staticValue(only.value, scope) === 'symbol'))
    report(
      only,
      'missing-client-only-directive-value',
      '`client:only` needs a static renderer value.'
    );

  const directives = attributes.filter((attr) =>
    ['set:html', 'set:text'].includes(attr.name?.name)
  );
  const child = node.children.find(
    (item) => item.type !== 'AstroComment' && (item.type !== 'JSXText' || item.value.trim())
  );
  if (directives.length > 1 || (directives.length && child))
    report(
      directives[0],
      'no-conflict-set-directives',
      '`set:html` and `set:text` cannot be combined with each other or with child content.'
    );

  if (name.name !== 'style') return;
  const definition = attributes.find((attr) => attr.name?.name === 'define:vars');
  const expression = unwrap(definition?.value);
  const [css] = node.children;
  if (
    expression?.type !== 'ObjectExpression' ||
    node.children.length !== 1 ||
    css.type !== 'JSXText'
  )
    return;
  const lang = attributes.find((attr) => attr.name?.name === 'lang')?.value?.value;
  const used = cssVariables(css.value, lang && lang !== 'css');
  for (const prop of expression.properties) {
    if (prop.type !== 'Property') continue;
    const key = propertyName(prop.key, prop.computed, scope);
    if (key !== null && !used.has(key))
      report(prop.key, 'no-unused-define-vars-in-style', `'${key}' is defined but never used.`);
  }
}

/** Lint template and frontmatter constructs that need the full Astro AST. */
export function lintAstro(source, file) {
  const { ast, diagnostics } = parse(source);
  const findings = diagnostics
    .filter(({ severity }) => severity === 'error')
    .map(({ text, labels }) => ({
      file,
      line: labels[0]?.line,
      rule: 'astro/parse-error',
      message: text,
    }));
  if (findings.length) return findings;

  const report = (node, rule, message) =>
    findings.push({
      file,
      line: source.slice(0, node.start).split(/\r\n|\r|\n/).length,
      rule: `astro/${rule}`,
      message,
    });
  const reportDeprecated = (node, name) => {
    if (DEPRECATED_APIS.has(name))
      report(node, DEPRECATED_APIS.get(name), `Astro.${name} is deprecated.`);
  };
  const inPages = /(?:^|[/\\])pages[/\\]/.test(file);
  const frontmatter = new Set(ast.frontmatter?.program.body);
  const componentScope = {
    parent: null,
    bindings: new Map(),
    isVarScope: true,
    hasAstroGlobal: true,
  };
  const nodes = [];
  for (const node of frontmatter) collectNodes(node, componentScope, nodes);
  for (const node of ast.body) collectNodes(node, componentScope, nodes);
  markBindingWrites(nodes);
  for (const { node, scope } of nodes) {
    if (node.type === 'JSXElement') lintElement(node, scope, report);
    if (node.type === 'ImportDeclaration' && node.source.value === 'astro:content')
      for (const specifier of node.specifiers)
        if (
          specifier.imported?.name === 'getEntryBySlug' ||
          specifier.imported?.value === 'getEntryBySlug'
        )
          report(
            specifier,
            'no-deprecated-getentrybyslug',
            'Use getEntry() instead of getEntryBySlug().'
          );
    if (node.type === 'MemberExpression' && staticValue(node.object, scope) === ASTRO)
      reportDeprecated(node, propertyName(node.property, node.computed, scope));
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'ObjectPattern' &&
      staticValue(node.init, scope) === ASTRO
    )
      for (const prop of node.id.properties)
        if (prop.type === 'Property')
          reportDeprecated(prop.key, propertyName(prop.key, prop.computed, scope));

    if (
      frontmatter.has(node) &&
      node.type.startsWith('Export') &&
      node.type.endsWith('Declaration') &&
      node.exportKind !== 'type'
    ) {
      const names = exportedNames(node);
      if (names.some((name) => !ROUTE_EXPORTS.has(name)))
        report(
          node,
          'no-exports-from-components',
          'Only Astro route options and types can be exported from an .astro file.'
        );
      if (!inPages && names.includes('prerender'))
        report(
          node,
          'no-prerender-export-outside-pages',
          '`prerender` can only be exported from a pages/ directory.'
        );
    }
  }
  return findings;
}

export function lintAstroProject(root) {
  const { ignorePatterns } = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8'));
  const exclude = ignorePatterns.map((pattern) => pattern.replace(/\/\*\*$/, ''));
  return globSync('**/*.astro', { cwd: root, exclude })
    .sort()
    .flatMap((file) => lintAstro(readFileSync(join(root, file), 'utf8'), file));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = lintAstroProject(resolve(import.meta.dirname, '..'));
  if (findings.length) console.error(formatFindings(findings));
  console.log(`lint:astro - ${findings.length} error(s)`);
  process.exitCode = findings.length ? 1 : 0;
}
