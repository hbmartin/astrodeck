import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSourceClone } from '../scripts/lib/source-clones.mjs';

const REPOSITORY = 'https://github.com/example/project.git';

function expected(repository = REPOSITORY, branch) {
  return {
    repository: { value: repository, substituted: false },
    ...(branch === undefined ? {} : { branch: { value: branch, substituted: false } }),
  };
}

test('clone parsing accepts branch spellings, quotes, indentation and one shell prompt', () => {
  const commands = [
    `git clone --branch next --single-branch ${REPOSITORY} my-site`,
    `  git clone --branch='next' "${REPOSITORY}" my-site`,
    `\t$ git clone --branch "next" '${REPOSITORY}' my-site`,
    `git clone -b 'next' ${REPOSITORY}`,
    `git clone -bnext ${REPOSITORY}`,
    `git clone ${REPOSITORY} --branch=next`,
  ];
  for (const command of commands) {
    assert.deepEqual(parseSourceClone(command), expected(REPOSITORY, 'next'), command);
  }
});

test('clone parsing consumes option arguments before choosing the repository', () => {
  const commands = [
    `git clone --reference https://github.com/cache/project.git --branch next ${REPOSITORY}`,
    `git clone --template="https://github.com/template/project.git" -b next ${REPOSITORY}`,
    `git clone -c remote.origin.url=https://github.com/config/project.git ${REPOSITORY} -b next`,
    `git clone --depth 1 --filter=blob:none --recurse-submodules=packages -qv -bnext ${REPOSITORY}`,
  ];
  for (const command of commands) {
    assert.deepEqual(parseSourceClone(command), expected(REPOSITORY, 'next'), command);
  }
});

test('comment URLs and options never become clone operands', () => {
  const command = `git clone --branch next ${REPOSITORY} my-site # --branch stale https://github.com/stale/source.git`;
  assert.deepEqual(parseSourceClone(command), expected(REPOSITORY, 'next'));
  assert.equal(parseSourceClone(`git clone # ${REPOSITORY}`), undefined);
  assert.equal(parseSourceClone(`git clone --reference ${REPOSITORY} # ${REPOSITORY}`), undefined);
});

test('target directory and comment variables do not exempt literal repository drift', () => {
  const stale = 'https://github.com/stale/source.git';
  const commands = [
    `git clone --branch next ${stale} "$TARGET"`,
    `git clone --branch next ${stale} YOUR_DIRECTORY`,
    `git clone --branch next ${stale} # $REPO \\`,
  ];
  for (const command of commands) {
    assert.deepEqual(parseSourceClone(command), expected(stale, 'next'), command);
  }
});

test('repository and branch substitutions are recorded independently', () => {
  const cases = [
    [`git clone --branch next $REPO`, '$REPO', 'next', true, false],
    ['git clone --branch next "${REPO}"', '${REPO}', 'next', true, false],
    [`git clone --branch "$BRANCH" ${REPOSITORY}`, REPOSITORY, '$BRANCH', false, true],
    [`git clone --branch=\${BRANCH} ${REPOSITORY}`, REPOSITORY, '${BRANCH}', false, true],
    [
      'git clone --branch YOUR_BRANCH https://github.com/YOUR_USERNAME/YOUR_REPO.git',
      'https://github.com/YOUR_USERNAME/YOUR_REPO.git',
      'YOUR_BRANCH',
      true,
      true,
    ],
  ];
  for (const [command, repository, branch, repositorySubstitution, branchSubstitution] of cases) {
    assert.deepEqual(parseSourceClone(command), {
      repository: { value: repository, substituted: repositorySubstitution },
      branch: { value: branch, substituted: branchSubstitution },
    });
  }
});

test('single quotes and escaped dollars preserve literal shell values', () => {
  const commands = [
    "git clone --branch '$BRANCH' '$REPO'",
    'git clone --branch \\$BRANCH \\$REPO',
    'git clone --branch "\\$BRANCH" "\\$REPO"',
  ];
  for (const command of commands) {
    assert.deepEqual(parseSourceClone(command), expected('$REPO', '$BRANCH'), command);
  }
});

test('quoted and escaped spaces, quotes and hash signs remain inside their operands', () => {
  const cases = [
    [`git clone -b "release candidate" ${REPOSITORY} my\\ site`, 'release candidate'],
    [`git clone --branch='release'\\ candidate ${REPOSITORY}`, 'release candidate'],
    [`git clone -b "release\\"candidate" ${REPOSITORY}`, 'release"candidate'],
    [`git clone -b 'release#candidate' ${REPOSITORY}`, 'release#candidate'],
    [`git clone -b release\\#candidate ${REPOSITORY}`, 'release#candidate'],
    [`git clone -b "release\\candidate" ${REPOSITORY}`, 'release\\candidate'],
  ];
  for (const [command, branch] of cases) {
    assert.deepEqual(parseSourceClone(command), expected(REPOSITORY, branch), command);
  }
});

test('option terminators and missing branch values have unambiguous results', () => {
  assert.deepEqual(parseSourceClone('git clone -- -repository target'), expected('-repository'));
  assert.deepEqual(
    parseSourceClone(`git clone --branch next --no-branch ${REPOSITORY}`),
    expected()
  );
  assert.equal(parseSourceClone(`git clone --branch --single-branch ${REPOSITORY}`), undefined);
  assert.equal(parseSourceClone(`git clone --unknown ${REPOSITORY}`), undefined);
});

test('unrelated commands and unsupported shell syntax are not treated as clones', () => {
  const commands = [
    `echo git clone ${REPOSITORY}`,
    `git clone-other ${REPOSITORY}`,
    `$ $ git clone ${REPOSITORY}`,
    `git clone ${REPOSITORY} && pnpm install`,
    `git clone ${REPOSITORY} | cat`,
    `git clone ${REPOSITORY}; pnpm install`,
    `git clone ${REPOSITORY} > clone.log`,
    `git clone ${REPOSITORY} \\`,
    `git clone ${REPOSITORY}\nnext-line`,
    `git clone --branch next "${REPOSITORY}`,
    'git clone $(repository)',
    'git clone `repository`',
    'git clone ${REPO:-fallback}',
  ];
  for (const command of commands) assert.equal(parseSourceClone(command), undefined, command);
});
