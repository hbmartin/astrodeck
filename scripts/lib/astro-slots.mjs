import { transform } from '@astrojs/compiler-rs';
import ts from 'typescript';

/** Collect cooked text with its interpolation boundaries, using Astro's actual compaction. */
function collectRenderText(node, text) {
  if (
    ts.isTaggedTemplateExpression(node) &&
    ts.isIdentifier(node.tag) &&
    node.tag.text === '$$render'
  ) {
    const { template } = node;
    if (ts.isNoSubstitutionTemplateLiteral(template)) text.push([template.text]);
    else
      text.push([template.head.text, ...template.templateSpans.map((span) => span.literal.text)]);
  }
  ts.forEachChild(node, (child) => collectRenderText(child, text));
}

function collectSlots(node, component, output) {
  if (ts.isPropertyAssignment(node) && ts.isArrowFunction(node.initializer)) {
    const text = [];
    collectRenderText(node.initializer.body, text);
    const slot = ts.isComputedPropertyName(node.name) ? '[computed]' : node.name.text;
    if (text.length) output.push({ component, slot, text });
    return;
  }
  ts.forEachChild(node, (child) => collectSlots(child, component, output));
}

function compiledSlots(source, file, compact) {
  const { code, diagnostics } = transform(source, { filename: file, compact });
  const error = diagnostics.find(({ severity }) => severity === 'error');
  if (error) throw new Error(`${file}: Astro compilation failed: ${error.text}`);

  const compiled = ts.createSourceFile('compiled.js', code, ts.ScriptTarget.Latest, false);
  const slots = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === '$$renderComponent'
    ) {
      const [, name, , , children] = node.arguments;
      if (children && ts.isStringLiteral(name)) collectSlots(children, name.text, slots);
    }
    ts.forEachChild(node, visit);
  };
  visit(compiled);
  return slots;
}

/** Return labels for slots whose emitted text changes between two versions of an Astro file. */
export function changedAstroSlots(before, after, file, compact) {
  const original = compiledSlots(before, file, compact);
  const formatted = compiledSlots(after, file, compact);
  const labels = new Set();
  for (let index = 0; index < Math.max(original.length, formatted.length); index++) {
    const oldSlot = original[index];
    const newSlot = formatted[index];
    if (JSON.stringify(oldSlot) === JSON.stringify(newSlot)) continue;
    for (const slot of [oldSlot, newSlot]) {
      if (slot) labels.add(`${slot.component} (${slot.slot})`);
    }
  }
  return [...labels];
}
