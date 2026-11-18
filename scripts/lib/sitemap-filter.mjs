/** Demo noindex routes are relative to Astro's configured base, not the host root. */
export function includeDemoPage(page, base) {
  const pathname = new URL(page).pathname.replace(/\/+$/u, '') || '/';
  const prefix = base.replace(/\/+$/u, '');
  if (prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return true;
  const route = pathname.slice(prefix.length) || '/';
  return !['/login', '/thanks'].includes(route);
}
