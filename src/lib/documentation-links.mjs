import { parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';
import { sourceIdentity } from './source-identity.mjs';

const SOURCE = `${sourceIdentity.repository}/blob/${sourceIdentity.branch}/`;
const DESTINATIONS = new Set(['resourceDestinationString', 'definitionDestinationString']);

function absoluteDestination(value, source) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(value)) return value;
  const base = value.startsWith('/') ? SOURCE : new globalThis.URL(source, SOURCE);
  const destination = new globalThis.URL(value.replace(/^\//u, ''), base);
  if (!destination.href.startsWith(SOURCE)) {
    throw new Error(`Source link escapes the repository: ${source} → ${JSON.stringify(value)}`);
  }
  return destination.href;
}

function serializeDestination(value, literal) {
  const escaped = value.replaceAll('&', '&amp;').replaceAll('\\', '\\\\');
  return literal ? escaped : escaped.replace(/[()]/gu, '\\$&');
}

function destinationEdit(text, source, token, context, bom) {
  const decoded = decodeString(context.sliceSerialize(token));
  const value = absoluteDestination(decoded, source);
  if (value === decoded) return undefined;
  const start = token.start.offset + bom;
  return {
    start,
    end: token.end.offset + bom,
    value: serializeDestination(value, text[start - 1] === '<'),
  };
}

function applyEdits(text, edits) {
  let boundary = text.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > boundary) throw new Error('overlapping Markdown destinations');
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
    boundary = edit.start;
  }
  return text;
}

function* sourceDestinations(events) {
  let footnoteDefinition = false;
  for (const [kind, token, context] of events) {
    // CommonMark treats a footnote-shaped label as an ordinary definition. Preserve it
    // without enabling GFM or interpreting its prose as a repository destination.
    if (token.type === 'definition') {
      footnoteDefinition = kind === 'enter' && context.sliceSerialize(token).startsWith('[^');
    }
    if (kind === 'exit' && DESTINATIONS.has(token.type) && !footnoteDefinition) {
      yield [token, context];
    }
  }
}

/** Make repository-relative Markdown links usable outside their source file. */
export function absoluteSourceLinks(text, source) {
  const events = postprocess(
    parse()
      .document()
      .write(preprocess()(text, undefined, true))
  );
  // Micromark drops exactly one initial BOM from its offset accounting, not the source text.
  const bom = text.startsWith('\uFEFF') ? 1 : 0;
  const edits = [];
  for (const [token, context] of sourceDestinations(events)) {
    const edit = destinationEdit(text, source, token, context, bom);
    if (edit) edits.push(edit);
  }
  return applyEdits(text, edits);
}
