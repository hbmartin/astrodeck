import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceDrift, sourceReferences } from '../scripts/lib/source-references.mjs';

const IDENTITY = { repository: 'https://github.com/example/project', branch: 'next' };
const STALE = 'https://github.com/stale/source';
const TARGETS = [
  ['repository', '', 'GitHub repository'],
  ['zip', '/archive/refs/heads/old.zip', 'Source ZIP'],
  ['registry', '/blob/old/src/registry.json', 'Component registry'],
  ['agents', '/blob/old/AGENTS.md', 'AGENTS.md'],
  ['skills', '/tree/old/.agents/skills', 'Skills'],
];

function drift(text, file = 'README.md', options) {
  return sourceDrift({ [file]: text }, IDENTITY, options);
}

test('known source destination shapes survive renamed labels and moved sections', () => {
  for (const [kind, suffix] of TARGETS) {
    const text = `## A different heading\n\n[Read more](${STALE}${suffix})`;
    const references = sourceReferences(text);
    assert.deepEqual(references, [{ kind, actual: `${STALE}${suffix}`, line: 3 }]);
    assert.equal(drift(text).length, 1, kind);
  }
});

test('semantic source labels detect arbitrary wrong destinations without heading assumptions', () => {
  for (const [kind, , label] of TARGETS) {
    const text = `## Other resources\n\n[${label}](https://wrong.example/download)`;
    assert.equal(sourceReferences(text)[0]?.kind, kind);
    assert.equal(drift(text, 'CONTRIBUTING.md').length, 1, kind);
  }
});

test('visible source labels normalize line breaks, formatting and nested image alt text', () => {
  const labels = [
    'Source\nZIP',
    'Source  \nZIP',
    'Source\\\nZIP',
    '**Source** *ZIP*',
    'Source `ZIP`',
    '![Source\n**ZIP**](https://images.example/badge.svg)',
    '  Source&nbsp;ZIP  ',
  ];
  for (const label of labels) {
    const text = `[${label}](https://wrong.example/download)`;
    const references = sourceReferences(text);
    assert.equal(references.length, 1, label);
    assert.equal(references[0].kind, 'zip', label);
    assert.equal(drift(text).length, 1, label);
  }
});

test('unfamiliar links, standalone images, upstream links and literal code remain unchecked', () => {
  const text = [
    '[Release notes](https://github.com/another/project/releases)',
    '[Guide](https://github.com/another/project/blob/old/docs/guide.md)',
    '[Elsewhere](https://other.example/repository)',
    '[vibe2prod](https://github.com/holger1411/vibe2prod)',
    '[AGENTS.md](https://agents.md)',
    '[Upstream archive](https://github.com/upstream/project/archive/refs/heads/main.zip)',
    '![Source ZIP](https://github.com/another/project/archive/refs/heads/old.zip)',
    '![alt [Source ZIP](https://wrong.example/inside)](https://images.example/badge.svg)',
    '`[Source ZIP](https://github.com/another/project/archive/refs/heads/old.zip)`',
    '```md',
    '[Source ZIP](https://github.com/another/project/archive/refs/heads/old.zip)',
    '```',
  ].join('\n\n');
  const options = { upstreamRepositories: ['https://github.com/upstream/project'] };
  assert.deepEqual(sourceReferences(text, options), []);
  assert.deepEqual(drift(text, 'public/llms.txt', options), []);
});

test('upstream exemptions stop at repository boundaries', () => {
  assert.equal(drift('[Other](https://github.com/holger1411/vibe2prod-copy)').length, 1);
});

test('the AGENTS.md convention homepage exemption applies only to its own role', () => {
  for (const label of ['Source ZIP', 'Component registry', 'Skills'])
    assert.equal(drift(`[${label}](https://agents.md)`).length, 1, label);
});

test('link syntax inside image alt text does not create a source destination', () => {
  const text =
    '[![alt [Skills](https://wrong.example/inside)](badge.svg)](https://github.com/example/project)';
  assert.deepEqual(drift(text), []);
  assert.equal(sourceReferences(text).length, 0);
  assert.equal(
    sourceReferences('[![Project](badge.svg)](https://github.com/example/project)').length,
    1
  );
});

test('branch drift is checked for every known branch-bearing source path', () => {
  for (const [kind, suffix] of TARGETS.slice(1)) {
    const text = `[Different label](${IDENTITY.repository}${suffix})`;
    const findings = drift(text);
    assert.equal(findings.length, 1, kind);
    assert.ok(findings[0].expected.includes('/next'), kind);
    assert.deepEqual(drift(text.replace('/old', '/next')), [], kind);
  }
});

test('inline findings point to actual destination lines across complex Markdown and line endings', () => {
  const lines = [
    'Introductory paragraph.',
    '`code starts',
    '[Source ZIP](https://ignored.example/code)',
    'ends` and ![alt',
    'text](https://images.example/badge.svg)',
    '[Download](',
    `${STALE}/archive/refs/heads/old.zip`,
    ' "a title',
    'on two lines")',
    '[![Source',
    '**ZIP**](https://images.example/badge.svg)](',
    '<https://wrong.example/nested>)',
    '> [Component',
    '> registry](',
    '> https://wrong.example/registry)',
    '[AGENTS.md](https://wrong.example/agents) [Skills](https://wrong.example/skills)',
  ];
  for (const ending of ['\n', '\r\n']) {
    const findings = drift(lines.join(ending));
    assert.deepEqual(
      findings.map(({ actual, line }) => ({ actual, line })),
      [
        { actual: `${STALE}/archive/refs/heads/old.zip`, line: 7 },
        { actual: 'https://wrong.example/nested', line: 12 },
        { actual: 'https://wrong.example/registry', line: 15 },
        { actual: 'https://wrong.example/agents', line: 16 },
        { actual: 'https://wrong.example/skills', line: 16 },
      ]
    );
  }
});

test('shared reference destinations report once at their definition destination line', () => {
  const lines = [
    '[Source **ZIP**][download]',
    '[Another download][DOWNLOAD]',
    '[download][]',
    '',
    '[download]:',
    '  <https://wrong.example/shared>',
    '  "title',
    '  across lines"',
    '',
    '[Source ZIP][missing]',
  ];
  for (const ending of ['\n', '\r\n']) {
    assert.deepEqual(drift(lines.join(ending)), [
      {
        file: 'README.md',
        line: 6,
        actual: 'https://wrong.example/shared',
        expected: `${IDENTITY.repository}/archive/refs/heads/next.zip`,
      },
    ]);
  }
});

test('reference resolution uses the first definition and preserves unrelated definitions', () => {
  const text = [
    '[Source ZIP][download]',
    '',
    `[download]: ${IDENTITY.repository}/archive/refs/heads/next.zip`,
    '[download]: https://wrong.example/shadow',
    '[guide]: https://github.com/another/project/blob/old/docs/guide.md',
  ].join('\n');
  assert.deepEqual(drift(text), []);
  assert.equal(sourceReferences(text).length, 1);
});

test('empty semantic source destinations remain detectable', () => {
  assert.equal(drift('[Source ZIP]()')[0]?.actual, '');
  assert.equal(drift('[Source ZIP][download]\n\n[download]: <>')[0]?.actual, '');
});

test('clone commands are checked in moved fences across selected documents and branch forms', () => {
  const branches = ['--branch next', '--branch=next', '--branch="next"', '-b next', '-bnext'];
  for (const file of ['README.md', 'CONTRIBUTING.md', 'public/llms.txt']) {
    for (const branch of branches) {
      const text = `## New setup\n\n\`\`\`bash\n  $ git clone ${branch} ${STALE}.git "$TARGET" # costs $0\n\`\`\``;
      const findings = drift(text, file);
      assert.deepEqual(findings, [
        { file, line: 4, actual: `${STALE}.git`, expected: `${IDENTITY.repository}.git` },
      ]);
    }
  }
});

test('clone source and branch substitutions have operand-local comparison policies', () => {
  const text = [
    '```bash',
    'git clone --branch stale "$REPOSITORY"',
    'git clone --branch stale https://github.com/YOUR_USERNAME/project.git',
    `git clone --branch "$BRANCH" ${STALE}.git "$TARGET"`,
    `git clone --branch stale ${IDENTITY.repository}.git # $COMMENT`,
    'git clone --branch main https://github.com/holger1411/vibe2prod.git',
    '```',
  ].join('\n');
  assert.deepEqual(drift(text), [
    {
      file: 'README.md',
      line: 4,
      actual: `${STALE}.git`,
      expected: `${IDENTITY.repository}.git`,
    },
    { file: 'README.md', line: 5, actual: 'stale', expected: 'next' },
  ]);
});
