#!/usr/bin/env node
/**
 * One command to run before declaring work done. Runs every check, never stops at
 * the first failure, prints a table and exits 1 if any step failed. Works offline.
 * Usage: node scripts/verify.mjs [--skip-build] [--starter]
 *   --skip-build  skip `build` and `dist` (steps that need a production build)
 *   --starter     run check-dist in starter mode (no demo leftovers allowed)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOnPath, packageBin } from './lib/executables.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const node = process.execPath;
const TAIL_LINES = 40;

/** Lazy so a missing dependency fails the step it belongs to instead of crashing the module. */
const viaNode = (pkg, ...args) => [packageBin(pkg), ...args];

/**
 * @typedef {{ id: string; cmd: string; args: string[]; needsBuild?: boolean }} Step
 * @type {Step[]}
 */
export const STEPS = [
  {
    id: 'format',
    cmd: node,
    get args() {
      return viaNode('oxfmt', '--check', '.');
    },
  },
  {
    id: 'oxlint',
    cmd: node,
    get args() {
      return viaNode('oxlint', '.');
    },
  },
  { id: 'lint-astro', cmd: node, args: ['scripts/lint-astro.mjs'] },
  {
    id: 'astro-check',
    cmd: node,
    get args() {
      return viaNode('astro', 'check');
    },
  },
  { id: 'fallow', cmd: node, args: ['scripts/check-fallow.mjs'] },
  { id: 'lint-design', cmd: node, args: ['scripts/lint-design.mjs'] },
  { id: 'lint-docs', cmd: node, args: ['scripts/lint-docs.mjs'] },
  { id: 'registry', cmd: node, args: ['scripts/check-registry.mjs'] },
  { id: 'test', cmd: node, args: ['--test', '--test-reporter=spec', 'tests/**/*.test.mjs'] },
  {
    id: 'build',
    cmd: 'pnpm',
    args: ['run', 'build'],
    needsBuild: true,
  },
  { id: 'dist', cmd: node, args: ['scripts/check-dist.mjs'], needsBuild: true },
];

/** @param {string[]} argv @returns {Step[]} */
export function selectSteps(argv) {
  const skipBuild = argv.includes('--skip-build');
  const starter = argv.includes('--starter');
  return STEPS.filter((s) => !(skipBuild && s.needsBuild)).map((s) =>
    s.id === 'dist' && starter ? { ...s, args: [...s.args, '--starter'] } : s
  );
}

/** Minimal check for a `>=x.y.z` engines range. */
export function nodeSatisfies(version, range) {
  const parse = (v) =>
    v
      .replace(/^[^\d]*/, '')
      .split('.')
      .map(Number);
  const [have, want] = [parse(version), parse(range)];
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (want[i] ?? 0)) return (have[i] ?? 0) > (want[i] ?? 0);
  }
  return true;
}

function runStep(step) {
  const start = Date.now();
  let output;
  let ok = false;
  try {
    const r = spawnSync(step.cmd, step.args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.error) output += `\n${r.error.message}`;
    ok = r.status === 0 && !r.error;
  } catch (error) {
    output = String(error?.message ?? error);
  }
  return { id: step.id, ok, ms: Date.now() - start, output };
}

function completionMessage(failures, skipBuild) {
  const mode = skipBuild ? 'VALIDATE' : 'VERIFY';
  if (failures) return `${mode} FAILED (${failures})`;
  return skipBuild ? 'VALIDATE PASSED (build and built-HTML checks skipped)' : 'VERIFY PASSED';
}

/**
 * Run all steps (never stops at the first failure), print the table and failure tails.
 * A step that needs the build is skipped when the `build` step failed.
 * @param {Step[]} steps
 * @param {(line: string) => void} [log]
 * @param {{ skipBuild?: boolean }} [options]
 * @returns {number} exit code
 */
export function run(steps, log = console.log, { skipBuild = false } = {}) {
  const results = [];
  let buildFailed = false;
  for (const step of steps) {
    if (buildFailed && step.needsBuild && step.id !== 'build') {
      results.push({ id: step.id, ok: true, skipped: true, ms: 0, output: '' });
      continue;
    }
    log(`running ${step.id} ...`);
    const r = runStep(step);
    if (step.id === 'build' && !r.ok) buildFailed = true;
    results.push(r);
  }

  const width = Math.max(...results.map((r) => r.id.length), 4);
  const label = (r) => (r.skipped ? 'skipped (build failed)' : r.ok ? 'ok' : 'FAIL');
  log(`\n${'step'.padEnd(width)} | result | duration`);
  log(`${'-'.repeat(width)}-|--------|---------`);
  for (const r of results)
    log(`${r.id.padEnd(width)} | ${label(r).padEnd(6)} | ${(r.ms / 1000).toFixed(1)}s`);

  const failed = results.filter((r) => !r.ok);
  for (const r of failed) {
    const lines = r.output.trimEnd().split('\n');
    if (r.id === 'test') {
      log(`\n--- ${r.id} (full output) ---`);
      log(lines.join('\n'));
    } else {
      log(`\n--- ${r.id} (last ${Math.min(TAIL_LINES, lines.length)} lines) ---`);
      log(lines.slice(-TAIL_LINES).join('\n'));
    }
  }
  log(`\n${completionMessage(failed.length, skipBuild)}`);
  return failed.length ? 1 : 0;
}

function main() {
  if (!['darwin', 'linux'].includes(process.platform)) {
    console.error(
      'AstroDeck verification supports macOS and Linux. This platform is unsupported: ' +
        process.platform
    );
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const { engines, packageManager } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const steps = selectSteps(argv);
  if (steps.some(({ id }) => id === 'build') && !findOnPath('pnpm')) {
    console.error(
      `Full verification requires ${packageManager} on PATH. For checks without a build, run node scripts/verify.mjs --skip-build.`
    );
    process.exit(1);
  }
  if (engines?.node && !nodeSatisfies(process.version, engines.node))
    console.warn(`WARNING: Node ${process.version} is below the required ${engines.node}.\n`);
  process.exit(run(steps, console.log, { skipBuild: argv.includes('--skip-build') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
