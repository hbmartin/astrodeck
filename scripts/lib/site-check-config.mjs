import { readFileSync } from 'node:fs';

export function readSiteChecks() {
  const config = JSON.parse(
    readFileSync(new URL('../../site-checks.json', import.meta.url), 'utf8')
  );
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Site checks configuration must be a JSON object.');
  }
  return config;
}

export function siteOrigin(value, { loopback = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Expected an absolute HTTPS origin.');
  }

  const local = loopback && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    ![url.origin, url.origin + '/'].includes(value)
  ) {
    throw new Error('Expected an HTTPS origin without a path, credentials, query, or fragment.');
  }
  return url;
}

export function sitePath(value, base) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\s?#]/u.test(value)) {
    throw new Error('Expected a site-relative pathname without a query or fragment.');
  }
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin || resolved.pathname !== value) {
    throw new Error('Expected a normalized same-origin pathname.');
  }
  return resolved;
}

export function list(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(name + ' must be a nonempty array.');
  }
  return value;
}
