import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const QUERY = '?source-links&raw';
const PREFIX = '\0astrodeck:source-links:';
const NAME = 'astrodeck:source-links';

function documentPath(id) {
  if (!id.endsWith(QUERY)) return;
  return id.slice(0, -QUERY.length);
}

function isFile(path) {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile();
  } catch {
    // A failed root-candidate probe still permits Vite's absolute filesystem fallback.
    return false;
  }
}

function importPath(id, root, importer) {
  const path = documentPath(id);
  if (!path) return;
  if (path.startsWith('@root/')) return resolve(root, path.slice('@root/'.length));
  if (/^\.\.?\//u.test(path)) {
    if (!importer || !isAbsolute(importer)) return;
    // Match Vite's importer base without treating literal pathname punctuation as a suffix.
    return resolve(dirname(importer), path);
  }
  if (!isAbsolute(path)) return;
  // Vite tries a leading slash from the project root before an absolute filesystem path.
  const fromRoot = resolve(root, `.${path}`);
  return path.startsWith('/') && isFile(fromRoot) ? fromRoot : path;
}

function repositorySource(path, root) {
  const source = relative(root, path).split(sep).join('/');
  if (source === '..' || source.startsWith('../') || isAbsolute(source)) {
    throw new Error(`Source document is outside the repository: ${path}`);
  }
  return source;
}

function documentError(cause, path, moduleInfo) {
  const context = moduleInfo?.meta?.[NAME];
  const request = context
    ? ` requested as ${JSON.stringify(context.request)}${context.importer ? ` from ${JSON.stringify(context.importer)}` : ''}`
    : '';
  const error = new Error(
    `Cannot load source document ${JSON.stringify(path)}${request}: ${cause.message}`,
    { cause }
  );
  if (cause.code) error.code = cause.code;
  return error;
}

/** Resolve source-document links during the build, before runtime endpoint modules are emitted. */
export function documentationLinksPlugin() {
  let root;
  return {
    name: NAME,
    enforce: 'pre',
    configResolved(config) {
      // Keep the lexical checkout path: real paths can point outside it through symlinks.
      root = resolve(config.root);
    },
    resolveId(id, importer) {
      const path = importPath(id, root, importer);
      // A virtual ID prevents Vite from replacing the document's repository identity
      // with its real path before load, while reads still follow linked content.
      if (path) {
        return {
          id: `${PREFIX}${encodeURIComponent(path)}.js`,
          // The module graph retains one representative import without changing its identity.
          meta: { [NAME]: { request: id, importer } },
        };
      }
    },
    async load(id) {
      const path = id.startsWith(PREFIX)
        ? decodeURIComponent(id.slice(PREFIX.length, -'.js'.length))
        : documentPath(id);
      // A load hook receives resolved IDs; never prepend the project root a second time.
      if (!path || !isAbsolute(path)) return;
      try {
        const source = repositorySource(path, root);
        this.addWatchFile(path);
        const realPath = realpathSync(path);
        if (realPath !== path) this.addWatchFile(realPath);
        // Cleaned sites do not import this query and never load the Markdown parser.
        const { absoluteSourceLinks } = await import('../../src/lib/documentation-links.mjs');
        const text = absoluteSourceLinks(readFileSync(path, 'utf8'), source);
        return `export default ${JSON.stringify(text)};`;
      } catch (error) {
        throw documentError(error, path, this.getModuleInfo?.(id));
      }
    },
  };
}
