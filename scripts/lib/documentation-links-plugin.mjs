import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { absoluteSourceLinks } from '../../src/lib/documentation-links.mjs';

const QUERY = '?source-links&raw';

/** Resolve source-document links during the build, before runtime endpoint modules are emitted. */
export function documentationLinksPlugin() {
  let root;
  return {
    name: 'astrodeck:source-links',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    load(id) {
      if (!id.endsWith(QUERY)) return;
      const path = id.slice(0, -QUERY.length);
      this.addWatchFile(path);
      const source = relative(root, path).split(sep).join('/');
      const text = absoluteSourceLinks(readFileSync(path, 'utf8'), source);
      return `export default ${JSON.stringify(text)};`;
    },
  };
}
