#!/usr/bin/env node
/**
 * setup:audit — checks (and, without --check, installs) the runtime the vendored vibe2prod
 * skill needs, exactly as the vibe2prod README documents it:
 *   global `lighthouse` and `@axe-core/cli`, Playwright + `@axe-core/playwright` under
 *   ~/.cache/vibe2prod/runtime (override with VIBE2PROD_RUNTIME), `playwright install chromium`,
 *   Node >= 22.19 (Lighthouse 13), `curl` and `jq`.
 *
 * Usage: node scripts/setup-audit.mjs [--check]
 *   --check  never installs; prints `missing: a, b, c` and exits 2, or `audit runtime: ok` and exits 0
 * Install mode installs only what is missing and prints each command before running it.
 * Needs network access in install mode (npm registry, Playwright CDN).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeSatisfies } from './verify.mjs';
import { findOnPath } from './lib/executables.mjs';

const MIN_NODE = '22.19.0';
const node = process.execPath;

function runtimeDir(env = process.env) {
  return env.VIBE2PROD_RUNTIME || join(homedir(), '.cache', 'vibe2prod', 'runtime');
}

function browserCacheDir(env) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override !== '0') return override;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

function hasChromium(env = process.env) {
  try {
    return readdirSync(browserCacheDir(env)).some((name) => /^chromium-\d+/.test(name));
  } catch {
    return false;
  }
}

/** @returns {string[]} names of missing pieces (empty = complete) */
function detectMissing(env = process.env) {
  const rt = runtimeDir(env);
  const capabilities = [
    [`node>=${MIN_NODE}`, nodeSatisfies(process.version, MIN_NODE)],
    ['lighthouse', findOnPath('lighthouse', env)],
    ['@axe-core/cli', findOnPath('axe', env)],
    ['playwright', existsSync(join(rt, 'node_modules', 'playwright'))],
    ['@axe-core/playwright', existsSync(join(rt, 'node_modules', '@axe-core', 'playwright'))],
    ['chromium', hasChromium(env)],
    ['curl', findOnPath('curl', env)],
    ['jq', findOnPath('jq', env)],
  ];
  return capabilities.filter(([, available]) => !available).map(([name]) => name);
}

function npm(args, cwd) {
  return run('npm', args, { cwd });
}

function exitFailure(status) {
  return status === 0 ? '' : `exit ${status}`;
}

function run(cmd, args, options = {}) {
  console.log(`$ ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  const failure = r.error?.message || exitFailure(r.status);
  if (failure) {
    console.error(`command failed: ${failure}`);
    return false;
  }
  return true;
}

function install(missing, env) {
  const rt = runtimeDir(env);
  if (!installGlobalPackages(missing)) return false;
  if (!ensureLocalPackages(missing, rt)) return false;
  return ensureChromium(missing, rt);
}

function installGlobalPackages(missing) {
  const global = missing.filter((m) => m === 'lighthouse' || m === '@axe-core/cli');
  return !global.length || npm(['install', '-g', ...global]);
}

function ensureLocalPackages(missing, rt) {
  if (missing.includes('playwright') || missing.includes('@axe-core/playwright'))
    return installLocalPackages(rt);
  return true;
}

function ensureChromium(missing, rt) {
  if (missing.includes('chromium') || missing.includes('playwright')) return installChromium(rt);
  return true;
}

function installLocalPackages(rt) {
  mkdirSync(rt, { recursive: true });
  return npm(['install', '--prefix', '.', 'playwright', '@axe-core/playwright'], rt);
}

function installChromium(rt) {
  const cli = join(rt, 'node_modules', 'playwright', 'cli.js');
  if (existsSync(cli)) return run(node, [cli, 'install', 'chromium']);
  console.error('playwright is not installed in the runtime directory');
  return false;
}

function missingAfterInstall(missing) {
  if (!install(missing, process.env)) process.exit(1);
  const remaining = detectMissing();
  if (!remaining.length) return remaining;
  console.log(`missing: ${remaining.join(', ')}`);
  const manual = missing.filter((m) => m === 'curl' || m === 'jq' || m.startsWith('node'));
  if (manual.length) console.log(`install these yourself: ${manual.join(', ')}`);
  process.exit(2);
}

function main() {
  const check = process.argv.includes('--check');
  let missing = detectMissing();
  if (!check && missing.length) missing = missingAfterInstall(missing);
  if (missing.length) {
    console.log(`missing: ${missing.join(', ')}`);
    process.exit(2);
  }
  console.log('audit runtime: ok');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
