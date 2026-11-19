import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sourceIdentity } from '../src/lib/source-identity.mjs';
import { sourceDrift, sourceReferences } from '../scripts/lib/source-references.mjs';

const DOCUMENTS = ['README.md', 'CONTRIBUTING.md', 'public/llms.txt'];
const KIT_ONLY =
  process.env.ASTRODECK_KIT_CHECKS !== '1' &&
  'maintainer source references (set ASTRODECK_KIT_CHECKS=1)';
test(
  'hand-authored kit source references match the shared maintainer identity',
  { skip: KIT_ONLY },
  () => {
    const documents = Object.fromEntries(
      DOCUMENTS.map((file) => [file, readFileSync(join(import.meta.dirname, '..', file), 'utf8')])
    );
    for (const [file, text] of Object.entries(documents))
      assert.ok(
        sourceReferences(text).length > 0,
        `${file}: maintainer source references must be checked`
      );
    assert.deepEqual(sourceDrift(documents, sourceIdentity), []);
  }
);

const EXAMPLE = { repository: 'https://github.com/example/project', branch: 'next' };
const FIXTURE_OPTIONS = { upstreamRepositories: ['https://github.com/upstream/project'] };

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
  assert.deepEqual(sourceDrift(documents, EXAMPLE, FIXTURE_OPTIONS), []);
  for (const file of DOCUMENTS) {
    const changed = {
      ...documents,
      [file]: documents[file].replaceAll(EXAMPLE.repository, 'https://github.com/stale/source'),
    };
    const findings = sourceDrift(changed, EXAMPLE, FIXTURE_OPTIONS);
    assert.ok(findings.length > 0, file);
    assert.ok(findings.every((finding) => finding.file === file && finding.line > 0));
  }
});

test('source reference checks detect branch drift in clone, ZIP, blob and tree destinations', () => {
  const documents = exampleDocuments();
  const findings = sourceDrift(documents, { ...EXAMPLE, branch: 'release' }, FIXTURE_OPTIONS);
  assert.equal(findings.length, 6);
  assert.ok(
    findings.every(({ expected }) => expected === 'release' || expected.includes('/release'))
  );
  const quoted = {
    'README.md': documents['README.md'].replace('--branch next', '--branch="next"'),
  };
  assert.deepEqual(sourceDrift(quoted, EXAMPLE), []);
});
