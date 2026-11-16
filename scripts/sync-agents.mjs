#!/usr/bin/env node
/**
 * sync:agents — mirrors the canonical skills in .agents/skills/ to .claude/skills/
 * (Claude Code only reads .claude/skills). The mirror holds regular files, never symlinks,
 * so it survives ZIP extraction.
 *
 * Installer-managed skills in skills-lock.json and Claude-only skills retain their own files.
 *
 * Usage: node scripts/sync-agents.mjs [--check] [--root <dir>]
 *   --check  write nothing; exit 1 and list every drifted file if the mirror is out of date
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SOURCE = '.agents/skills';
const MIRROR = '.claude/skills';

const MIRROR_README = `# .claude/skills (generated)

Regenerate the mirrors with \`pnpm run sync:agents\` after editing \`.agents/skills/\`.
Run \`pnpm run sync:agents --check\` to check mirror drift on demand.

Add Claude-only skills directly in \`.claude/skills/\`. Sync preserves them and any skills listed
in \`skills-lock.json\`.

Why a copy: Claude Code reads skills only from \`.claude/skills/\`, most other agents read
\`.agents/skills/\`. Real files instead of symlinks keep the mirror intact after ZIP extraction.
`;

/** OS metadata files that are never mirrored and never count as drift. */
const IGNORED = new Set(['.DS_Store', 'Thumbs.db']);

/**
 * Walk dir without following symlinks; skips IGNORED files.
 * @param {string} dir
 * @returns {{ files: string[]; links: string[] }} posix paths relative to dir
 */
function walk(dir) {
  const files = [];
  const links = [];
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(childRel);
      else if (entry.isDirectory()) visit(join(abs, entry.name), childRel);
      else files.push(childRel);
    }
  };
  if (existsSync(dir) && lstatSync(dir).isDirectory()) visit(dir, '');
  return { files, links };
}

/** @param {string} rel posix path @returns {string} its first segment */
const topOf = (rel) => rel.split('/')[0];

/** Remove empty folders below (not including) dir, deepest first. @param {string} dir */
function pruneEmptyDirs(dir) {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    pruneEmptyDirs(child);
    if (readdirSync(child).length === 0) rmdirSync(child);
  }
}

/** @param {string} p */
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function installerSkills(root) {
  try {
    const { skills } = JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8'));
    return new Set(Object.keys(skills ?? {}));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Set();
  }
}

function sourceFiles(srcDir, installed) {
  /** @type {Map<string, Buffer>} mirror-relative path -> expected content */
  const expected = new Map();
  for (const rel of walk(srcDir).files) {
    if (!installed.has(topOf(rel)))
      expected.set(rel, readFileSync(join(srcDir, ...rel.split('/'))));
  }
  expected.set('README.md', Buffer.from(MIRROR_README));
  return expected;
}

/**
 * Mirror .agents/skills/** to .claude/skills/** as regular files.
 * @param {string} root project root
 * @param {{ check?: boolean }} [options] check: report drift only, write nothing
 * @returns {{ changed: string[]; userOwned: string[] }} changed: repo-relative mirror paths that
 *   were (or would be) written or removed; userOwned: skill folders in the mirror that have no
 *   counterpart in the source and are left alone
 */
export function syncAgents(root, { check = false } = {}) {
  const srcDir = join(root, SOURCE);
  const mirrorDir = join(root, MIRROR);
  const at = (rel) => join(mirrorDir, ...rel.split('/'));
  const installed = installerSkills(root);

  const expected = sourceFiles(srcDir, installed);
  /** Top-level skill names in the source: the only folders the mirror manages. */
  const managed = new Set([...expected.keys()].filter((r) => r.includes('/')).map(topOf));

  const changed = new Set();
  // A symlinked mirror folder would route every write into its target: treat it as fully drifted.
  const mirrorIsLink = isLink(mirrorDir);
  if (mirrorIsLink && !check) rmSync(mirrorDir);
  const walked = mirrorIsLink ? { files: [], links: [] } : walk(mirrorDir);
  const { userOwned, files, links, underLink } = partitionMirror(walked, expected, managed);
  syncLinks(links, expected, changed, at, check);
  syncContent(expected, changed, at, mirrorIsLink, underLink, check);
  removeStaleFiles(files, expected, changed, at, check);
  if (!check) for (const name of managed) pruneEmptyDirs(at(name));
  return { changed: [...changed].sort(), userOwned };
}

function partitionMirror(walked, expected, managed) {
  // Folders (and stray files) without a counterpart in the source belong to the user.
  const isManaged = (rel) => (rel.includes('/') ? managed.has(topOf(rel)) : expected.has(rel));
  const userOwned = [
    ...new Set(
      [...walked.files, ...walked.links]
        .filter((rel) => rel.includes('/') && !managed.has(topOf(rel)))
        .map(topOf)
        .concat(walked.links.filter((l) => !l.includes('/') && !managed.has(l)))
    ),
  ].sort();
  const files = walked.files.filter(isManaged);
  const links = walked.links.filter((l) => managed.has(topOf(l)) || expected.has(l));
  const underLink = (rel) => links.some((l) => rel === l || rel.startsWith(`${l}/`));

  return { userOwned, files, links, underLink };
}

function syncLinks(links, expected, changed, at, check) {
  for (const rel of links) {
    if (!expected.has(rel)) changed.add(`${MIRROR}/${rel}`);
    if (!check) rmSync(at(rel));
  }
}

function syncContent(expected, changed, at, mirrorIsLink, underLink, check) {
  for (const [rel, content] of expected) {
    const target = at(rel);
    if (!mirrorIsLink && !underLink(rel) && sameFile(target, content)) continue;
    changed.add(`${MIRROR}/${rel}`);
    if (check) continue;
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function sameFile(target, content) {
  return existsSync(target) && lstatSync(target).isFile() && readFileSync(target).equals(content);
}

function removeStaleFiles(files, expected, changed, at, check) {
  for (const rel of files) {
    if (expected.has(rel)) continue;
    changed.add(`${MIRROR}/${rel}`);
    if (!check) rmSync(at(rel), { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { check: { type: 'boolean', default: false }, root: { type: 'string' } },
  });
  const root = resolve(values.root ?? join(import.meta.dirname, '..'));
  const { changed, userOwned } = syncAgents(root, { check: values.check });
  const info = userOwned.length
    ? `\ninfo: not managed by sync, left untouched (user-owned): ${userOwned.join(', ')}`
    : '';
  const list = changed.map((p) => `  ${p}`).join('\n');
  if (values.check) {
    if (changed.length) {
      console.error(
        `${MIRROR} is out of sync with ${SOURCE} (${changed.length} file(s)):\n${list}\n` +
          'Run `pnpm run sync:agents` after editing the source skills in .agents/skills.' +
          info
      );
      process.exit(1);
    }
    console.log(`sync:agents - ${MIRROR} is in sync${info}`);
  } else {
    console.log(
      changed.length
        ? `sync:agents - updated ${changed.length} file(s):\n${list}${info}`
        : `sync:agents - ${MIRROR} already in sync${info}`
    );
  }
}
