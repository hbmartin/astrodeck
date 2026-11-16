import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Yield matching paths without traversing directory symlinks. */
export function* walkFiles(dir, matches) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path, matches);
    else if (matches(entry.name)) yield path;
  }
}
