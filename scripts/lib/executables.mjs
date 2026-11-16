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

/** Locate an executable on PATH, including Windows command shims. */
export function findOnPath(name, env = process.env) {
  const isWin = process.platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = isWin ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, name + ext);
      try {
        if (!statSync(file).isFile()) continue;
        if (!isWin) accessSync(file, constants.X_OK);
        return file;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return null;
}
