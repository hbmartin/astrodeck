import type { APIRoute } from 'astro';
// Root-document aliases keep build-time raw imports resolvable by Astro and static checks.
import agents from '@root/AGENTS.md?raw';
import readme from '@root/README.md?raw';
import conventions from '@root/docs/agents/astro-conventions.md?raw';
import { absoluteSourceLinks } from '@/lib/documentation-links.mjs';

/**
 * /llms-full.txt — the complete project documentation as plain text for LLMs.
 * Built from the index, README and framework conventions with source-relative links
 * rewritten as absolute repository URLs at build time.
 */
export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://www.astrodeck.dev')).origin;

  const body = [
    '# AstroDeck — full documentation for LLMs',
    '',
    `Short index: ${origin}/llms.txt`,
    `Live docs: ${origin}/docs`,
    `Source: https://github.com/hbmartin/astrodeck`,
    '',
    '---',
    '',
    '# Part 1: AGENTS.md (index for coding agents)',
    '',
    absoluteSourceLinks(agents.trim(), 'AGENTS.md'),
    '',
    '---',
    '',
    '# Part 2: README.md (human documentation)',
    '',
    absoluteSourceLinks(readme.trim(), 'README.md'),
    '',
    '---',
    '',
    '# Part 3: Astro and Tailwind conventions',
    '',
    absoluteSourceLinks(conventions.trim(), 'docs/agents/astro-conventions.md'),
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
