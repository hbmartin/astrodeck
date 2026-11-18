import { attribute, elementName, findElements } from './html-tree.mjs';
import { imageControlNames } from './image-names.mjs';

function imageControl(node) {
  const name = elementName(node);
  return name === 'button' || (name === 'a' && attribute(node, 'href') !== undefined);
}

/** Check native image controls without guessing accessible names for embedded widgets. */
export function checkImageControls(root, add) {
  const names = imageControlNames(root);
  for (const control of findElements(root, imageControl)) {
    if (names.isHidden(control)) continue;
    if (!findElements(control, (node) => elementName(node) === 'img').length) continue;
    if (!names.isEmpty(control)) continue;
    const link = elementName(control) === 'a';
    add(
      link ? 'image-link-name' : 'image-button-name',
      link
        ? `Image link to "${attribute(control, 'href')}" has no accessible name`
        : 'Image button has no accessible name'
    );
  }
}
