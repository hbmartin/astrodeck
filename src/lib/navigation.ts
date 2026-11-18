const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/';

/** Fragment links identify a location within a page, rather than the current page. */
export function navigationState(href: string, current: URL) {
  if (!/^\/(?![/\\])/.test(href) || href.includes('#')) return { exact: false, active: false };
  const path = normalizePath(current.pathname);
  const target = normalizePath(new URL(href, current).pathname);
  const exact = target === path;
  const descendant = target !== '/' && path.startsWith(target + '/');
  return { exact, active: exact || descendant };
}
