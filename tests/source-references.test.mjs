import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceDrift, sourceReferences } from '../scripts/lib/source-references.mjs';

const IDENTITY = { repository: 'https://github.com/example/project', branch: 'next' };
const STALE = 'https://github.com/stale/source';
const HINTS = { ...IDENTITY, formerRepositories: [STALE] };
const TARGETS = [
  ['repository', '', 'GitHub repository'],
  ['zip', '/archive/refs/heads/old.zip', 'Source ZIP'],
  ['registry', '/blob/old/src/registry.json', 'Component registry'],
  ['agents', '/blob/old/AGENTS.md', 'AstroDeck AGENTS.md'],
  ['skills', '/tree/old/.agents/skills', 'AstroDeck skills'],
];

function drift(text, file = 'README.md', options) {
  return sourceDrift({ [file]: text }, IDENTITY, { formerRepositories: [STALE], ...options });
}

function references(text, options) {
  return sourceReferences(text, { ...HINTS, ...options });
}

test('known source destination shapes survive renamed labels and moved sections', () => {
  for (const [kind, suffix] of TARGETS) {
    const text = `## A different heading\n\n[Read more](${STALE}${suffix})`;
    assert.deepEqual(references(text), [{ kind, actual: `${STALE}${suffix}`, line: 3 }]);
    assert.equal(drift(text).length, 1, kind);
  }
});

test('semantic source labels detect arbitrary wrong destinations without heading assumptions', () => {
  for (const [kind, , label] of TARGETS) {
    const text = `## Other resources\n\n[${label}](https://wrong.example/download)`;
    assert.equal(references(text)[0]?.kind, kind);
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
    const found = references(text);
    assert.equal(found.length, 1, label);
    assert.equal(found[0].kind, 'zip', label);
    assert.equal(drift(text).length, 1, label);
  }
});

test('unfamiliar links, standalone images, upstream links and literal code remain unchecked', () => {
  const text = [
    '[Release notes](https://github.com/another/project/releases)',
    '[Guide](https://github.com/another/project/blob/old/docs/guide.md)',
    '[Elsewhere](https://other.example/repository)',
    '[GitHub Copilot](https://github.com/features/copilot)',
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
  assert.deepEqual(references(text, options), []);
  assert.deepEqual(drift(text, 'public/llms.txt', options), []);
});

test('upstream exemptions stop at repository boundaries', () => {
  assert.equal(
    drift('[GitHub repository](https://github.com/holger1411/vibe2prod-copy)').length,
    1
  );
});

test('source-specific labels still reject the AGENTS.md convention homepage', () => {
  for (const label of ['Source ZIP', 'Component registry', 'AstroDeck skills'])
    assert.equal(drift(`[${label}](https://agents.md)`).length, 1, label);
});

test('link syntax inside image alt text does not create a source destination', () => {
  const text =
    '[![alt [Skills](https://wrong.example/inside)](badge.svg)](https://github.com/example/project)';
  assert.deepEqual(drift(text), []);
  assert.equal(references(text).length, 0);
  assert.equal(references('[![Project](badge.svg)](https://github.com/example/project)').length, 1);
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
    '[AstroDeck AGENTS.md](https://wrong.example/agents) [AstroDeck skills](https://wrong.example/skills)',
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
  assert.equal(references(text).length, 1);
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

test('unrelated roots, archives, source files and clones need an explicit source role', () => {
  const text = [
    ...TARGETS.map(([, suffix]) => `[Read more](https://github.com/another/project${suffix})`),
    '```bash',
    'git clone --branch wrong https://github.com/another/project.git',
    'git clone --branch wrong git@github.com:another/project.git',
    '```',
  ].join('\n');
  assert.deepEqual(references(text), []);
  assert.deepEqual(drift(text), []);
  assert.equal(sourceReferences(`[Read more](${IDENTITY.repository})`).length, 0);
});

test('generic labels do not assign a source role to local, issue or unfamiliar destinations', () => {
  for (const label of ['GitHub', 'AGENTS.md', 'Skills']) {
    for (const destination of [
      'AGENTS.md',
      '.agents/skills/',
      'https://agents.md/',
      `${IDENTITY.repository}/issues`,
      'https://github.com/another/project',
      'https://github.com/features/copilot',
      'https://mirror.example/source',
    ])
      assert.deepEqual(drift(`[${label}](${destination})`), [], `${label}: ${destination}`);
  }
});

test('current and former owner/repository labels detect wrong hosts and deep paths', () => {
  for (const label of ['example/project', 'STALE/SOURCE', '**example**/project']) {
    for (const destination of [
      'https://mirror.example/source',
      `${IDENTITY.repository}/tree/next/docs`,
      'https://github.com/another/project/issues',
    ]) {
      const findings = drift(`[${label}](${destination})`);
      assert.equal(findings.length, 1, `${label}: ${destination}`);
      assert.equal(findings[0].expected, IDENTITY.repository);
    }
  }
});

test('former identities must be supplied and match whole repository boundaries', () => {
  const former = 'https://github.com/holger1411/astrodeck';
  const text = `[Read more](${former})`;
  assert.deepEqual(drift(text), []);
  assert.equal(drift(text, 'README.md', { formerRepositories: [former] }).length, 1);
  for (const repository of [`${STALE}-copy`, `${STALE}.extra`, `${STALE}ish`, `${STALE}%2Dcopy`])
    assert.deepEqual(drift(`[Read more](${repository})`), []);
});

test('explicit source roles override upstream exemptions', () => {
  const upstream = 'https://github.com/holger1411/vibe2prod';
  for (const [, , label] of TARGETS)
    assert.equal(drift(`[${label}](${upstream})`).length, 1, label);
  assert.equal(drift(`[example/project](${upstream})`).length, 1);
  assert.deepEqual(drift(`[Read more](${upstream})`), []);
  assert.equal(
    drift(`[Source ZIP](${STALE})`, 'README.md', { upstreamRepositories: [STALE] }).length,
    1
  );
});

test('GitHub comparison accepts harmless variants while preserving destination meaning', () => {
  const variant = 'https://WWW.GITHUB.COM:443/EXAMPLE/PROJECT';
  for (const [, suffix] of TARGETS) {
    const current = suffix.replace('/old', '/next');
    const trailing = !current || current.endsWith('/skills') ? '/' : '';
    assert.deepEqual(drift(`[Read more](${variant}${current}${trailing}#section)`), [], current);
  }
  const root = IDENTITY.repository;
  for (const [label, destination] of [
    ['GitHub repository', 'http://github.com/example/project'],
    ['GitHub repository', `${root}?download=1`],
    ['GitHub repository', 'https://github.com:444/example/project'],
    ['AstroDeck AGENTS.md', `${root}/blob/NEXT/AGENTS.md`],
    ['AstroDeck AGENTS.md', `${root}/blob/next/agents.md`],
    ['AstroDeck AGENTS.md', `${root}/blob/next/AGENTS.md/`],
    ['AstroDeck AGENTS.md', `${root}/blob/next/AGENTS.md?plain=1`],
    ['AstroDeck skills', `${root}/tree/next/.agents/skills/extra`],
  ])
    assert.equal(drift(`[${label}](${destination})`).length, 1, destination);
});

test('image-only and unused reference definitions never become source references', () => {
  const text = [
    '![Source ZIP][badge]',
    '![AGENTS.md][agents]',
    '',
    `[badge]: ${STALE}/archive/refs/heads/old.zip`,
    `[agents]: ${STALE}/blob/old/AGENTS.md`,
    `[unused]: ${STALE}`,
  ].join('\n');
  assert.deepEqual(references(text), []);
  assert.deepEqual(drift(text), []);
});

test('definitions shared by images and real links are checked only once', () => {
  const text = [
    '![Source ZIP][shared]',
    '[Source ZIP][shared]',
    '[Another download][SHARED]',
    '',
    `[shared]: ${STALE}/archive/refs/heads/old.zip`,
  ].join('\n');
  assert.equal(drift(text).length, 1);
  assert.equal(drift(text)[0].line, 5);
});

test('image alt labels and simple inline HTML use the full definition environment', () => {
  for (const label of [
    '![Source **ZIP**][badge]',
    '![Source **ZIP**][BADGE]',
    '<span>Source</span> ZIP',
    'Source<!-- comment --> ZIP',
    'Source<br>ZIP',
    'Source<br />ZIP',
    'Source<BR class="break">ZIP',
  ]) {
    const text = `[${label}](https://wrong.example/download)\n\n[badge]: badge.svg`;
    assert.equal(references(text)[0]?.kind, 'zip', label);
    assert.equal(drift(text)[0]?.line, 1, label);
  }
  assert.deepEqual(
    drift('[&lt;span&gt;Source&lt;/span&gt; ZIP](https://wrong.example/download)'),
    []
  );
});

test('incompatible explicit roles produce one conflict at the shared definition destination', () => {
  const lines = [
    '[Source ZIP][shared]',
    '[AstroDeck skills][shared]',
    '[Main branch source ZIP][shared]',
    '',
    '[shared]:',
    `  <${IDENTITY.repository}/archive/refs/heads/next.zip>`,
  ];
  for (const ending of ['\n', '\r\n']) {
    const text = lines.join(ending);
    assert.equal(references(text)[0].kind, 'conflict');
    const findings = drift(text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 6);
    assert.match(findings[0].expected, /separate source destinations/u);
    assert.match(findings[0].expected, /skills: .*\/tree\/next\/\.agents\/skills/u);
    assert.match(findings[0].expected, /zip: .*\/archive\/refs\/heads\/next\.zip/u);
    assert.deepEqual(Object.keys(findings[0]).sort(), ['actual', 'expected', 'file', 'line']);
  }
});

test('known SSH clones retain canonical HTTPS requirements and branch checks', () => {
  for (const repository of [
    'git@github.com:example/project.git',
    'ssh://git@github.com/example/project.git',
    'ssh://git@www.GitHub.com/EXAMPLE/PROJECT.git',
    'git@github.com:stale/source.git',
  ]) {
    const text = `\`\`\`sh\ngit clone --branch old ${repository}\n\`\`\``;
    const findings = drift(text);
    assert.equal(findings.length, 2, repository);
    assert.equal(findings[0].expected, `${IDENTITY.repository}.git`);
    assert.equal(findings[1].expected, 'next');
  }
  assert.deepEqual(
    drift(
      '```sh\ngit clone --branch next https://WWW.GITHUB.COM:443/EXAMPLE/PROJECT.git#section\n```'
    ),
    []
  );
});

test('unsupported clone grammar and unknown remotes stay outside repository and branch checks', () => {
  const text = [
    '```sh',
    `git -C parent clone --branch old ${IDENTITY.repository}.git`,
    `git clone --unknown --branch old ${IDENTITY.repository}.git`,
    `git clone --branch old ${IDENTITY.repository}.git && cd project`,
    'git -C parent clone --branch old git@github.com:example/project.git',
    `git clone --branch old ssh://git@github.com/stale/source.git > clone.log`,
    'git clone --branch old https://github.com/another/project.git',
    'git clone --branch old https://github.com/example/project-copy.git',
    'git clone --branch old https://github.com/example/project%2Dcopy.git',
    '```',
  ].join('\n');
  assert.deepEqual(references(text), []);
  assert.deepEqual(drift(text), []);
});
