import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import MarkdownIt from 'markdown-it';
import { sourceIdentity } from '../src/lib/source-identity.mjs';

const DOCUMENTS = ['README.md', 'CONTRIBUTING.md', 'public/llms.txt'];
const KIT_ONLY =
  process.env.ASTRODECK_KIT_CHECKS !== '1' &&
  'maintainer source references (set ASTRODECK_KIT_CHECKS=1)';
const markdown = new MarkdownIt();
const DESTINATIONS = new Map([
  ['main branch source zip', 'zip'],
  ['source zip', 'zip'],
  ['component registry', 'registry'],
  ['github repository', 'repository'],
]);
const SOURCE_DESTINATIONS = new Map([
  ['AGENTS.md', 'agents'],
  ['Skills', 'skills'],
]);

function linkKind(file, section, label, footer) {
  const simple = DESTINATIONS.get(label.toLowerCase());
  if (simple) return simple;
  if (file === 'public/llms.txt' && section === 'Source') return SOURCE_DESTINATIONS.get(label);
  if (footer && label === 'GitHub') return 'repository';
  if (
    ['Contributing', 'Bug fixes and feature proposals'].includes(section) &&
    /^[\w.-]+\/[\w.-]+$/u.test(label)
  )
    return 'repository';
}

function inlineReferences(token, file, section) {
  const children = token.children ?? [];
  return children.flatMap((child, index) => {
    if (child.type !== 'link_open') return [];
    const end = children.findIndex(
      (item, position) => position > index && item.type === 'link_close'
    );
    const label = children
      .slice(index + 1, end)
      .map((item) => item.content)
      .join('');
    const kind = linkKind(file, section, label, token.content.startsWith('**Links:**'));
    return kind ? [{ kind, actual: child.attrGet('href'), line: token.map[0] + 1 }] : [];
  });
}

function cloneReferences(token) {
  const references = [];
  for (const [index, line] of token.content.split('\n').entries()) {
    if (!/^git clone\b/u.test(line) || /YOUR_|\$/u.test(line)) continue;
    const location = token.map[0] + index + 2;
    const repository = line.match(/https:\/\/github\.com\/[^\s'"]+/u)?.[0];
    references.push({ kind: 'clone', actual: repository, line: location });
    const branch = line.match(/--branch(?:=|\s+)(?:'([^']+)'|"([^"]+)"|(\S+))/u);
    references.push({ kind: 'branch', actual: branch?.slice(1).find(Boolean), line: location });
  }
  return references;
}

function references(text, file) {
  const result = [];
  const tokens = markdown.parse(text, {});
  let section = '';
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'heading_open') section = tokens[index + 1].content;
    if (token.type === 'inline') result.push(...inlineReferences(token, file, section));
    if (token.type === 'fence' && file === 'README.md' && section === 'Developers')
      result.push(...cloneReferences(token));
  }
  return result;
}

function sourceDrift(documents, identity) {
  const { repository, branch } = identity;
  const expected = {
    repository,
    branch,
    clone: `${repository}.git`,
    zip: `${repository}/archive/refs/heads/${branch}.zip`,
    registry: `${repository}/blob/${branch}/src/registry.json`,
    agents: `${repository}/blob/${branch}/AGENTS.md`,
    skills: `${repository}/tree/${branch}/.agents/skills`,
  };
  return Object.entries(documents).flatMap(([file, text]) =>
    references(text, file)
      .filter(({ kind, actual }) => actual !== expected[kind])
      .map(({ kind, actual, line }) => ({ file, line, actual, expected: expected[kind] }))
  );
}

test(
  'hand-authored kit source references match the shared maintainer identity',
  { skip: KIT_ONLY },
  () => {
    const documents = Object.fromEntries(
      DOCUMENTS.map((file) => [file, readFileSync(join(import.meta.dirname, '..', file), 'utf8')])
    );
    for (const [file, text] of Object.entries(documents))
      assert.ok(
        references(text, file).length > 0,
        `${file}: maintainer source references must be checked`
      );
    assert.deepEqual(sourceDrift(documents, sourceIdentity), []);
  }
);

const EXAMPLE = { repository: 'https://github.com/example/project', branch: 'next' };

function exampleDocuments() {
  const { repository, branch } = EXAMPLE;
  return {
    'README.md': `### Developers\n\n\`\`\`bash\ngit clone --branch ${branch} --single-branch ${repository}.git my-site\n\`\`\`\n\n[Source ZIP](${repository}/archive/refs/heads/${branch}.zip)\n\n## Contributing\n\n[example/project](${repository})\n\n**Links:** [GitHub](${repository})`,
    'CONTRIBUTING.md': `## Setup\n\n\`\`\`bash\ngit clone https://github.com/YOUR_USERNAME/project.git\n\`\`\`\n\n## Bug fixes and feature proposals\n\n[example/project](${repository})\n\n## Acknowledgments\n\n[upstream/project](https://github.com/upstream/project)`,
    'public/llms.txt': `[Component registry](${repository}/blob/${branch}/src/registry.json)\n\n## Source\n\n[GitHub repository](${repository})\n[AGENTS.md](${repository}/blob/${branch}/AGENTS.md)\n[Skills](${repository}/tree/${branch}/.agents/skills)\n[Main branch source ZIP](${repository}/archive/refs/heads/${branch}.zip)`,
  };
}

test('source reference checks detect repository drift while preserving upstream and substitution examples', () => {
  const documents = exampleDocuments();
  assert.deepEqual(sourceDrift(documents, EXAMPLE), []);
  for (const file of DOCUMENTS) {
    const changed = {
      ...documents,
      [file]: documents[file].replaceAll(EXAMPLE.repository, 'https://github.com/stale/source'),
    };
    const findings = sourceDrift(changed, EXAMPLE);
    assert.ok(findings.length > 0, file);
    assert.ok(findings.every((finding) => finding.file === file && finding.line > 0));
  }
});

test('source reference checks detect branch drift in clone, ZIP, blob and tree destinations', () => {
  const documents = exampleDocuments();
  const findings = sourceDrift(documents, { ...EXAMPLE, branch: 'release' });
  assert.equal(findings.length, 6);
  assert.ok(
    findings.every(({ expected }) => expected === 'release' || expected.includes('/release'))
  );
  const quoted = {
    'README.md': documents['README.md'].replace('--branch next', '--branch="next"'),
  };
  assert.deepEqual(sourceDrift(quoted, EXAMPLE), []);
});
