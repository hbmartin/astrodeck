import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packageBin } from './lib/executables.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = packageBin('oxlint');

// Run the Astro checks even when Oxlint reports errors after applying safe fixes.
for (const args of [[bin, ...process.argv.slice(2), '.'], ['scripts/lint-astro.mjs']]) {
  const { error, status } = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (error) console.error(error.message);
  if (status !== 0) process.exitCode = 1;
}
