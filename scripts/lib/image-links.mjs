const IMAGE_CONTENT = new Set(['a', 'img', 'picture', 'source', 'span', 'div', 'br', 'wbr']);
const NON_CONTENT = new Set(['script', 'style', 'template']);

function isHidden(element) {
  return element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true';
}

function imageName(image) {
  const role = image.getAttribute('role');
  if (role === 'none' || role === 'presentation') return '';
  return image.getAttribute('aria-label')?.trim() || image.getAttribute('alt')?.trim() || '';
}

function contentName(node, includeHidden = false) {
  if (node.nodeType === 3) return node.text;
  if (node.nodeType !== 1 || NON_CONTENT.has(node.rawTagName)) return '';
  if (!includeHidden && isHidden(node)) return '';
  if (node.rawTagName === 'img') return imageName(node);
  return node.childNodes
    .map((child) => contentName(child, includeHidden))
    .join(' ')
    .trim();
}

function referencedName(link, root) {
  const ids = link.getAttribute('aria-labelledby')?.trim();
  if (!ids) return undefined;
  const targets = ids
    .split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter(Boolean);
  if (!targets.length) return undefined;
  return targets
    .map((target) => contentName(target, isHidden(target)))
    .join(' ')
    .trim();
}

function linkName(link, root) {
  return (
    referencedName(link, root) ??
    (link.getAttribute('aria-label')?.trim() ||
      contentName(link) ||
      link.getAttribute('title')?.trim())
  );
}

/** Check the static image-link cases without guessing names for arbitrary embedded widgets. */
export function checkImageLinks(root, add) {
  for (const link of root.querySelectorAll('a[href]')) {
    if (!link.querySelector('img') || isHidden(link)) continue;
    if (link.querySelectorAll('*').some((node) => !IMAGE_CONTENT.has(node.rawTagName))) continue;
    if (!linkName(link, root))
      add(
        'image-link-name',
        'Image link to "' + link.getAttribute('href') + '" has no accessible name'
      );
  }
}
