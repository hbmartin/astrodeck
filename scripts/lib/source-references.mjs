import { parse, postprocess, preprocess } from 'micromark';
import { parseSourceClone } from './source-clones.mjs';
import { markdownSourceTargets } from './source-reference-markdown.mjs';
import {
  knownSourceClone,
  sameSourceDestination,
  sourceReferencePolicy,
} from './source-reference-urls.mjs';

function cloneLineReferences(text, line, policy) {
  const clone = parseSourceClone(text);
  if (!clone || clone.repository.substituted) return [];
  const { repository, branch } = clone;
  if (!knownSourceClone(repository.value, policy)) return [];
  const references = [{ kinds: ['clone'], actual: repository.value, line }];
  if (!branch?.substituted) references.push({ kinds: ['branch'], actual: branch?.value, line });
  return references;
}

function cloneReferences(events, policy) {
  const references = [];
  let fenced = false;
  for (const [event, token, context] of events) {
    if (token.type === 'codeFenced') fenced = event === 'enter';
    if (event !== 'enter' || token.type !== 'codeFlowValue' || !fenced) continue;
    references.push(
      ...cloneLineReferences(context.sliceSerialize(token), token.start.line, policy)
    );
  }
  return references;
}

function sourceTargets(text, options) {
  const events = postprocess(
    parse()
      .document()
      .write(preprocess()(text, undefined, true))
  );
  const policy = sourceReferencePolicy(options);
  return [...markdownSourceTargets(events, policy), ...cloneReferences(events, policy)];
}

/** Recognize explicit source roles and destinations belonging to the supplied source identities. */
export function sourceReferences(text, options) {
  return sourceTargets(text, options).map(({ kinds, actual, line }) => ({
    kind: kinds.length > 1 ? 'conflict' : kinds[0],
    actual,
    line,
  }));
}

function expectedDestinations({ repository, branch }) {
  return {
    repository,
    branch,
    clone: `${repository}.git`,
    zip: `${repository}/archive/refs/heads/${branch}.zip`,
    registry: `${repository}/blob/${branch}/src/registry.json`,
    agents: `${repository}/blob/${branch}/AGENTS.md`,
    skills: `${repository}/tree/${branch}/.agents/skills`,
  };
}

function targetFinding({ kinds, actual, line }, file, expected) {
  if (kinds.length > 1) {
    const destinations = kinds.map((kind) => `${kind}: ${expected[kind]}`).join('; ');
    return [{ file, line, actual, expected: `separate source destinations (${destinations})` }];
  }
  const kind = kinds[0];
  const matches =
    kind === 'branch' ? actual === expected[kind] : sameSourceDestination(actual, expected[kind]);
  return matches ? [] : [{ file, line, actual, expected: expected[kind] }];
}

/** Compare hand-authored source destinations with the shared maintainer identity. */
export function sourceDrift(documents, identity, options = {}) {
  const expected = expectedDestinations(identity);
  const hints = {
    ...options,
    repository: identity.repository,
    formerRepositories: [
      ...(identity.formerRepositories ?? []),
      ...(options.formerRepositories ?? []),
    ],
  };
  return Object.entries(documents).flatMap(([file, text]) =>
    sourceTargets(text, hints).flatMap((target) => targetFinding(target, file, expected))
  );
}
