import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILESYSTEM = { lstatSync, readdirSync, readFileSync };

function scanDirectory(root, name, state) {
  let entries;
  try {
    entries = state.io.readdirSync(join(root, name), { withFileTypes: true });
  } catch (error) {
    state.fail(name, 'read directory', error);
    return;
  }
  for (const entry of entries) {
    const path = name ? `${name}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) state.rejectLink(path);
    else if (entry.isDirectory()) scanDirectory(root, path, state);
    else if (entry.isFile()) state.paths.add(path);
    else state.rejectEntry(path);
  }
}

function scanRoot(root, state) {
  try {
    const entry = state.io.lstatSync(root);
    if (entry.isSymbolicLink()) state.rejectLink('');
    else if (entry.isDirectory()) scanDirectory(root, '', state);
    else state.fail('', 'read directory', { code: 'ENOTDIR' });
  } catch (error) {
    if (error.code === 'ENOENT')
      state.findings.push({ file: root, rule: 'missing-dir', message: 'directory does not exist' });
    else state.fail('', 'inspect directory', error);
  }
}

/** A fresh, exact-spelling inventory of regular build files. No symlinks are followed. */
export function createBuildInventory(dir, filesystem = {}) {
  const root = resolve(dir);
  const paths = new Set();
  const blocked = new Set();
  const findings = [];
  const io = { ...FILESYSTEM, ...filesystem };
  const state = {
    paths,
    findings,
    io,
    fail(name, operation, error) {
      blocked.add(name);
      findings.push({
        file: name || '.',
        rule: 'build-io',
        message: `cannot ${operation} (${error.code ?? 'UNKNOWN'})`,
      });
    },
    rejectLink(name) {
      blocked.add(name);
      findings.push({
        file: name || '.',
        rule: 'build-symlink',
        message: 'build output must contain regular files and directories, not symbolic links',
      });
    },
    rejectEntry(name) {
      blocked.add(name);
      findings.push({
        file: name || '.',
        rule: 'build-io',
        message: 'unsupported build entry; expected a regular file or directory',
      });
    },
  };
  scanRoot(root, state);
  return inventoryReader(root, state, blocked);
}

function inventoryReader(root, state, blocked) {
  const cache = new Map();
  const lookup = (name) => {
    if (state.paths.has(name)) return { status: 'ok', path: name };
    const parts = name.split('/');
    while (parts.length) {
      if (blocked.has(parts.join('/'))) return { status: 'blocked' };
      parts.pop();
    }
    return { status: blocked.has('') ? 'blocked' : 'missing' };
  };
  return {
    files: [...state.paths].sort(),
    findings: state.findings,
    lookup,
    file: (name) => lookup(name).path,
    readText(name) {
      if (cache.has(name)) return cache.get(name);
      const result = lookup(name);
      if (result.status !== 'ok') return result;
      try {
        cache.set(name, { status: 'ok', text: state.io.readFileSync(join(root, name), 'utf8') });
      } catch (error) {
        state.fail(name, 'read file', error);
        cache.set(name, { status: 'blocked' });
      }
      return cache.get(name);
    },
  };
}
