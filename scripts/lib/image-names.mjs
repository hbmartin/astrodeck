import { attribute, elementName, findElements, findFirstElement } from './html-tree.mjs';

const EMPTY = 0;
const NAMED = 1;
const UNKNOWN = 2;
const ACTIVE = -1;
const NON_CONTENT = new Set(['script', 'style', 'template', 'noscript']);
const EMBEDDED = new Set([
  'canvas',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'input',
  'select',
  'textarea',
  'meter',
  'progress',
]);
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);
const PRESENTATION = new Set(['none', 'presentation']);
// Concrete ARIA roles: fallback lists use the first recognized token, not the whole attribute.
const ROLES = new Set(
  `alert alertdialog application article banner blockquote button caption cell checkbox code
  columnheader combobox complementary contentinfo definition deletion dialog
  directory document emphasis feed figure form generic grid gridcell group heading img
  insertion link list listbox listitem log main mark marquee math menu menubar menuitem
  menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar
  radio radiogroup region row rowgroup rowheader scrollbar search searchbox
  separator slider spinbutton status strong subscript suggestion
  superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid
  treeitem graphics-document graphics-object graphics-symbol
  doc-abstract doc-acknowledgments doc-afterword doc-appendix doc-backlink doc-biblioentry
  doc-bibliography doc-biblioref doc-chapter doc-colophon doc-conclusion doc-cover doc-credit
  doc-credits doc-dedication doc-endnote doc-endnotes doc-epigraph doc-epilogue doc-errata
  doc-example doc-footnote doc-foreword doc-glossary doc-glossref doc-index doc-introduction
  doc-noteref doc-notice doc-pagebreak doc-pagefooter doc-pageheader doc-pagelist doc-part
  doc-preface doc-prologue doc-pullquote doc-qna doc-subtitle doc-tip doc-toc`.split(/\s+/u)
);
// Chromium ignores generic div/span/i tooltips when naming an ancestor from content.
const TITLELESS_DESCENDANTS = new Set(['div', 'span', 'i']);

const textState = (value) => (value?.trim() ? NAMED : EMPTY);
const combine = (left, right) => {
  if (left === NAMED || right === NAMED) return NAMED;
  return left === UNKNOWN || right === UNKNOWN ? UNKNOWN : EMPTY;
};

function untilFound(node) {
  return attribute(node, 'hidden')?.toLowerCase() === 'until-found';
}

function ownHidden(node) {
  return (
    (attribute(node, 'hidden') !== undefined && !untilFound(node)) ||
    attribute(node, 'aria-hidden')?.toLowerCase() === 'true'
  );
}

function labelable(node) {
  const name = elementName(node);
  return (
    LABELABLE.has(name) &&
    !(name === 'input' && attribute(node, 'type')?.toLowerCase() === 'hidden')
  );
}

function associateLabels(nodes, ids) {
  const labels = new Map();
  for (const node of nodes) {
    if (elementName(node) !== 'label') continue;
    const target =
      attribute(node, 'for') === undefined
        ? findFirstElement(node, labelable)
        : ids.get(attribute(node, 'for'));
    if (!target || !labelable(target)) continue;
    if (!labels.has(target)) labels.set(target, []);
    labels.get(target).push(node);
  }
  return labels;
}

function documentContext(root) {
  const nodes = findElements(root, () => true);
  const ids = new Map();
  const hidden = new WeakMap();
  const serials = new WeakMap();
  const uncertainVisibility = new WeakMap();
  for (const [index, node] of nodes.entries()) {
    serials.set(node, index + 1);
    hidden.set(node, ownHidden(node) || hidden.get(node.parentNode) === true);
    uncertainVisibility.set(
      node,
      untilFound(node) || uncertainVisibility.get(node.parentNode) === true
    );
    const id = attribute(node, 'id');
    if (id && !ids.has(id)) ids.set(id, node);
  }
  return {
    ids,
    hidden,
    serials,
    uncertainVisibility,
    labels: associateLabels(nodes, ids),
    cache: new WeakMap(),
    active: new WeakMap(),
  };
}

const task = (
  node,
  { context = 'descendant', reference = false, includeHidden = false, exclude } = {}
) => ({
  node,
  context,
  reference,
  includeHidden,
  exclude,
});
const group = (tasks, terminal = false) => ({ tasks, terminal });
const literal = (value) => ({ value });

function references(node, state) {
  return (attribute(node, 'aria-labelledby')?.trim().split(/\s+/u) ?? [])
    .map((id) => state.ids.get(id))
    .filter(Boolean)
    .map((target) =>
      task(target, {
        context: 'reference',
        reference: true,
        includeHidden: state.hidden.get(target) === true,
      })
    );
}

function explicitRole(node) {
  return attribute(node, 'role')
    ?.toLowerCase()
    .split(/[\t\n\f\r ]+/u)
    .find((role) => ROLES.has(role));
}

function presentationState(node) {
  if (!PRESENTATION.has(explicitRole(node))) return;
  const restores = ['tabindex', 'aria-label', 'aria-labelledby', 'aria-describedby'];
  if (restores.some((name) => attribute(node, name) !== undefined)) return;
  const unsupported = node.attrs.some(
    (attr) => attr.name.startsWith('aria-') && attr.name !== 'aria-hidden'
  );
  return unsupported ? UNKNOWN : EMPTY;
}

function imageSources(node) {
  const presentation = presentationState(node);
  if (presentation !== undefined) return [group([literal(presentation)], true)];
  const alt = attribute(node, 'alt');
  if (alt !== undefined) return [group([literal(textState(alt))], true)];
  return [group([literal(textState(attribute(node, 'title')))], true)];
}

function nativeLabelSources(current, state) {
  const { node } = current;
  if (current.context !== 'control' || elementName(node) !== 'button' || !state.labels.has(node))
    return;
  const labels = state.labels.get(node).map((label) =>
    task(label, {
      context: 'reference',
      reference: current.reference,
      exclude: node,
    })
  );
  return [group(labels, true)];
}

function contentSources(current, state) {
  const { node } = current;
  const name = elementName(node);
  if (name === 'img') return imageSources(node);
  if (hiddenInput(node)) return [group([literal(textState(attribute(node, 'title')))], true)];
  const labels = nativeLabelSources(current, state);
  if (labels) return labels;
  if (!name || EMBEDDED.has(name) || name.includes('-')) return [group([literal(UNKNOWN)], true)];
  return [
    group(
      (node.childNodes ?? []).map((child) => task(child, { ...current, context: 'descendant' }))
    ),
    group([literal(titleState(current))]),
  ];
}

function titleState({ node, context }) {
  const title = textState(attribute(node, 'title'));
  if (context !== 'descendant' || title === EMPTY) return title;
  if (TITLELESS_DESCENDANTS.has(elementName(node)) && !explicitRole(node)) return EMPTY;
  // Other descendant tooltip contexts depend on semantics outside this supported subset.
  return UNKNOWN;
}

function sources(current, state) {
  const result = [];
  if (!current.reference) {
    const targets = references(current.node, state);
    if (targets.length) result.push(group(targets));
  }
  result.push(group([literal(textState(attribute(current.node, 'aria-label')))]));
  return [...result, ...contentSources(current, state)];
}

function hiddenInput(node) {
  return elementName(node) === 'input' && attribute(node, 'type')?.toLowerCase() === 'hidden';
}

function excludedSource(current, state) {
  const { node } = current;
  if (node === current.exclude) return true;
  const hidden = state.hidden.get(node) ?? state.hidden.get(node.parentNode);
  if (!current.includeHidden && hidden) return true;
  return current.context !== 'reference' && hiddenInput(node);
}

function immediate(current, state) {
  if (current.value !== undefined) return current.value;
  if (excludedSource(current, state)) return EMPTY;
  const { node } = current;
  // until-found relies on CSS display/content-visibility; parsed HTML cannot establish visibility.
  if (state.uncertainVisibility.get(node) ?? state.uncertainVisibility.get(node.parentNode))
    return UNKNOWN;
  if (node.nodeName === '#text') return textState(node.value);
  if (!node.tagName || NON_CONTENT.has(elementName(node))) return EMPTY;
}

function cacheEntry(current, state) {
  const { node } = current;
  if (!state.cache.has(node)) state.cache.set(node, new Map());
  const key = `${current.context}/${current.reference}/${current.includeHidden}/${state.serials.get(current.exclude) ?? 0}`;
  return { node, values: state.cache.get(node), key };
}

function start(current, state) {
  const value = immediate(current, state);
  if (value !== undefined) return { value };
  if (current.reference && state.active.get(current.node) && state.labels.has(current.node))
    return { value: UNKNOWN };
  const entry = cacheEntry(current, state);
  const cached = entry.values.get(entry.key);
  if (cached !== undefined) return { value: cached === ACTIVE ? UNKNOWN : cached };
  entry.values.set(entry.key, ACTIVE);
  state.active.set(current.node, (state.active.get(current.node) ?? 0) + 1);
  return {
    entry,
    groups: sources(current, state),
    source: 0,
    child: 0,
    value: EMPTY,
    fallback: EMPTY,
  };
}

function finish(stack, value, state) {
  const frame = stack.pop();
  frame.entry.values.set(frame.entry.key, value);
  state.active.set(frame.entry.node, state.active.get(frame.entry.node) - 1);
  if (stack.length) stack.at(-1).value = combine(stack.at(-1).value, value);
  return value;
}

function evaluate(node, state) {
  const first = start(task(node, { context: 'control' }), state);
  if (!first.entry) return first.value;
  const stack = [first];
  let result = EMPTY;
  while (stack.length) {
    const frame = stack.at(-1);
    const source = frame.groups[frame.source];
    if (!source || frame.value === NAMED) {
      result = finish(stack, combine(frame.fallback, frame.value), state);
    } else if (frame.child < source.tasks.length) {
      const child = start(source.tasks[frame.child++], state);
      if (child.entry) stack.push(child);
      else frame.value = combine(frame.value, child.value);
    } else if (source.terminal) {
      result = finish(stack, combine(frame.fallback, frame.value), state);
    } else {
      frame.fallback = combine(frame.fallback, frame.value);
      frame.source++;
      frame.child = 0;
      frame.value = EMPTY;
    }
  }
  return result;
}

/** Static name emptiness for the supported native image controls; uncertain widgets stay unknown. */
export function imageControlNames(root) {
  const state = documentContext(root);
  return {
    isHidden: (node) => state.hidden.get(node) === true,
    isEmpty: (node) => evaluate(node, state) === EMPTY,
  };
}
