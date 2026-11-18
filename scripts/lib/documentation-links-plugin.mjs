import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const QUERY = '?source-links&raw';
const PREFIX = '\0astrodeck:source-links:';

function documentPath(id, root) {
  if (!id.endsWith(QUERY)) return;
  const path = id.slice(0, -QUERY.length);
  if (path.startsWith('@root/')) return resolve(root, path.slice('@root/'.length));
  if (isAbsolute(path)) return path;
}

/** Resolve source-document links during the build, before runtime endpoint modules are emitted. */
export function documentationLinksPlugin() {
  let root;
  return {
    name: 'astrodeck:source-links',
    enforce: 'pre',
    configResolved(config) {
      // Keep the lexical checkout path: real paths can point outside it through symlinks.
      root = resolve(config.root);
    },
    resolveId(id) {
      const path = documentPath(id, root);
      // A virtual ID prevents Vite from replacing the document's repository identity
      // with its real path before load, while reads still follow linked content.
      if (path) return `${PREFIX}${encodeURIComponent(path)}.js`;
    },
    async load(id) {
      const path = id.startsWith(PREFIX)
        ? decodeURIComponent(id.slice(PREFIX.length, -'.js'.length))
        : documentPath(id, root);
      if (!path) return;
      this.addWatchFile(path);
      const realPath = realpathSync(path);
      if (realPath !== path) this.addWatchFile(realPath);
      const source = relative(root, path).split(sep).join('/');
      if (source === '..' || source.startsWith('../') || isAbsolute(source)) {
        throw new Error(`Source document is outside the repository: ${path}`);
      }
      // Cleaned sites do not import this query and never load the Markdown parser.
      const { absoluteSourceLinks } = await import('../../src/lib/documentation-links.mjs');
      const text = absoluteSourceLinks(readFileSync(path, 'utf8'), source);
      return `export default ${JSON.stringify(text)};`;
    },
  };
}
