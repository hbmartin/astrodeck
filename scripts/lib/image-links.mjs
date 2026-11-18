import { attribute, elementName, findById, findElements } from './html-tree.mjs';

const NON_CONTENT = new Set(['script', 'style', 'template']);
const EMBEDDED = new Set(['canvas', 'iframe', 'object', 'embed', 'audio', 'video']);

function isHidden(element) {
  for (let current = element; current; current = current.parentNode) {
    if (
      attribute(current, 'hidden') !== undefined ||
      attribute(current, 'aria-hidden')?.toLowerCase() === 'true'
    )
      return true;
  }
  return false;
}

function imageName(image) {
  const role = attribute(image, 'role');
  if (role === 'none' || role === 'presentation') return '';
  return attribute(image, 'aria-label')?.trim() || attribute(image, 'alt')?.trim() || '';
}

/** null means an unsupported widget may provide a name that static HTML cannot establish. */
function combineNames(names) {
  const text = names
    .filter((name) => name !== null)
    .join(' ')
    .trim();
  return text || (names.includes(null) ? null : '');
}

function unsupportedContent(name) {
  return !name || EMBEDDED.has(name) || name.includes('-');
}

function contentName(node, includeHidden = false) {
  if (node.nodeName === '#text') return node.value;
  if (!node.tagName || NON_CONTENT.has(elementName(node))) return '';
  if (!includeHidden && isHidden(node)) return '';
  const name = elementName(node);
  if (name === 'img') return imageName(node);
  if (unsupportedContent(name)) return null;
  return combineNames((node.childNodes ?? []).map((child) => contentName(child, includeHidden)));
}

function referencedName(control, root) {
  const ids = attribute(control, 'aria-labelledby')?.trim();
  if (!ids) return undefined;
  const targets = ids
    .split(/\s+/)
    .map((id) => findById(root, id))
    .filter(Boolean);
  if (!targets.length) return undefined;
  return combineNames(targets.map((target) => contentName(target, isHidden(target))));
}

function controlName(control, root) {
  const referenced = referencedName(control, root);
  if (referenced !== undefined) return referenced;
  const label = attribute(control, 'aria-label')?.trim();
  if (label) return label;
  const content = contentName(control);
  return content || attribute(control, 'title')?.trim() || content;
}

function imageControl(node) {
  const name = elementName(node);
  return name === 'button' || (name === 'a' && attribute(node, 'href') !== undefined);
}

/** Check native image controls without guessing accessible names for embedded widgets. */
export function checkImageControls(root, add) {
  for (const control of findElements(root, imageControl)) {
    if (isHidden(control)) continue;
    if (!findElements(control, (node) => elementName(node) === 'img').length) continue;
    if (controlName(control, root) !== '') continue;
    const link = elementName(control) === 'a';
    add(
      link ? 'image-link-name' : 'image-button-name',
      link
        ? `Image link to "${attribute(control, 'href')}" has no accessible name`
        : 'Image button has no accessible name'
    );
  }
}
