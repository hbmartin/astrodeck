/** Escapes HTML and renders `backticks` as inline code (entries share their text with CHANGELOG.md). */
export const inline = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /`([^`]+)`/g,
      '<code class="text-sm font-mono bg-muted px-1 py-0.5 rounded">$1</code>'
    );
