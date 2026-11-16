#!/usr/bin/env node
/**
 * Design-rule lint: scans src/**\/*.{astro,tsx,ts,css} with the shared rules in
 * scripts/lib/rules.mjs (same rules the Claude Code hook enforces).
 * Exit 1 if any error-severity finding exists; warnings are printed only.
 * Usage: node scripts/lint-design.mjs [projectRoot]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintText } from './lib/rules.mjs';
import { walkFiles } from './lib/walk-files.mjs';
import { formatFindings } from './lib/findings.mjs';

const EXTS = new Set(['.astro', '.tsx', '.ts', '.css']);
const GLOBALS = 'src/styles/globals.css';

/**
 * @param {string} root project root
 * @returns {import('./lib/findings.mjs').Finding[]}
 */
function lintProject(root) {
  const srcDir = join(root, 'src');
  if (!existsSync(srcDir)) return [];
  const findings = [];
  for (const file of [...walkFiles(srcDir, (name) => EXTS.has(extname(name)))].sort()) {
    const rel = relative(root, file).split(sep).join('/');
    if (rel === GLOBALS) continue;
    findings.push(...lintText(rel, readFileSync(file, 'utf8')));
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..'));
  const findings = lintProject(root);
  const errors = findings.filter((f) => f.severity === 'error');
  if (findings.length) console.log(formatFindings(findings));
  console.log(
    `lint:design - ${errors.length} error(s), ${findings.length - errors.length} warning(s)`
  );
  process.exit(errors.length ? 1 : 0);
}
