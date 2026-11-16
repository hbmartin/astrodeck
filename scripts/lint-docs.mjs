#!/usr/bin/env node
/**
 * Docs lint: keeps Markdown docs truthful.
 * Backticked paths covered by starter.manifest.json remove/removeUnlessBlog lists are optional:
 * a cleaned starter has deleted them on purpose, so they are not reported as dead.
 * Rules: dead-path, version-drift, count-drift, site-url-drift.
 * Usage: node scripts/lint-docs.mjs [projectRoot]   (exit 1 on any finding)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFindings } from './lib/findings.mjs';
import { walkFiles } from './lib/walk-files.mjs';

const ROOT_DOCS = [
  'AGENTS.md',
  'CLAUDE.md',
  'PROJECT.md',
  'README.md',
  'CONTRIBUTING.md',
  '.github/copilot-instructions.md',
];
const SCAN_DIRS = ['docs', '.claude'];
const CLAUDE_SKILLS = '.claude/skills';

const PATH_ROOTS = ['src', 'scripts', 'public', 'docs', 'tests', '.claude', '.github'];

function listDocs(root) {
  const files = new Set();
  for (const f of ROOT_DOCS) if (existsSync(join(root, f))) files.add(join(root, f));
  const skills = join(root, CLAUDE_SKILLS);
  const isMarkdown = (name) => name.endsWith('.md');
  for (const dir of SCAN_DIRS.map((name) => join(root, name))) {
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir, isMarkdown, (path) => path === skills)) files.add(file);
  }
  return [...files]
    .map((f) => ({ abs: f, rel: relative(root, f).split(sep).join('/') }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Mark lines inside fenced code blocks. @param {string[]} lines */
function fenceMask(lines) {
  let fence = null;
  return lines.map((l) => {
    const m = l.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!fence) {
        fence = m[1][0];
        return true;
      }
      if (m[1][0] === fence) {
        fence = null;
        return true;
      }
    }
    return fence !== null;
  });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Repo paths the starter cleanup may delete (from starter.manifest.json). @returns {string[]} */
function optionalPaths(root) {
  const m = readJson(join(root, 'starter.manifest.json'));
  return [...(m?.remove ?? []), ...(m?.removeUnlessBlog ?? [])].map((p) => p.replace(/\/+$/, ''));
}

function parseVer(range) {
  const m = String(range ?? '').match(/(\d+)(?:\.(\d+))?/);
  return m ? { major: +m[1], minor: m[2] === undefined ? 0 : +m[2] } : null;
}

function prepareVersionRules(pkg) {
  const tools = [
    [
      /\bAstro\s+v?(\d+)(?:\.(\d+))?/g,
      'astro',
      pkg?.dependencies?.astro ?? pkg?.devDependencies?.astro,
    ],
    [
      /\bTailwind(?:\s+CSS)?\s+v?(\d+)(?:\.(\d+))?/g,
      'tailwindcss',
      pkg?.devDependencies?.tailwindcss ?? pkg?.dependencies?.tailwindcss,
    ],
    [/\bNode(?:\.js)?\s+v?(\d+)(?:\.(\d+))?/g, 'node', pkg?.engines?.node],
  ];
  return tools.map(([pattern, tool, range]) => ({
    pattern,
    minimum: tool === 'node',
    expected: parseVer(range),
    reason:
      tool === 'node' ? `is below engines.node ${range}` : `but package.json has ${tool} ${range}`,
  }));
}

/**
 * @param {string} root project root
 * @returns {import('./lib/findings.mjs').Finding[]}
 */
export function lintDocs(root) {
  /** @type {import('./lib/findings.mjs').Finding[]} */
  const findings = [];
  const pkg = readJson(join(root, 'package.json'));
  const registry = readJson(join(root, 'src/registry.json'));
  const versionRules = prepareVersionRules(pkg);
  const optional = optionalPaths(root);
  const isOptional = (p) => optional.some((o) => p === o || p.startsWith(`${o}/`));
  const counts = registry
    ? [
        [/\b(\d+)\s+sections\b/gi, 'sections', registry.sections?.length],
        [/\b(\d+)\s+layouts\b/gi, 'layouts', registry.layouts?.length],
        [/\b(\d+)\s+UI components\b/gi, 'UI components', registry.ui?.length],
      ]
    : [];

  for (const { abs, rel } of listDocs(root)) {
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    const inFence = fenceMask(lines);
    const isChangelog = /(^|\/)CHANGELOG\.md$/.test(rel);
    lines.forEach((line, i) => {
      if (inFence[i]) return;
      const add = (rule, message) => findings.push({ file: rel, line: i + 1, rule, message });
      checkPaths(line, root, isOptional, add);
      if (!isChangelog) checkVersions(line, versionRules, add);
      checkCounts(line, counts, add);
    });
  }

  findings.push(...siteUrlDrift(root));
  return findings;
}

function documentedPath(text) {
  const p = text.trim();
  if (/[\s*{}<>[\]$|()]|\.\.\./.test(p)) return '';
  const path = p.replace(/[#:]\d*[\w-]*$/, '').replace(/[.,;]+$/, '');
  if (path === CLAUDE_SKILLS || path.startsWith(`${CLAUDE_SKILLS}/`)) return '';
  return path;
}

function checkPaths(line, root, isOptional, add) {
  for (const match of line.matchAll(/`([^`\n]+)`/g)) {
    const p = documentedPath(match[1]);
    if (!p.includes('/') || !PATH_ROOTS.includes(p.split('/')[0])) continue;
    if (!existsSync(join(root, p)) && !isOptional(p))
      add('dead-path', `\`${match[1]}\` does not exist`);
  }
}

function versionMismatch(match, expected, minimum) {
  const major = +match[1];
  if (major !== expected.major) return minimum ? major < expected.major : true;
  if (match[2] === undefined) return false;
  const minor = +match[2];
  return minimum ? minor < expected.minor : minor !== expected.minor;
}

function checkVersions(line, rules, add) {
  for (const { pattern, expected, minimum, reason } of rules) {
    if (!expected) continue;
    for (const match of line.matchAll(pattern)) {
      if (versionMismatch(match, expected, minimum))
        add('version-drift', `"${match[0]}" ${reason}`);
    }
  }
}

function checkCounts(line, counts, add) {
  for (const [re, label, actual] of counts) {
    if (actual === undefined) continue;
    for (const m of line.matchAll(re))
      if (+m[1] !== actual) add('count-drift', `"${m[0]}" but registry has ${actual} ${label}`);
  }
}

function checkCanonicalUrl(urlFile, siteTs) {
  const canonical = readFileSync(urlFile, 'utf8').match(/SITE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
  const site = readFileSync(siteTs, 'utf8');
  const m = site.match(/^\s+url:\s*(SITE_URL|'[^']*'|"[^"]*"),/m);
  if (m) {
    const val = m[1].trim();
    const literal = val.match(/^['"]([^'"]+)['"]$/)?.[1];
    if (val !== 'SITE_URL' && literal !== canonical)
      return {
        file: 'src/config/site.ts',
        rule: 'site-url-drift',
        message: `url is ${val}; use SITE_URL from site-url.mjs (${canonical})`,
      };
  }
}

function siteUrlDrift(root) {
  const out = [];
  const urlFile = join(root, 'src/config/site-url.mjs');
  const siteTs = join(root, 'src/config/site.ts');
  if (!existsSync(urlFile) || !existsSync(siteTs)) return out;
  const finding = checkCanonicalUrl(urlFile, siteTs);
  if (finding) out.push(finding);
  const cfg = join(root, 'astro.config.mjs');
  if (
    existsSync(cfg) &&
    !/import\s*\{[^}]*SITE_URL[^}]*\}\s*from\s*['"][^'"]*site-url\.mjs['"]/.test(
      readFileSync(cfg, 'utf8')
    )
  )
    out.push({
      file: 'astro.config.mjs',
      rule: 'site-url-drift',
      message: 'does not import SITE_URL from src/config/site-url.mjs',
    });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..'));
  const findings = lintDocs(root);
  if (findings.length) console.error(formatFindings(findings));
  console.log(`lint:docs - ${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}
