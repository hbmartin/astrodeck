import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const COMPACTION = new Map([
  ['jsx', 'jsx'],
  ['html', true],
  ['none', false],
]);
const ALL_MODES = [...COMPACTION.values()];

function configFiles(dir) {
  return readdirSync(dir).filter((name) => /^\.?oxfmt(?:rc|\.config)(?:\.|$)/.test(name));
}

/** Use the root Astro formatter setting where its effect is known. */
export function compactionForFiles(root) {
  const modes = rootCompaction(root);
  if (modes === ALL_MODES) return () => modes;
  const directories = new Map();
  return (file) => {
    const dir = dirname(resolve(root, file));
    if (!directories.has(dir)) directories.set(dir, usesNestedConfig(root, dir));
    return directories.get(dir) ? ALL_MODES : modes;
  };
}

function rootCompaction(root) {
  const files = configFiles(root);
  if (!files.length) return ['jsx'];
  const [file] = files;
  if (files.length > 1 || !/\.jsonc?$/.test(file)) return ALL_MODES;
  const result = ts.parseConfigFileTextToJson(file, readFileSync(join(root, file), 'utf8'));
  if (result.error) return ALL_MODES;
  const { astro, overrides } = result.config;
  if (overrides?.some(({ options }) => options?.astro !== undefined)) return ALL_MODES;
  return [COMPACTION.get(astro?.compressHTML) ?? 'jsx'];
}

function usesNestedConfig(root, dir) {
  const path = relative(root, dir);
  if (path.startsWith('..')) return true;
  while (dir !== root) {
    if (configFiles(dir).length) return true;
    dir = dirname(dir);
  }
  return false;
}
