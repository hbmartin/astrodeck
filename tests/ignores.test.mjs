import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
const lines = (rel) =>
  readFileSync(join(REPO, rel), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());

// The bundled vibe2prod audit writes .vibe2prod/ (raw Lighthouse/axe JSON, scratch scripts) into
// the project. `pnpm run verify` after an audit must not lint, format or commit those files.
test('.vibe2prod/ is ignored by git, Oxfmt and Oxlint', () => {
  assert.ok(lines('.gitignore').includes('.vibe2prod/'), '.gitignore');
  for (const file of ['.oxfmtrc.json', '.oxlintrc.json']) {
    const { ignorePatterns } = JSON.parse(readFileSync(join(REPO, file), 'utf8'));
    assert.ok(ignorePatterns.includes('.vibe2prod/**'), file);
  }
});
