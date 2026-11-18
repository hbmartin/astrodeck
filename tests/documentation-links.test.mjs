import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteSourceLinks } from '../src/lib/documentation-links.mjs';

const SOURCE = 'https://github.com/hbmartin/astrodeck/blob/main/';

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
    '[![License](https://img.example/badge)](LICENSE)\n[Guide]: ../guide.md "Read this"\n[Space](<my guide.md> "Read") [Parens](guide(a).md)';
  assert.equal(
    absoluteSourceLinks(markdown, 'docs/README.md'),
    `[![License](https://img.example/badge)](${SOURCE}docs/LICENSE)\n[Guide]: ${SOURCE}guide.md "Read this"\n[Space](<${SOURCE}docs/my%20guide.md> "Read") [Parens](${SOURCE}docs/guide(a).md)`
  );
});

test('unfinished Markdown destinations are not rewritten as links', () => {
  const markdown = '[unfinished](README.md\n[bad title](README.md "unterminated)';
  assert.equal(absoluteSourceLinks(markdown, 'AGENTS.md'), markdown);
});
