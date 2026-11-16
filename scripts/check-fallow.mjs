#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageBin } from './lib/executables.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = packageBin('fallow');
// Cleanup deliberately keeps the RSS packages in the frozen install.
const noBlog =
  !existsSync(join(root, 'starter')) && !existsSync(join(root, 'src/pages/rss.xml.ts'));
const config = noBlog ? '.fallow.no-blog.json' : '.fallowrc.json';
const result = spawnSync(
  process.execPath,
  [launcher, '--config', config, '--no-cache', '--fail-on-issues'],
  {
    cwd: root,
    env: { ...process.env, FALLOW_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  }
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 2;
