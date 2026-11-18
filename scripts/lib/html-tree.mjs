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
  const stack = [{ children: root.childNodes ?? [], index: 0 }];
  while (stack.length) {
    const frame = stack.at(-1);
    const child = frame.children[frame.index++];
    if (!child) {
      stack.pop();
      continue;
    }
    if (child.tagName) yield child;
    if (child.childNodes?.length) stack.push({ children: child.childNodes, index: 0 });
  }
}

export function findElements(root, predicate) {
  return [...descendants(root)].filter(predicate);
}

export function findFirstElement(root, predicate) {
  for (const node of descendants(root)) if (predicate(node)) return node;
}

export function textContent(node) {
  const chunks = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current.nodeName === '#text') chunks.push(current.value);
    const children = current.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return chunks.join('');
}
