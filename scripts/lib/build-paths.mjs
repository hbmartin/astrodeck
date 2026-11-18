import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function matchingEntry(directory, requested) {
  const entries = readdirSync(directory);
  if (entries.includes(requested)) return requested;
  const normalized = requested.normalize('NFC');
  const matches = entries.filter((entry) => entry.normalize('NFC') === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolve a decoded build-relative filename, preserving its actual case and Unicode spelling. */
export function builtFile(dir, name) {
  const root = resolve(dir);
  const path = relative(root, resolve(root, name));
  if (isAbsolute(name) || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    return undefined;
  if (path.split(sep).join('/') !== name) return undefined;

  const actual = [];
  let directory = root;
  try {
    for (const component of name.split('/')) {
      const entry = matchingEntry(directory, component);
      if (entry === undefined) return undefined;
      actual.push(entry);
      directory = join(directory, entry);
    }
    return statSync(directory).isFile() ? actual.join('/') : undefined;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return undefined;
    throw error;
  }
}
