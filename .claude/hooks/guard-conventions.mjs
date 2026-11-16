#!/usr/bin/env node
/**
 * AstroDeck convention guard (PreToolUse + PostToolUse hook for Write/Edit/MultiEdit).
 *
 * The rules live in scripts/lib/rules.mjs and are shared with `pnpm run lint:design`.
 *
 * PreToolUse  - hard-blocks non-negotiable violations (tailwind.config.*,
 *               ViewTransitions, z from astro:content) before the edit happens.
 * PostToolUse - reports every other finding (palette colors, inline styles, ...)
 *               after the edit; the assistant can then self-correct.
 *
 * Exit codes follow the Claude Code hook contract: 0 = OK, 2 = block / feed
 * stderr back to the assistant.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCKING = new Set(['tailwind-config', 'view-transitions', 'zod-from-content']);

// Project root: CLAUDE_PROJECT_DIR, else two levels up from .claude/hooks (works in ZIP copies).
const root = resolve(process.env.CLAUDE_PROJECT_DIR || join(import.meta.dirname, '..', '..'));

function hookFile(input) {
  const filePath = input.file_path;
  if (!filePath) return null;
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const relativePath = relative(root, absolute).split(sep).join('/');
  return {
    absolute,
    relative: relativePath.startsWith('..') ? filePath.split(sep).join('/') : relativePath,
  };
}

function proposedText(input) {
  const edits = Array.isArray(input.edits) ? input.edits : [];
  return [input.content, input.new_string, ...edits.map((edit) => edit?.new_string)]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

function reportBlocked(findings, formatFindings) {
  const blocked = findings.filter((f) => BLOCKING.has(f.rule));
  if (!blocked.length) return 0;
  process.stderr.write(`BLOCKED:\n${formatFindings(blocked)}\n`);
  return 2;
}

function reportFindings(event, path, findings, formatFindings) {
  if (event === 'PreToolUse') return reportBlocked(findings, formatFindings);
  if (event !== 'PostToolUse' || !findings.length) return 0;
  process.stderr.write(
    `AstroDeck convention findings for ${path}:\n${formatFindings(findings)}\n` +
      'Please fix this now unless the user explicitly asked for an exception.\n'
  );
  return 2;
}

function inputText(event, file, input) {
  if (event === 'PostToolUse') {
    try {
      return readFileSync(file.absolute, 'utf8');
    } catch {
      // The file may have moved or become unreadable since the edit.
    }
  }
  return proposedText(input);
}

async function checkPayload({ hook_event_name: event = '', tool_input: input = {} }) {
  const file = hookFile(input ?? {});
  if (!file) return 0;
  const { lintText } = await import(pathToFileURL(join(root, 'scripts', 'lib', 'rules.mjs')).href);
  const { formatFindings } = await import(
    pathToFileURL(join(root, 'scripts', 'lib', 'findings.mjs')).href
  );
  const findings = lintText(file.relative, inputText(event, file, input));
  return reportFindings(event, file.relative, findings, formatFindings);
}

function parsePayload(chunks) {
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined; // Malformed input must not break the session.
  }
}

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
function hookError(err) {
  console.error(`guard-conventions: hook disabled (${err?.message ?? err})`);
}

process.stdin.on('end', () => {
  const payload = parsePayload(chunks);
  if (payload === undefined) return;
  checkPayload(payload).then((status) => {
    process.exitCode = status;
  }, hookError);
});
