import { parse } from 'parse5';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** Parse one browser-compatible document; template contents remain a separate, inert tree. */
export const parseDocument = (html) => parse(html);

export function elementName(node) {
  return node.namespaceURI === HTML_NAMESPACE ? node.tagName : undefined;
}

export function attribute(node, name) {
  return node.attrs?.find((attr) => !attr.namespace && attr.name === name)?.value;
}

function* descendants(root) {
  for (const child of root.childNodes ?? []) {
    if (child.tagName) yield child;
    yield* descendants(child);
  }
}

export function findElements(root, predicate) {
  return [...descendants(root)].filter(predicate);
}

export function findById(root, id) {
  return findElements(root, (node) => attribute(node, 'id') === id)[0];
}

export function textContent(node) {
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes ?? []).map(textContent).join('');
}
