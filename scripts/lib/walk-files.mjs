import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Yield matching paths without traversing directory symlinks. */
export function* walkFiles(dir, matches, skipDirectory = () => false) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirectory(path)) yield* walkFiles(path, matches, skipDirectory);
    } else if (matches(entry.name)) yield path;
  }
}
