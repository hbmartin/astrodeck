import { parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';

const SOURCE = 'https://github.com/hbmartin/astrodeck/blob/main/';
const DESTINATIONS = new Set(['resourceDestinationString', 'definitionDestinationString']);

function absoluteDestination(value, source) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(value)) return value;
  const base = value.startsWith('/') ? SOURCE : new globalThis.URL(source, SOURCE);
  return new globalThis.URL(value.replace(/^\//u, ''), base).href;
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
  for (const [kind, token, context] of events) {
    if (kind !== 'exit' || !DESTINATIONS.has(token.type)) continue;
    const edit = destinationEdit(text, source, token, context, bom);
    if (edit) edits.push(edit);
  }
  return applyEdits(text, edits);
}
