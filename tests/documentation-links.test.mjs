import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { absoluteSourceLinks } from '../src/lib/documentation-links.mjs';
import { sourceIdentity } from '../src/lib/source-identity.mjs';
import { documentationLinksPlugin } from '../scripts/lib/documentation-links-plugin.mjs';

const SOURCE = `${sourceIdentity.repository}/blob/${sourceIdentity.branch}/`;
const markdown = new MarkdownIt();

function destinations(text) {
  return markdown
    .parse(text, {})
    .flatMap((token) => token.children ?? [])
    .filter((token) => ['link_open', 'image'].includes(token.type))
    .map((token) => token.attrGet(token.type === 'image' ? 'src' : 'href'));
}

function linkedCheckout(t) {
  // Vite normalizes macOS /var before configResolved; retain only the checkout symlink.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'astrodeck-linked-docs-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const actualRoot = join(directory, 'actual');
  const root = join(directory, 'checkout');
  mkdirSync(actualRoot);
  symlinkSync(actualRoot, root, 'dir');
  return { directory, actualRoot, root };
}

function astroFixture(t) {
  const fixture = linkedCheckout(t);
  const { actualRoot } = fixture;
  const project = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(join(actualRoot, 'src', 'pages'), { recursive: true });
  mkdirSync(join(actualRoot, 'src', 'lib'));
  symlinkSync(join(project, 'node_modules'), join(actualRoot, 'node_modules'), 'dir');
  writeFileSync(join(actualRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(actualRoot, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'], '@root/*': ['./*'] } } })
  );
  return { ...fixture, project };
}

async function buildFixture(root) {
  const { build } = await import('astro');
  await build({
    root: pathToFileURL(root + sep),
    configFile: false,
    logLevel: 'silent',
    vite: { plugins: [documentationLinksPlugin()] },
  });
}

function moduleText(module) {
  return JSON.parse(module.slice('export default '.length, -1));
}

test('documentation links resolve relative to each source with queries and fragments', () => {
  assert.equal(
    absoluteSourceLinks(
      '[Conventions](astro-conventions.md#templates) [Root](/README.md?plain=1)',
      'docs/agents/mcp-setup.md'
    ),
    `[Conventions](${SOURCE}docs/agents/astro-conventions.md#templates) [Root](${SOURCE}README.md?plain=1)`
  );
  assert.equal(
    absoluteSourceLinks(
      '[Brief](PROJECT.md) [Skill](.agents/skills/astrodeck-new-page/SKILL.md)',
      'AGENTS.md'
    ),
    `[Brief](${SOURCE}PROJECT.md) [Skill](${SOURCE}.agents/skills/astrodeck-new-page/SKILL.md)`
  );
});

test('external links, fragment links and code examples remain intact', () => {
  const markdown = [
    '[Web](https://example.test/a) [Mail](mailto:me@example.test) [CDN](//cdn.example.test/a) [Here](#commands)',
    '`[Example](local.md)` and ``[Example](other.md)``',
    '```md',
    '[Example](local.md)',
    '```',
    '~~~md',
    '[Example](local.md)',
    '~~~',
    '',
    '    [Indented example](local.md)',
    '',
    '[Real](README.md)',
  ].join('\n');
  assert.equal(
    absoluteSourceLinks(markdown, 'AGENTS.md'),
    markdown.replace('[Real](README.md)', `[Real](${SOURCE}README.md)`)
  );
});

test('nested image links, reference definitions and titled or bracketed destinations are rewritten', () => {
  const markdown =
    '[![License](https://img.example/badge)](LICENSE)\n\n[Guide]: ../guide.md "Read this"\n\n[Space](<my guide.md> "Read") [Parens](guide(a).md)';
  assert.equal(
    absoluteSourceLinks(markdown, 'docs/README.md'),
    `[![License](https://img.example/badge)](${SOURCE}docs/LICENSE)\n\n[Guide]: ${SOURCE}guide.md "Read this"\n\n[Space](<${SOURCE}docs/my%20guide.md> "Read") [Parens](${SOURCE}docs/guide\\(a\\).md)`
  );
});

test('unfinished Markdown destinations are not rewritten as links', () => {
  const markdown = '[unfinished](README.md\n[bad title](README.md "unterminated)';
  assert.equal(absoluteSourceLinks(markdown, 'AGENTS.md'), markdown);
});

test('unmatched backtick runs do not conceal real links', () => {
  const input = '` [Guide](README.md) ``';
  const output = absoluteSourceLinks(input, 'AGENTS.md');
  assert.equal(output, input.replace('README.md', `${SOURCE}README.md`));
  assert.deepEqual(destinations(output), [`${SOURCE}README.md`]);
});

test('plain marker lookalikes and paragraph continuations remain unchanged', () => {
  for (const input of [
    'example](README.md)',
    'paragraph\n[Guide]: README.md',
    '[Fake][guide]\n[guide]: README.md',
  ]) {
    assert.deepEqual(destinations(input), []);
    assert.equal(absoluteSourceLinks(input, 'AGENTS.md'), input);
  }
});

test('escaped parentheses and entity text retain their parsed destination meaning', () => {
  const cases = [
    [String.raw`[Guide](guide\(draft.md)`, `${SOURCE}guide(draft.md`],
    [String.raw`[Guide](guide\)draft.md)`, `${SOURCE}guide)draft.md`],
    ['[Guide](guide(a).md)', `${SOURCE}guide(a).md`],
    ['[Guide](file?x=&amp;copy;)', `${SOURCE}file?x=&copy;`],
    [String.raw`[Guide](file?x=\\path)`, `${SOURCE}file?x=%5Cpath`],
  ];
  for (const [input, expected] of cases) {
    const output = absoluteSourceLinks(input, 'AGENTS.md');
    assert.deepEqual(destinations(output), [expected], input);
    assert.equal(destinations(output).length, destinations(input).length);
  }
});

test('destination text cannot create overlapping edits in outer links', () => {
  const input = '[Guide](<draft[api](v1).md>)';
  const output = absoluteSourceLinks(input, 'AGENTS.md');
  assert.equal(output, `[Guide](<${SOURCE}draft[api](v1).md>)`);
  assert.deepEqual(destinations(output), [`${SOURCE}draft%5Bapi%5D(v1).md`]);
  const external = '[Guide](<https://example.test/draft[api](v1).md>)';
  assert.equal(absoluteSourceLinks(external, 'AGENTS.md'), external);
});

test('multiline code spans stay literal while following links are rewritten', () => {
  const input = '`code starts\n[Example](README.md)\nends` [Real](README.md)';
  const output = absoluteSourceLinks(input, 'AGENTS.md');
  assert.equal(output, input.replace('[Real](README.md)', `[Real](${SOURCE}README.md)`));
  assert.deepEqual(destinations(output), [`${SOURCE}README.md`]);
});

test('multiline links and definitions preserve their original container syntax', () => {
  const cases = [
    '[Guide](\nREADME.md)',
    '[Guide](\n<README.md>\n "Read this")',
    '> [Guide]:\n>   README.md "Read this"\n>\n> [Guide]',
    '- [Guide]:\n    README.md "Read this"\n\n  [Guide]',
  ];
  for (const input of cases) {
    const output = absoluteSourceLinks(input, 'AGENTS.md');
    assert.equal(output, input.replace('README.md', `${SOURCE}README.md`));
    assert.deepEqual(destinations(output), [`${SOURCE}README.md`], input);
  }
});

test('nested images and links receive separate destination edits', () => {
  const input = '[![Cover](images/cover.png "Cover")](README.md "Read")';
  const output = absoluteSourceLinks(input, 'docs/README.md');
  assert.equal(
    output,
    `[![Cover](${SOURCE}docs/images/cover.png "Cover")](${SOURCE}docs/README.md "Read")`
  );
  assert.deepEqual(destinations(output), [
    `${SOURCE}docs/README.md`,
    `${SOURCE}docs/images/cover.png`,
  ]);
});

test('reference usages remain unchanged and unused definitions are still rewritten', () => {
  const input = '[Full][guide] [guide][] [guide]\n\n[guide]: README.md "Guide"\n[unused]: other.md';
  const output = absoluteSourceLinks(input, 'AGENTS.md');
  assert.equal(
    output,
    `[Full][guide] [guide][] [guide]\n\n[guide]: ${SOURCE}README.md "Guide"\n[unused]: ${SOURCE}other.md`
  );
  assert.deepEqual(destinations(output), Array(3).fill(`${SOURCE}README.md`));
});

test('footnote-shaped definitions remain intact while ordinary definitions are rewritten', () => {
  const input = [
    '[^note]: README.md "A prose footnote"',
    '> [^nested]: ../README.md',
    '',
    '[^link]: [Guide](README.md)',
    '',
    '[guide]: README.md',
    String.raw`[\^ordinary]: other.md`,
    '',
    '[Guide][guide] [Real](docs/guide.md)',
  ].join('\r\n');
  assert.equal(
    absoluteSourceLinks(input, 'AGENTS.md'),
    input
      .replace('[guide]: README.md', `[guide]: ${SOURCE}README.md`)
      .replace(': other.md', `: ${SOURCE}other.md`)
      .replace('(docs/guide.md)', `(${SOURCE}docs/guide.md)`)
  );
});

test('repository-root traversal is rejected after URL path normalization', () => {
  for (const destination of ['../README.md', '%2e%2e/README.md', './a/../../README.md']) {
    assert.throws(
      () => absoluteSourceLinks(`[Guide](${destination})`, 'AGENTS.md'),
      (error) => error.message.includes('AGENTS.md') && error.message.includes(destination),
      destination
    );
  }
  assert.throws(
    () => absoluteSourceLinks('[Guide](/../README.md)', 'docs/agents/guide.md'),
    /docs\/agents\/guide\.md.*\/\.\.\/README\.md/u
  );
  assert.equal(
    absoluteSourceLinks(
      '[Guide](../../README.md) [Encoded](../%2e%2e/README.md)',
      'docs/agents/guide.md'
    ),
    `[Guide](${SOURCE}README.md) [Encoded](${SOURCE}README.md)`
  );
});

test('source offsets preserve initial BOMs, Unicode, tabs and line endings', () => {
  for (const bom of ['', '\uFEFF', '\uFEFF\uFEFF']) {
    for (const ending of ['\n', '\r\n', '\r']) {
      const input = `${bom}😀\t[Guide](README.md "Title 😀")${ending}${ending}[Next](other.md)${ending}`;
      const output = absoluteSourceLinks(input, 'AGENTS.md');
      assert.equal(
        output,
        input.replace('README.md', `${SOURCE}README.md`).replace('other.md', `${SOURCE}other.md`)
      );
      assert.deepEqual(destinations(output), [`${SOURCE}README.md`, `${SOURCE}other.md`]);
    }
  }
});

test('external and fragment destination escapes remain byte-for-byte intact', () => {
  const input = String.raw`[Web](https://example.test/a\(b\)?x=&amp;copy;) [Here](#a\(b\)) [CDN](//example.test/a\(b\))`;
  assert.equal(absoluteSourceLinks(input, 'AGENTS.md'), input);
});

test('the build plugin emits watched source documents as static string modules', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astrodeck-source-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  const file = join(root, 'docs', 'guide.md');
  writeFileSync(file, '\uFEFF[Read](../README.md)\r\n');
  const watched = [];
  const plugin = documentationLinksPlugin();
  plugin.configResolved({ root });
  assert.equal(await plugin.load(`${file}?raw`), undefined);
  assert.equal(plugin.resolveId('@root/docs/guide.md?raw'), undefined);
  const id = plugin.resolveId('@root/docs/guide.md?source-links&raw');
  const module = await plugin.load.call({ addWatchFile: (path) => watched.push(path) }, id);
  assert.equal(moduleText(module), `\uFEFF[Read](${SOURCE}README.md)\r\n`);
  assert.deepEqual(watched, [...new Set([file, realpathSync(file)])]);
});

test('linked documents keep their repository path and watch their linked content', async (t) => {
  const { directory, actualRoot, root } = linkedCheckout(t);
  mkdirSync(join(actualRoot, 'docs'), { recursive: true });
  const target = join(directory, 'external.md');
  writeFileSync(target, '[Peer](peer.md)');
  const file = join(root, 'docs', 'guide.md');
  symlinkSync(target, file);
  const plugin = documentationLinksPlugin();
  plugin.configResolved({ root });
  const watched = [];
  const id = plugin.resolveId('@root/docs/guide.md?source-links&raw');
  const module = await plugin.load.call({ addWatchFile: (path) => watched.push(path) }, id);
  assert.equal(moduleText(module), `[Peer](${SOURCE}docs/peer.md)`);
  assert.deepEqual(watched, [file, realpathSync(target)]);
});

test('resolved absolute loads do not repeat root-relative import resolution', async (t) => {
  const { root } = linkedCheckout(t);
  const file = join(root, 'guide.md');
  const fromRoot = resolve(root, `.${file}`);
  mkdirSync(dirname(fromRoot), { recursive: true });
  writeFileSync(file, '[Absolute](peer.md)');
  writeFileSync(fromRoot, '[Root](other.md)');
  const plugin = documentationLinksPlugin();
  plugin.configResolved({ root });
  const context = { addWatchFile() {} };
  const loaded = await plugin.load.call(context, `${file}?source-links&raw`);
  assert.equal(moduleText(loaded), `[Absolute](${SOURCE}peer.md)`);
  const id = plugin.resolveId(`${file}?source-links&raw`);
  const imported = await plugin.load.call(context, id);
  assert.equal(
    moduleText(imported),
    absoluteSourceLinks('[Root](other.md)', relative(root, fromRoot).split(sep).join('/'))
  );
  writeFileSync(join(root, '..', 'outside.md'), '[Outside](peer.md)');
  await assert.rejects(
    plugin.load.call(context, `${join(root, '..', 'outside.md')}?source-links&raw`),
    /Source document is outside the repository/u
  );
});

test('the real Vite pipeline preserves source paths for root, alias and absolute imports', async (t) => {
  const { directory, actualRoot, root } = astroFixture(t);
  const content = '[Peer](peer.md)';
  const target = join(directory, 'outside.md');
  writeFileSync(target, content);
  mkdirSync(join(root, 'docs'));
  for (const path of ['README.md', 'docs/guide.md']) {
    symlinkSync(target, join(root, path));
  }
  // Astro passes the canonical checkout root to Vite's configResolved hook.
  const absolute = join(actualRoot, 'docs', 'guide.md');
  const collision = join(actualRoot, 'docs', 'collision.md');
  const fromRoot = resolve(actualRoot, `.${collision}`);
  mkdirSync(dirname(fromRoot), { recursive: true });
  writeFileSync(collision, '[Filesystem](unused.md)');
  writeFileSync(fromRoot, '[Project](peer.md)');
  const imports = {
    readme: '/README.md?source-links&raw',
    root: '/docs/guide.md?source-links&raw',
    alias: '@root/docs/guide.md?source-links&raw',
    absolute: `${absolute}?source-links&raw`,
    raw: '/docs/guide.md?raw',
    collision: `${collision}?source-links&raw`,
    collisionRaw: `${collision}?raw`,
  };
  writeFileSync(
    join(root, 'src', 'pages', 'documents.json.ts'),
    [
      ...Object.entries(imports).map(
        ([name, path]) => `import ${name} from ${JSON.stringify(path)};`
      ),
      `export function GET() { return Response.json({ ${Object.keys(imports).join(', ')} }); }`,
    ].join('\n')
  );
  await buildFixture(root);
  const body = JSON.parse(readFileSync(join(actualRoot, 'dist', 'documents.json'), 'utf8'));
  assert.deepEqual(body, {
    readme: absoluteSourceLinks(content, 'README.md'),
    root: absoluteSourceLinks(content, 'docs/guide.md'),
    alias: absoluteSourceLinks(content, 'docs/guide.md'),
    absolute: absoluteSourceLinks(content, 'docs/guide.md'),
    raw: content,
    collision: absoluteSourceLinks(
      '[Project](peer.md)',
      relative(actualRoot, fromRoot).split(sep).join('/')
    ),
    collisionRaw: '[Project](peer.md)',
  });
});

// Cleanup removes the demo endpoint. Helper and plugin tests above remain active for customer sites.
test(
  'the real Astro/Vite build exports all three linked documents with logical source paths',
  {
    skip:
      process.env.ASTRODECK_KIT_CHECKS !== '1' && 'demo documentation export requires kit checks',
  },
  async (t) => {
    const { directory, actualRoot, root, project } = astroFixture(t);
    for (const path of ['src/pages/llms-full.txt.ts', 'src/lib/source-identity.mjs']) {
      writeFileSync(join(actualRoot, path), readFileSync(join(project, path)));
    }
    const documents = ['AGENTS.md', 'README.md', 'docs/agents/astro-conventions.md'];
    for (const [index, path] of documents.entries()) {
      const target = join(directory, `linked-${index}.md`);
      writeFileSync(target, readFileSync(join(project, path)));
      mkdirSync(dirname(join(actualRoot, path)), { recursive: true });
      symlinkSync(target, join(actualRoot, path));
    }
    await buildFixture(root);
    const body = readFileSync(join(actualRoot, 'dist', 'llms-full.txt'), 'utf8');
    assert.ok(body.includes(`Source: ${sourceIdentity.repository}`));
    for (const path of documents) {
      assert.ok(
        body.includes(absoluteSourceLinks(readFileSync(join(project, path), 'utf8'), path).trim()),
        path
      );
    }
    assert.ok(!body.includes(`${SOURCE}../`));
  }
);
