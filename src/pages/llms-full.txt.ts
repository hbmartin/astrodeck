import type { APIRoute } from 'astro';
import { sourceIdentity } from '@/lib/source-identity.mjs';
// The build plugin rewrites source links and emits static strings, without a runtime parser.
import agents from '@root/AGENTS.md?source-links&raw';
import readme from '@root/README.md?source-links&raw';
import conventions from '@root/docs/agents/astro-conventions.md?source-links&raw';

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
    `Source: ${sourceIdentity.repository}`,
    '',
    '---',
    '',
    '# Part 1: AGENTS.md (index for coding agents)',
    '',
    agents.trim(),
    '',
    '---',
    '',
    '# Part 2: README.md (human documentation)',
    '',
    readme.trim(),
    '',
    '---',
    '',
    '# Part 3: Astro and Tailwind conventions',
    '',
    conventions.trim(),
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
