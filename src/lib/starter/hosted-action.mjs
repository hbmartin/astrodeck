import { URL } from 'node:url';

/**
 * @typedef {{status: 'ready', href: string}
 * | {status: 'unavailable', reason: 'not-configured' | 'invalid-configuration', href: string}}
 * HostedAction
 */

function approvedDestination(value, allowedOrigins) {
  if (!/^https:\/\//iu.test(value) || /[\\\s]/u.test(value)) return undefined;
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.username || url.password || !allowedOrigins.includes(url.origin)) return undefined;
  return url.href;
}

/**
 * Resolve a configured provider URL without appending visitor data.
 * Pass origins from project code, independently of the configured destination.
 * @param {string | undefined} value
 * @param {{allowedOrigins: readonly string[], fallbackHref: string}} options
 * @returns {HostedAction}
 */
export function resolveHostedAction(value, { allowedOrigins, fallbackHref }) {
  if (!/^\/(?!\/)[^\\\s?#]*$/u.test(fallbackHref)) {
    throw new Error('The fallback must be a site-relative path without a query or fragment.');
  }
  if (!value?.trim()) {
    return { status: 'unavailable', reason: 'not-configured', href: fallbackHref };
  }
  const href = approvedDestination(value, allowedOrigins);
  return href
    ? { status: 'ready', href }
    : { status: 'unavailable', reason: 'invalid-configuration', href: fallbackHref };
}

/**
 * @param {string | undefined} value
 * @param {{label: string, allowedOrigins: readonly string[], fallback: {href: string, label: string}}} config
 */
export function resolveHeaderCta(value, { label, allowedOrigins, fallback }) {
  const action = resolveHostedAction(value, { allowedOrigins, fallbackHref: fallback.href });
  if (action.status === 'ready') return { label, href: action.href, external: true };
  if (action.reason === 'invalid-configuration') {
    throw new Error('HOSTED_CTA_URL must be an HTTPS URL on an approved origin.');
  }
  return { ...fallback, external: false };
}
