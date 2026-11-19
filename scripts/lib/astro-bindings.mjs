const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const BLOCKS = new Set(['BlockStatement', 'CatchClause', 'SwitchStatement']);
const LOOPS = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);
const STRAIGHT_LINE = { guards: [], loop: undefined };
const TYPE_ONLY_NODES = new Set([
  'TSDeclareFunction',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'EmptyStatement',
]);

const PATTERN_CHILDREN = new Map([
  ['TSParameterProperty', (node) => [node.parameter]],
  ['AssignmentPattern', (node) => [node.left]],
  ['RestElement', (node) => [node.argument]],
  ['ObjectPattern', (node) => node.properties.map((prop) => prop.value ?? prop.argument)],
  ['ArrayPattern', (node) => node.elements],
  ['VariableDeclaration', (node) => node.declarations.map(({ id }) => id)],
]);

function* boundNames(node) {
  node = unwrap(node);
  if (!node) return;
  if (node.type === 'Identifier') {
    yield node.name;
    return;
  }
  const children = PATTERN_CHILDREN.get(node.type)?.(node) ?? [];
  for (const child of children) yield* boundNames(child);
}

export function unwrap(node) {
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

function typeOnlyBody(node) {
  if (node.type === 'TSModuleDeclaration') return isTypeOnlyDeclaration(node.body);
  if (node.type === 'TSModuleBlock') return node.body.every(isTypeOnlyDeclaration);
  if (node.type === 'ExportNamedDeclaration')
    return node.exportKind === 'type' || isTypeOnlyDeclaration(node.declaration);
  return false;
}

export function isTypeOnlyDeclaration(node) {
  if (!node) return false;
  if (node.declare || TYPE_ONLY_NODES.has(node.type)) return true;
  return typeOnlyBody(node);
}

function makeScope(parent, region, isVarScope, hasAstroGlobal = parent?.hasAstroGlobal ?? false) {
  return {
    parent,
    region,
    isVarScope,
    hasAstroGlobal,
    bindings: new Map(),
    frames: parent?.frames ?? new WeakMap(),
  };
}

function declare(scope, name, constant = false) {
  if (!name || scope.bindings.has(name)) return;
  scope.bindings.set(name, { constant, region: scope.region, events: [], capturedWrite: false });
}

function declarePattern(scope, pattern, constant) {
  for (const name of boundNames(pattern)) declare(scope, name, constant);
}

function declareImports(scope, node) {
  if (node.importKind === 'type') return;
  for (const specifier of node.specifiers)
    if (specifier.importKind !== 'type') declare(scope, specifier.local.name);
}

function firstNamespaceName(id) {
  while (id?.type === 'TSQualifiedName') id = id.left;
  return id?.type === 'Identifier' ? id.name : undefined;
}

function declareNamespace(scope, node) {
  if (!isTypeOnlyDeclaration(node)) declare(scope, firstNamespaceName(node.id));
}

const DECLARATIONS = new Map([
  ['ImportDeclaration', declareImports],
  ['FunctionDeclaration', (scope, node) => declare(scope, node.id?.name)],
  ['ClassDeclaration', (scope, node) => declare(scope, node.id?.name)],
  ['TSEnumDeclaration', (scope, node) => declare(scope, node.id?.name)],
  ['TSModuleDeclaration', declareNamespace],
  [
    'TSImportEqualsDeclaration',
    (scope, node) => {
      if (node.importKind !== 'type') declare(scope, node.id?.name);
    },
  ],
]);

function varOwner(scope) {
  while (!scope.isVarScope) scope = scope.parent;
  return scope;
}

function variableOwner(scope, kind) {
  return kind === 'var' ? varOwner(scope) : scope;
}

function declareVariables(scope, { kind, declarations }) {
  const owner = variableOwner(scope, kind);
  for (const { id } of declarations) declarePattern(owner, id, kind === 'const');
}

function enter(scope, control, node) {
  if (node.type === 'Program')
    return { scope: makeScope(null, node, true), control: STRAIGHT_LINE };
  if (FUNCTIONS.has(node.type)) return enterFunction(scope, control, node);
  if (LOOPS.has(node.type))
    return {
      scope: makeScope(scope, scope.region, false),
      control: { ...control, loop: control.loop ?? node },
    };
  return { scope: enterBlock(scope, node), control };
}

function enterFunction(parent, control, node) {
  const scope = makeScope(parent, node, true);
  if (node.type === 'FunctionExpression') declare(scope, node.id?.name);
  for (const param of node.params) declarePattern(scope, param);
  return { scope, control: { guards: control.guards, loop: undefined } };
}

function enterBlock(parent, node) {
  if (node === parent.functionBody) return parent;
  const { region } = parent;
  if (node.type === 'TSModuleBlock' || node.type === 'StaticBlock')
    return makeScope(parent, region, true);
  if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
    const scope = makeScope(parent, region, false);
    declare(scope, node.id?.name);
    return scope;
  }
  if (!BLOCKS.has(node.type)) return parent;
  const scope = makeScope(parent, region, false);
  if (node.type === 'CatchClause') declarePattern(scope, node.param);
  return scope;
}

const CONDITIONAL_CHILD = new Map([
  ['ChainExpression', () => true],
  ['IfStatement', (key) => key !== 'test'],
  ['ConditionalExpression', (key) => key !== 'test'],
  ['LogicalExpression', (key) => key === 'right'],
  ['AssignmentPattern', (key) => key === 'right'],
  ['SwitchStatement', (key) => key === 'cases'],
  ['TryStatement', () => true],
  [
    'AssignmentExpression',
    (key, node) => key === 'right' && ['&&=', '||=', '??='].includes(node.operator),
  ],
  ['CallExpression', (key, node) => key === 'arguments' && node.optional],
]);

function childScope(node, key, child, scope) {
  if (key === 'body' && FUNCTIONS.has(node.type) && child?.type === 'BlockStatement')
    return { ...makeScope(scope, scope.region, true), functionBody: child };
  if (key === 'discriminant' && node.type === 'SwitchStatement') return scope.parent;
  return scope;
}

function childFrame(node, key, child, frame) {
  const scope = childScope(node, key, child, frame.scope);
  const { control } = frame;
  if (key === 'value' && node.type === 'PropertyDefinition' && !node.static)
    return {
      scope: makeScope(scope, node, true),
      control: { guards: control.guards, loop: undefined },
    };
  if (CONDITIONAL_CHILD.get(node.type)?.(key, node))
    return { scope, control: { ...control, guards: [...control.guards, child] } };
  return { scope, control };
}

function collect(node, frame, index) {
  if (!node?.type || node.declare) return;
  DECLARATIONS.get(node.type)?.(frame.scope, node);
  const current = enter(frame.scope, frame.control, node);
  if (node.type === 'VariableDeclaration') declareVariables(current.scope, node);
  index.push({ node, ...current });
  current.scope.frames.set(node, current.control);
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const child of value) collect(child, childFrame(node, key, child, current), index);
    } else {
      collect(value, childFrame(node, key, value, current), index);
    }
  }
}

function findBinding(scope, name) {
  for (let current = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
}

function recordEvent(binding, frame, site, value, initializer = false) {
  if (!binding) return;
  const { scope, control } = frame;
  if (binding.region !== scope.region) {
    binding.capturedWrite = true;
    return;
  }
  // A loop write may reach a read earlier in source on the next iteration.
  binding.events.push({
    position: binding.constant ? site.end : (control.loop?.start ?? site.end),
    scope,
    control,
    node: binding.constant && !initializer ? undefined : value,
    constant: binding.constant,
    initializer,
  });
}

function recordInitializers(frame, { declarations }) {
  for (const declaration of declarations) {
    const { id, init } = declaration;
    if (!init) continue;
    for (const name of boundNames(id)) {
      const value = id.type === 'Identifier' ? init : undefined;
      recordEvent(findBinding(frame.scope, name), frame, declaration, value, true);
    }
  }
}

function recordWrite(frame, site, target, value) {
  const pattern = unwrap(target);
  for (const name of boundNames(pattern)) {
    const binding = findBinding(frame.scope, name);
    recordEvent(binding, frame, site, pattern.type === 'Identifier' ? value : undefined);
  }
}

const WRITE_RULES = new Map([
  ['VariableDeclaration', recordInitializers],
  [
    'AssignmentExpression',
    (frame, node) =>
      recordWrite(frame, node, node.left, node.operator === '=' ? node.right : undefined),
  ],
  ['UpdateExpression', (frame, node) => recordWrite(frame, node, node.argument)],
  ['ForInStatement', (frame, node) => recordWrite(frame, node, node.left)],
  ['ForOfStatement', (frame, node) => recordWrite(frame, node, node.left)],
]);

/** Index bindings before collecting writes so a later declaration can shadow an outer name. */
export function indexAstroNodes(body, frontmatter) {
  const frame = { scope: makeScope(null, {}, true, true), control: STRAIGHT_LINE };
  const index = [];
  for (const node of frontmatter) collect(node, frame, index);
  for (const node of body) collect(node, frame, index);
  for (const entry of index) WRITE_RULES.get(entry.node.type)?.(entry, entry.node);
  return index;
}

function precedingEvent(binding, node) {
  let last;
  for (const event of binding.events) {
    if (event.position > node.start) continue;
    if (!last || event.position >= last.position) last = event;
  }
  return last;
}

export function bindingAt(node, scope) {
  const binding = findBinding(scope, node.name);
  if (!binding) return undefined;
  if (binding.capturedWrite) return null;
  if (binding.region !== scope.region && !binding.constant) return null;
  const event = precedingEvent(binding, node);
  if (!event?.node || (event.control.loop && !(binding.constant && event.initializer))) return null;
  const guards = scope.frames.get(node)?.guards;
  return event.control.guards.every((guard) => guards?.includes(guard)) ? event : null;
}
