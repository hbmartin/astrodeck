import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt();
const { parseLinkDestination, parseLinkTitle } = markdown.helpers;
const SOURCE = 'https://github.com/hbmartin/astrodeck/blob/main/';

function absoluteDestination(value, source) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(value)) return value;
  const base = value.startsWith('/') ? SOURCE : new globalThis.URL(source, SOURCE);
  return new globalThis.URL(value.replace(/^\//u, ''), base).href;
}

function codeEnd(line, start, marker) {
  let next = start + marker.length;
  for (;;) {
    const end = line.indexOf(marker, next);
    if (end === -1) return next;
    next = end + marker.length;
    if (line[end - 1] !== '`' && line[next] !== '`') return next;
  }
}

function linkCloses(line, end) {
  let position = end;
  while (/[\t ]/u.test(line[position] ?? '')) position++;
  if (line[position] === ')') return true;
  const title = parseLinkTitle(line, position, line.length);
  if (!title.ok) return false;
  return /^[\t ]*\)/u.test(line.slice(title.pos));
}

function replacement(line, start, source, inline) {
  const destination = parseLinkDestination(line, start, line.length);
  if (!destination.ok || (inline && !linkCloses(line, destination.pos))) return undefined;
  const value = absoluteDestination(destination.str, source);
  if (value === destination.str) return undefined;
  return {
    start,
    end: destination.pos,
    value: line[start] === '<' ? `<${value}>` : value,
  };
}

function rewriteLine(line, source) {
  const changes = [];
  const definition = line.match(/^ {0,3}\[[^\]]+\]:[\t ]*/u);
  if (definition) {
    const change = replacement(line, definition[0].length, source, false);
    if (change) changes.push(change);
  }
  const markers = /(`+)|\]\([\t ]*/gu;
  for (let match; (match = markers.exec(line));) {
    if (match[1]) {
      markers.lastIndex = codeEnd(line, match.index, match[1]);
      continue;
    }
    const change = replacement(line, markers.lastIndex, source, true);
    if (change) changes.push(change);
  }
  for (const change of changes.reverse())
    line = line.slice(0, change.start) + change.value + line.slice(change.end);
  return line;
}

function codeLines(text) {
  const lines = new Set();
  for (const token of markdown.parse(text, {})) {
    if (!['fence', 'code_block'].includes(token.type)) continue;
    for (let line = token.map[0]; line < token.map[1]; line++) lines.add(line);
  }
  return lines;
}

/** Make repository-relative Markdown links usable outside their source file. */
export function absoluteSourceLinks(text, source) {
  const fences = codeLines(text);
  return text
    .split('\n')
    .map((line, index) => (fences.has(index) ? line : rewriteLine(line, source)))
    .join('\n');
}
