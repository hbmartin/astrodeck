import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const QUERY = '?source-links&raw';
const PREFIX = '\0astrodeck:source-links:';

function documentPath(id) {
  if (!id.endsWith(QUERY)) return;
  return id.slice(0, -QUERY.length);
}

function importPath(id, root) {
  const path = documentPath(id);
  if (!path) return;
  if (path.startsWith('@root/')) return resolve(root, path.slice('@root/'.length));
  if (!isAbsolute(path)) return;
  // Vite tries a leading slash from the project root before an absolute filesystem path.
  const fromRoot = resolve(root, `.${path}`);
  return path.startsWith('/') && statSync(fromRoot, { throwIfNoEntry: false })?.isFile()
    ? fromRoot
    : path;
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
      const path = importPath(id, root);
      // A virtual ID prevents Vite from replacing the document's repository identity
      // with its real path before load, while reads still follow linked content.
      if (path) return `${PREFIX}${encodeURIComponent(path)}.js`;
    },
    async load(id) {
      const path = id.startsWith(PREFIX)
        ? decodeURIComponent(id.slice(PREFIX.length, -'.js'.length))
        : documentPath(id);
      // A load hook receives resolved IDs; never prepend the project root a second time.
      if (!path || !isAbsolute(path)) return;
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
