import MarkdownIt from 'markdown-it';
import { decodeString } from 'micromark-util-decode-string';
import { sourceDestinationKind } from './source-reference-urls.mjs';

const markdown = new MarkdownIt('commonmark', { html: true });
const SCOPES = new Set(['link', 'image', 'autolink', 'definition']);
const LABELS = new Map([
  ['main branch source zip', 'zip'],
  ['source zip', 'zip'],
  ['component registry', 'registry'],
  ['github repository', 'repository'],
  ['astrodeck agents.md', 'agents'],
  ['astrodeck skills', 'skills'],
]);
const IDENTIFIERS = new Set(['definitionLabelString', 'referenceString']);
const EMPTY_DESTINATIONS = new Set(['resource', 'resourceDestination', 'definitionDestination']);
const DESTINATION_STRINGS = new Set([
  'resourceDestinationString',
  'definitionDestinationString',
  'autolinkProtocol',
]);

function visibleToken(token) {
  if (['softbreak', 'hardbreak'].includes(token.type)) return ' ';
  if (token.type === 'image') return visibleText(token.children ?? []);
  if (token.type === 'html_inline')
    return /^<br(?:\s[^>]*)?\/?\s*>$/iu.test(token.content) ? ' ' : '';
  return token.content;
}

function visibleText(tokens) {
  return tokens.map(visibleToken).join('');
}

function labelKind(label = '', environment, policy) {
  const children = markdown.parseInline(label, environment)[0]?.children ?? [];
  const normalized = visibleText(children).replace(/\s+/gu, ' ').trim().toLowerCase();
  return policy.repositoryLabels.has(normalized) ? 'repository' : LABELS.get(normalized);
}

function targetField(target, token, context) {
  const value = context.sliceSerialize(token);
  if (token.type === 'labelText') target.label = value;
  else if (IDENTIFIERS.has(token.type)) {
    target.identifier = markdown.utils.normalizeReference(value);
  } else if (EMPTY_DESTINATIONS.has(token.type)) {
    target.actual = '';
    target.line = token.start.line;
  } else if (DESTINATION_STRINGS.has(token.type)) {
    target.actual = markdown.normalizeLink(decodeString(value));
    target.line = token.start.line;
  }
}

function markdownTargets(events) {
  const scopes = [];
  const targets = [];
  for (const [event, token, context] of events) {
    if (SCOPES.has(token.type)) {
      if (event === 'enter') scopes.push({ type: token.type, offset: token.start.offset });
      else {
        const target = scopes.pop();
        target.inImage = scopes.some((scope) => scope.type === 'image');
        targets.push(target);
      }
    } else if (event === 'enter' && scopes.length) {
      targetField(scopes.at(-1), token, context);
    }
  }
  return targets;
}

function targetDefinitions(targets) {
  const definitions = new Map();
  for (const target of targets) {
    if (target.type === 'definition' && !definitions.has(target.identifier))
      definitions.set(target.identifier, { ...target, usages: [] });
  }
  return definitions;
}

function definitionEnvironment(definitions) {
  const references = Object.create(null);
  for (const [identifier, { actual }] of definitions)
    references[identifier] = { href: actual, title: '' };
  return { references };
}

function resolvedTargets(targets, definitions) {
  const destinations = [];
  for (const target of targets) {
    if (target.type === 'definition') continue;
    if (target.actual !== undefined) destinations.push({ ...target, usages: [target] });
    else {
      const identifier = target.identifier ?? markdown.utils.normalizeReference(target.label ?? '');
      definitions.get(identifier)?.usages.push(target);
    }
  }
  return destinations.concat([...definitions.values()]).sort((a, b) => a.offset - b.offset);
}

function sourceTarget(target, environment, policy) {
  const links = target.usages.filter(({ type, inImage }) => type !== 'image' && !inImage);
  if (!links.length) return [];
  const explicit = links.map(({ label }) => labelKind(label, environment, policy)).filter(Boolean);
  const inferred = sourceDestinationKind(target.actual, policy);
  const kinds = [...new Set(explicit.length ? explicit : [inferred].filter(Boolean))].sort();
  return kinds.length ? [{ kinds, actual: target.actual, line: target.line }] : [];
}

export function markdownSourceTargets(events, policy) {
  const targets = markdownTargets(events);
  const definitions = targetDefinitions(targets);
  const environment = definitionEnvironment(definitions);
  return resolvedTargets(targets, definitions).flatMap((target) =>
    sourceTarget(target, environment, policy)
  );
}
