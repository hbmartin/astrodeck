import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, readSiteChecks, siteOrigin, sitePath } from './lib/site-check-config.mjs';

function checkLocation(response, url, location) {
  if (location === undefined) return;
  const expected = sitePath(location, url);
  const actual = response.headers.get('location');
  if (!actual || new URL(actual, url).href !== expected.href) {
    throw new Error('redirect does not match expected same-origin Location');
  }
}

function checkHeaders(response, headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('headerIncludes must map header names to nonempty strings');
  }
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string' || !value.trim())
      throw new Error('expected a nonempty value for header ' + name);
    if (!response.headers.get(name)?.includes(value))
      throw new Error('response is missing expected ' + name + ' value');
  }
}

function bodyMarker(item) {
  if (!Number.isInteger(item.status) || item.status < 200 || item.status > 599) {
    throw new Error('set a valid expected HTTP status');
  }
  const marker = item.bodyIncludes;
  if (marker !== undefined && (typeof marker !== 'string' || !marker.trim())) {
    throw new Error('bodyIncludes must be a nonempty string');
  }
  return marker;
}

async function assertResponse(response, url, item, marker) {
  if (response.status !== item.status) {
    throw new Error('expected status ' + item.status + ', got ' + response.status);
  }
  checkLocation(response, url, item.location);
  checkHeaders(response, item.headerIncludes ?? {});
  if (marker !== undefined && !(await response.text()).includes(marker)) {
    throw new Error('response is missing the expected page marker');
  }
}

async function checkResponse(base, item) {
  const url = sitePath(item.path, base);
  const marker = bodyMarker(item);
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  try {
    await assertResponse(response, url, item, marker);
  } finally {
    if (!response.bodyUsed) await response.body?.cancel();
  }
}

export async function checkHost(value, responses, log = console.log) {
  const base = siteOrigin(value, { loopback: true });
  let failures = 0;
  for (const item of list(responses, 'responses')) {
    const pathname = item?.path ?? '(missing path)';
    try {
      await checkResponse(base, item);
      log('PASS ' + pathname + ' (' + item.status + ')');
    } catch (error) {
      failures++;
      log('FAIL ' + pathname + ': ' + error.message);
    }
  }
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await checkHost(process.argv[2], readSiteChecks().responses);
  } catch (error) {
    console.error('Hosted smoke check: ' + error.message);
    process.exitCode = 1;
  }
}
