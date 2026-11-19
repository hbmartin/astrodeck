import MarkdownIt from 'markdown-it';
import { parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';
import { parseSourceClone } from './source-clones.mjs';

const markdown = new MarkdownIt();
const SCOPES = new Set(['link', 'image', 'autolink', 'definition']);
const LABELS = new Map([
  ['main branch source zip', 'zip'],
  ['source zip', 'zip'],
  ['component registry', 'registry'],
  ['github repository', 'repository'],
  ['github', 'repository'],
  ['agents.md', 'agents'],
  ['skills', 'skills'],
]);
const UPSTREAM = ['https://github.com/holger1411/vibe2prod'];
const STANDARDS = new Set(['https://agents.md', 'https://agents.md/']);
const DESTINATION_SHAPES = [
  [/^\/?$/u, 'repository'],
  [/^\/archive\/refs\/heads\/.+\.zip$/u, 'zip'],
  [/^\/blob\/.+\/src\/registry\.json$/u, 'registry'],
  [/^\/blob\/.+\/AGENTS\.md$/u, 'agents'],
  [/^\/tree\/.+\/\.agents\/skills\/?$/u, 'skills'],
];
const IDENTIFIERS = new Set(['definitionLabelString', 'referenceString']);
const EMPTY_DESTINATIONS = new Set(['resource', 'resourceDestination', 'definitionDestination']);
const DESTINATION_STRINGS = new Set([
  'resourceDestinationString',
  'definitionDestinationString',
  'autolinkProtocol',
]);

function visibleText(tokens) {
  return tokens
    .map((token) => {
      if (['softbreak', 'hardbreak'].includes(token.type)) return ' ';
      return token.type === 'image' ? visibleText(token.children ?? []) : token.content;
    })
    .join('');
}

function labelKind(label = '') {
  const children = markdown.parseInline(label, {})[0]?.children ?? [];
  return LABELS.get(visibleText(children).replace(/\s+/gu, ' ').trim().toLowerCase());
}

function destinationKind(actual) {
  let url;
  try {
    url = new URL(actual);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'github.com') return undefined;
  const suffix = url.pathname.match(/^\/[\w.-]+\/[\w.-]+(.*)$/u)?.[1];
  return DESTINATION_SHAPES.find(([pattern]) => pattern.test(suffix))?.[1];
}

function upstreamDestination(actual, upstream) {
  return upstream.some(
    (repository) =>
      actual === repository || actual === `${repository}.git` || actual.startsWith(`${repository}/`)
  );
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
        if (target.type !== 'image' && !scopes.some((scope) => scope.type === 'image'))
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
      definitions.set(target.identifier, target);
  }
  return definitions;
}

function assignReferenceRole(target, definitions) {
  if (target.actual !== undefined) return;
  const identifier = target.identifier ?? markdown.utils.normalizeReference(target.label ?? '');
  const definition = definitions.get(identifier);
  if (definition && !labelKind(definition.label) && labelKind(target.label))
    definition.label = target.label;
}

function resolvedTargets(targets) {
  const definitions = targetDefinitions(targets);
  for (const target of targets) assignReferenceRole(target, definitions);
  return targets
    .filter((target) => target.type !== 'definition' && target.actual !== undefined)
    .concat([...definitions.values()])
    .sort((a, b) => a.offset - b.offset);
}

function linkReferences(events, upstream) {
  return resolvedTargets(markdownTargets(events)).flatMap(({ actual, label, line }) => {
    const kind = labelKind(label) ?? destinationKind(actual);
    if ((kind === 'agents' && STANDARDS.has(actual)) || upstreamDestination(actual, upstream))
      return [];
    return kind ? [{ kind, actual, line }] : [];
  });
}

function cloneLineReferences(text, line, upstream) {
  const clone = parseSourceClone(text);
  if (!clone || clone.repository.substituted) return [];
  const { repository, branch } = clone;
  if (upstreamDestination(repository.value, upstream)) return [];
  const references = [{ kind: 'clone', actual: repository.value, line }];
  if (!branch?.substituted) references.push({ kind: 'branch', actual: branch?.value, line });
  return references;
}

function cloneReferences(events, upstream) {
  const references = [];
  let fenced = false;
  for (const [event, token, context] of events) {
    if (token.type === 'codeFenced') fenced = event === 'enter';
    if (event !== 'enter' || token.type !== 'codeFlowValue' || !fenced) continue;
    references.push(
      ...cloneLineReferences(context.sliceSerialize(token), token.start.line, upstream)
    );
  }
  return references;
}

/** Recognize the kit's source roles without depending on a document's headings or layout. */
export function sourceReferences(text, { upstreamRepositories = [] } = {}) {
  const events = postprocess(
    parse()
      .document()
      .write(preprocess()(text, undefined, true))
  );
  const upstream = [...UPSTREAM, ...upstreamRepositories];
  return [...linkReferences(events, upstream), ...cloneReferences(events, upstream)];
}

/** Compare hand-authored source destinations with the shared maintainer identity. */
export function sourceDrift(documents, { repository, branch }, options) {
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
    sourceReferences(text, options)
      .filter(({ kind, actual }) => actual !== expected[kind])
      .map(({ kind, actual, line }) => ({ file, line, actual, expected: expected[kind] }))
  );
}
