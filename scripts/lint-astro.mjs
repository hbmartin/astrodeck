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

const PATTERN_CHILDREN = new Map([
  ['AssignmentPattern', (node) => [node.left]],
  ['RestElement', (node) => [node.argument]],
  ['ObjectPattern', (node) => node.properties.map((prop) => prop.value ?? prop.argument)],
  ['ArrayPattern', (node) => node.elements],
  ['VariableDeclaration', (node) => node.declarations.map(({ id }) => id)],
]);

function* boundNames(pattern) {
  const node = unwrap(pattern);
  if (!node) return;
  if (node.type === 'Identifier') {
    yield node.name;
    return;
  }
  for (const child of PATTERN_CHILDREN.get(node.type)?.(node) ?? []) yield* boundNames(child);
}

function markName(scope, node) {
  if (node.id) scope.bindings.set(node.id.name, null);
}

function nodeScope(node, parent) {
  if (node.type === 'Program')
    return { parent: null, bindings: new Map(), isVarScope: true, hasAstroGlobal: false };
  const isVarScope = FUNCTIONS.has(node.type) || node.type === 'StaticBlock';
  if (!isVarScope && !BLOCKS.has(node.type)) return parent;
  return { parent, bindings: new Map(), isVarScope, hasAstroGlobal: parent.hasAstroGlobal };
}

function markPattern(scope, pattern) {
  for (const name of boundNames(pattern)) scope.bindings.set(name, null);
}

function markFunction(scope, node) {
  markName(scope, node);
  for (const param of node.params) markPattern(scope, param);
}

function markImports(scope, node) {
  if (node.importKind === 'type') return;
  for (const specifier of node.specifiers)
    if (specifier.importKind !== 'type') scope.bindings.set(specifier.local.name, null);
}

function varOwner(scope) {
  while (scope.parent && !scope.isVarScope) scope = scope.parent;
  return scope;
}

function initializerBinding(id, init, scope, kind) {
  if (id.type !== 'Identifier' || !init) return null;
  return { node: init, scope, constant: kind === 'const', written: false };
}

function markDeclaredName(owner, name, id, init, scope, kind) {
  const previous = owner.bindings.get(name);
  if (kind === 'var' && previous) {
    if (init) previous.written = true;
    return;
  }
  owner.bindings.set(name, initializerBinding(id, init, scope, kind));
}

function markVariables(scope, { kind, declarations }) {
  const owner = kind === 'var' ? varOwner(scope) : scope;
  for (const { id, init } of declarations)
    for (const name of boundNames(id)) markDeclaredName(owner, name, id, init, scope, kind);
}

const BINDINGS = new Map([
  ['CatchClause', (scope, node) => markPattern(scope, node.param)],
  ['ImportDeclaration', markImports],
  ['VariableDeclaration', markVariables],
]);

/** Index bindings before checking references so a later declaration can shadow an outer name. */
function collectNodes(node, parent, nodes) {
  if (!node?.type) return;
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration')
    markName(parent, node);
  const scope = nodeScope(node, parent);
  if (FUNCTIONS.has(node.type)) markFunction(scope, node);
  BINDINGS.get(node.type)?.(scope, node);
  nodes.push({ node, scope });
  collectChildren(node, scope, nodes);
}

function collectChildren(node, scope, nodes) {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) collectNodes(child, scope, nodes);
    } else {
      collectNodes(value, scope, nodes);
    }
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

function identifierValue(node, scope, seen) {
  const binding = bindingFor(scope, node.name);
  if (binding === undefined) return globalValue(node.name, scope);
  if (!binding || binding.written || seen.has(binding)) return UNKNOWN;
  const value = staticValue(binding.node, binding.scope, new Set(seen).add(binding));
  return binding.constant || value === ASTRO ? value : UNKNOWN;
}

function globalValue(name, scope) {
  if (name === 'Astro' && scope.hasAstroGlobal) return ASTRO;
  return name === 'undefined' ? undefined : UNKNOWN;
}

function templateValue(node, scope, seen) {
  const values = node.expressions.map((expression) => staticValue(expression, scope, seen));
  if (values.some((value) => typeof value === 'symbol')) return UNKNOWN;
  return node.quasis
    .map((part, index) => part.value.cooked + (index < values.length ? String(values[index]) : ''))
    .join('');
}

function addValues(left, right) {
  if (typeof left === 'symbol' || typeof right === 'symbol') return UNKNOWN;
  if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
  return Number(left) + Number(right);
}

function binaryValue(node, scope, seen) {
  if (node.operator !== '+') return UNKNOWN;
  return addValues(staticValue(node.left, scope, seen), staticValue(node.right, scope, seen));
}

function conditionalValue(node, scope, seen) {
  const test = staticValue(node.test, scope, seen);
  if (typeof test === 'symbol') return UNKNOWN;
  return staticValue(test ? node.consequent : node.alternate, scope, seen);
}

const STATIC_VALUES = new Map([
  ['Literal', (node) => node.value],
  ['Identifier', identifierValue],
  ['TemplateLiteral', templateValue],
  ['BinaryExpression', binaryValue],
  ['ConditionalExpression', conditionalValue],
]);

/** Evaluate literal values and aliases without running project code. */
function staticValue(node, scope, seen = new Set()) {
  const expression = unwrap(node);
  const evaluate = STATIC_VALUES.get(expression?.type);
  return evaluate ? evaluate(expression, scope, seen) : UNKNOWN;
}

function propertyName(key, computed, scope) {
  if (!computed && key.type === 'Identifier') return key.name;
  const value = staticValue(key, scope);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

const TYPE_ONLY_NODES = new Set([
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'EmptyStatement',
]);

function typeOnlyBody(node) {
  if (node.type === 'TSModuleDeclaration') return isTypeOnlyDeclaration(node.body);
  if (node.type === 'TSModuleBlock') return node.body.every(isTypeOnlyDeclaration);
  if (node.type === 'ExportNamedDeclaration')
    return node.exportKind === 'type' || isTypeOnlyDeclaration(node.declaration);
  return false;
}

function isTypeOnlyDeclaration(node) {
  if (!node) return false;
  if (node.declare || TYPE_ONLY_NODES.has(node.type)) return true;
  return typeOnlyBody(node);
}

function exportedNames(node) {
  if (node.type === 'ExportAllDeclaration') return ['*'];
  const { declaration, specifiers } = node;
  if (isTypeOnlyDeclaration(declaration)) return [];
  if (node.type === 'ExportDefaultDeclaration') return ['default'];
  if (declaration) return declaredNames(declaration);
  return specifiers
    .filter((specifier) => specifier.exportKind !== 'type')
    .map(({ exported }) => exported.name ?? exported.value);
}

function declaredNames(declaration) {
  if (declaration.type === 'FunctionDeclaration') return [declaration.id?.name ?? 'default'];
  if (declaration.type === 'VariableDeclaration')
    return declaration.declarations.map(({ id }) => (id.type === 'Identifier' ? id.name : null));
  return [null];
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
  lintClientOnly(attributes, scope, report);
  lintSetDirectives(attributes, node.children, report);
  if (name.name === 'style') lintStyleVars(attributes, node.children, scope, report);
}

function lintClientOnly(attributes, scope, report) {
  const only = attributes.find((attr) => attr.name?.name === 'client:only');
  if (only) {
    const renderer = staticValue(only.value, scope);
    if (typeof renderer !== 'string' || !renderer.trim())
      report(
        only,
        'missing-client-only-directive-value',
        '`client:only` needs a nonblank static renderer name.'
      );
  }
}

function hasContent(item) {
  if (item.type === 'AstroComment') return false;
  if (item.type === 'JSXExpressionContainer' && item.expression?.type === 'JSXEmptyExpression')
    return false;
  return item.type !== 'JSXText' || item.value.trim();
}

function lintSetDirectives(attributes, children, report) {
  const directives = attributes.filter((attr) =>
    ['set:html', 'set:text'].includes(attr.name?.name)
  );
  if (directives.length > 1 || (directives.length && children.some(hasContent)))
    report(
      directives[0],
      'no-conflict-set-directives',
      '`set:html` and `set:text` cannot be combined with each other or with child content.'
    );
}

function lintStyleVars(attributes, children, scope, report) {
  const definition = attributes.find((attr) => attr.name?.name === 'define:vars');
  const expression = unwrap(definition?.value);
  const [css] = children;
  if (expression?.type !== 'ObjectExpression' || children.length !== 1 || css.type !== 'JSXText')
    return;
  const lang = attributes.find((attr) => attr.name?.name === 'lang')?.value?.value;
  const used = cssVariables(css.value, lang && lang !== 'css');
  for (const prop of expression.properties) checkStyleVar(prop, used, scope, report);
}

function checkStyleVar(prop, used, scope, report) {
  if (prop.type !== 'Property') return;
  const key = propertyName(prop.key, prop.computed, scope);
  if (key !== null && !used.has(key))
    report(prop.key, 'no-unused-define-vars-in-style', `'${key}' is defined but never used.`);
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
  const inPages = /(?:^|[/\\])pages[/\\]/.test(file);
  const frontmatter = new Set(ast.frontmatter?.program.body);
  for (const { node, scope } of indexAstroNodes(ast.body, frontmatter)) {
    ASTRO_NODE_RULES.get(node.type)?.(node, scope, report);
    if (frontmatter.has(node)) lintAstroExport(node, inPages, report);
  }
  return findings;
}

function indexAstroNodes(body, frontmatter) {
  const componentScope = {
    parent: null,
    bindings: new Map(),
    isVarScope: true,
    hasAstroGlobal: true,
  };
  const nodes = [];
  for (const node of frontmatter) collectNodes(node, componentScope, nodes);
  for (const node of body) collectNodes(node, componentScope, nodes);
  markBindingWrites(nodes);
  return nodes;
}

function lintContentImport(node, _scope, report) {
  if (node.source.value !== 'astro:content') return;
  for (const specifier of node.specifiers) {
    const { imported } = specifier;
    if ((imported?.name ?? imported?.value) === 'getEntryBySlug')
      report(
        specifier,
        'no-deprecated-getentrybyslug',
        'Use getEntry() instead of getEntryBySlug().'
      );
  }
}

function reportDeprecated(node, name, report) {
  if (DEPRECATED_APIS.has(name))
    report(node, DEPRECATED_APIS.get(name), `Astro.${name} is deprecated.`);
}

function lintAstroMember(node, scope, report) {
  if (staticValue(node.object, scope) === ASTRO)
    reportDeprecated(node, propertyName(node.property, node.computed, scope), report);
}

function lintAstroPattern(node, scope, report) {
  if (node.id.type !== 'ObjectPattern' || staticValue(node.init, scope) !== ASTRO) return;
  for (const prop of node.id.properties)
    if (prop.type === 'Property')
      reportDeprecated(prop.key, propertyName(prop.key, prop.computed, scope), report);
}

const ASTRO_NODE_RULES = new Map([
  ['JSXElement', lintElement],
  ['ImportDeclaration', lintContentImport],
  ['MemberExpression', lintAstroMember],
  ['VariableDeclarator', lintAstroPattern],
]);

function isValueExport(node) {
  return (
    node.type.startsWith('Export') &&
    node.type.endsWith('Declaration') &&
    node.exportKind !== 'type'
  );
}

function lintAstroExport(node, inPages, report) {
  if (!isValueExport(node)) return;
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

export function lintAstroProject(root) {
  const { ignorePatterns = [] } = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8'));
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
