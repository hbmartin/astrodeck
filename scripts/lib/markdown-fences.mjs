function closesFence(line, marker, opener) {
  return marker[0] === opener[0] && marker.length >= opener.length && line.trim() === marker;
}

/** Identify Markdown fence delimiters and their contents by line. */
export function markdownFences(lines) {
  let opener;
  return lines.map((line) => {
    const marker = line.match(/^\s*([~]{3,}|[\x60]{3,})/)?.[1];
    if (!marker) return opener ? 'content' : undefined;
    if (!opener) {
      opener = marker;
      return 'delimiter';
    }
    if (!closesFence(line, marker, opener)) return 'content';
    opener = undefined;
    return 'delimiter';
  });
}
