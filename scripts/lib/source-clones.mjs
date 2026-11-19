const LONG_FLAGS = new Set([
  'verbose',
  'quiet',
  'progress',
  'reject-shallow',
  'checkout',
  'bare',
  'mirror',
  'local',
  'hardlinks',
  'shared',
  'dissociate',
  'single-branch',
  'tags',
  'shallow-submodules',
  'also-filter-submodules',
  'remote-submodules',
  'sparse',
  'ipv4',
  'ipv6',
]);
const LONG_VALUES = new Set([
  'jobs',
  'template',
  'reference',
  'reference-if-able',
  'origin',
  'branch',
  'revision',
  'upload-pack',
  'depth',
  'shallow-since',
  'shallow-exclude',
  'separate-git-dir',
  'ref-format',
  'config',
  'server-option',
  'filter',
  'bundle-uri',
]);
const OPTIONAL_VALUES = new Set(['recurse-submodules', 'recursive']);
const SHORT_VALUES = new Map([
  ['j', 'jobs'],
  ['o', 'origin'],
  ['b', 'branch'],
  ['u', 'upload-pack'],
  ['c', 'config'],
]);

function piece(value, end, substituted = false) {
  return { value, end, substituted };
}

function parameter(source, index) {
  const remaining = source.slice(index);
  const match = remaining.match(
    /^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-]|\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])\})/u
  );
  if (match) return piece(match[0], index + match[0].length, true);
  if (/^\$[({]/u.test(remaining)) return undefined;
  return piece('$', index + 1);
}

function escaped(source, index, quoted) {
  const next = source[index + 1];
  if (next === undefined) return undefined;
  if (quoted && !['$', '`', '"', '\\'].includes(next)) return piece('\\', index + 1);
  return piece(next, index + 2);
}

function doubleQuoted(source, index) {
  const result = piece('', index + 1);
  while (result.end < source.length) {
    const character = source[result.end];
    if (character === '"') return { ...result, end: result.end + 1 };
    if (character === '`') return undefined;
    const next = quotedPiece(source, result.end);
    if (!next) return undefined;
    result.value += next.value;
    result.substituted ||= next.substituted;
    result.end = next.end;
  }
}

function quotedPiece(source, index) {
  if (source[index] === '\\') return escaped(source, index, true);
  if (source[index] === '$') return parameter(source, index);
  return piece(source[index], index + 1);
}

function wordPiece(source, index) {
  const character = source[index];
  if (character === '"') return doubleQuoted(source, index);
  if (character === "'") {
    const end = source.indexOf("'", index + 1);
    return end < 0 ? undefined : piece(source.slice(index + 1, end), end + 1);
  }
  if (character === '\\') return escaped(source, index, false);
  if (character === '$') return parameter(source, index);
  if (/[|&;<>()`]/u.test(character)) return undefined;
  return piece(character, index + 1);
}

function word(source, index) {
  const result = piece('', index);
  while (result.end < source.length && !/[ \t]/u.test(source[result.end])) {
    const next = wordPiece(source, result.end);
    if (!next) return undefined;
    result.value += next.value;
    result.substituted ||= next.substituted;
    result.end = next.end;
  }
  return result;
}

function shellWords(source) {
  const words = [];
  let index = 0;
  while (index < source.length) {
    if (/[ \t]/u.test(source[index])) {
      index++;
      continue;
    }
    if (source[index] === '#') break;
    const next = word(source, index);
    if (!next) return undefined;
    words.push(next);
    index = next.end;
  }
  return words;
}

function operand(token, value = token.value) {
  return {
    value,
    substituted: token.substituted || /\bYOUR_[A-Z0-9_]+\b/u.test(value),
  };
}

function optionValue(name, attached, token, next) {
  const value = attached === undefined ? next : { ...token, value: attached };
  if (!value || (attached === undefined && value.value.startsWith('-'))) return undefined;
  const result = { consumed: attached === undefined ? 2 : 1 };
  if (name === 'branch') result.branch = operand(value);
  return result;
}

function optionKind(name) {
  if (LONG_VALUES.has(name)) return 'value';
  if (OPTIONAL_VALUES.has(name)) return 'optional';
  if (LONG_FLAGS.has(name)) return 'flag';
}

function disabledOption(name, attached) {
  if (attached !== undefined) return undefined;
  return { consumed: 1, ...(name === 'branch' && { branch: null }) };
}

function longOption(token, next) {
  const match = token.value.match(/^--([^=]+)(?:=(.*))?$/u);
  if (!match) return undefined;
  const [, original, attached] = match;
  const name = original.replace(/^no-/u, '');
  const kind = optionKind(name);
  if (!kind) return undefined;
  if (name !== original) return disabledOption(name, attached);
  if (kind === 'value') return optionValue(name, attached, token, next);
  if (kind === 'optional' || attached === undefined) return { consumed: 1 };
}

function cloneOption(token, next) {
  if (token.value.startsWith('--')) return longOption(token, next);
  if (/^-[vqnls46]+$/u.test(token.value)) return { consumed: 1 };
  const name = SHORT_VALUES.get(token.value[1]);
  if (!name) return undefined;
  const attached = token.value.length > 2 ? token.value.slice(2) : undefined;
  return optionValue(name, attached, token, next);
}

function cloneArgument(token, next, state) {
  if (state.options && token.value === '--') {
    state.options = false;
    return 1;
  }
  if (!state.options || !token.value.startsWith('-')) {
    state.positional.push(token);
    return 1;
  }
  const option = cloneOption(token, next);
  if (!option) return 0;
  if ('branch' in option) state.branch = option.branch;
  return option.consumed;
}

function cloneOperands(words) {
  const state = { positional: [], options: true };
  for (let index = 2; index < words.length;) {
    const consumed = cloneArgument(words[index], words[index + 1], state);
    if (!consumed) return undefined;
    index += consumed;
  }
  const { positional, branch } = state;
  if (positional.length < 1 || positional.length > 2) return undefined;
  return { repository: operand(positional[0]), ...(branch && { branch }) };
}

/** Read one documented git clone command without evaluating shell expressions. */
export function parseSourceClone(line) {
  if (/[\r\n]/u.test(line)) return undefined;
  const source = line.trimStart().replace(/^\$ /u, '');
  const words = shellWords(source);
  if (words?.[0]?.value !== 'git' || words[1]?.value !== 'clone') return undefined;
  return cloneOperands(words);
}
