import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { changedAstroSlots } from './lib/astro-slots.mjs';
import { packageBin } from './lib/executables.mjs';
import { compactionForFiles } from './lib/formatter-config.mjs';

function oxfmt(args, { input, allowDifferences = false } = {}) {
  const result = spawnSync(process.execPath, [packageBin('oxfmt'), ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const { status, stdout, stderr } = result;
  if (status === 0) return allowDifferences ? '' : stdout;
  if (allowDifferences && status === 1 && !stderr.trim()) return stdout;
  throw new Error(stderr.trim() || stdout.trim() || 'Oxfmt failed.');
}

function astroProposal(file, modes) {
  const before = readFileSync(file, 'utf8');
  const after = oxfmt([`--stdin-filepath=${file}`], { input: before });
  const slots = [...new Set(modes.flatMap((mode) => changedAstroSlots(before, after, file, mode)))];
  if (slots.length) {
    throw new Error(
      `${file}: Formatting changes rendered Astro slot text in ${slots.join(', ')}. Use an explicit string expression such as {'Label'} when the exact text matters.`
    );
  }
  return { file, before, after };
}

function writeAstroProposal({ file, before, after }) {
  if (readFileSync(file, 'utf8') !== before)
    throw new Error(`${file}: Source changed during formatting. Rerun the formatter.`);
  writeFileSync(file, after);
}

function formatAstroFiles(files) {
  if (!files.length) return 0;
  const compaction = compactionForFiles(process.cwd());
  let written = 0;
  for (const file of files) {
    try {
      writeAstroProposal(astroProposal(file, compaction(file)));
      written++;
    } catch (error) {
      console.error(error.message);
    }
  }
  return written;
}

function format(paths) {
  const targets = paths.length ? paths : ['.'];
  const list = oxfmt(['--list-different', '--no-error-on-unmatched-pattern', '--', ...targets], {
    allowDifferences: true,
  });
  const files = list.split(/\r?\n/).filter(Boolean);
  const astro = files.filter((file) => file.endsWith('.astro'));
  const other = files.filter((file) => !file.endsWith('.astro'));
  const written = formatAstroFiles(astro);
  if (other.length) oxfmt(['--write', '--', ...other]);
  console.log('Formatted ' + (written + other.length) + ' file(s).');
  if (written < astro.length) process.exitCode = 1;
}

try {
  format(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
