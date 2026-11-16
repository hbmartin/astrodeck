import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/** Installed package executable, for launching JavaScript bins directly with Node. */
export function packageBin(pkg, name = pkg) {
  const dir = join(ROOT, 'node_modules', pkg);
  const { bin } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const path = typeof bin === 'string' ? bin : bin?.[name];
  if (!path) throw new Error(`Package ${pkg} does not declare the ${name} executable.`);
  return join(dir, path);
}

/** Locate an executable on PATH. */
export function findOnPath(name, env = process.env) {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const file = join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}
