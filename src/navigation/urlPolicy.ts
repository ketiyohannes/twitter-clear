/**
 * Decides where a navigation request is handled.
 *
 * - `internal`: stays inside the WebView (X itself and its sign-in providers).
 * - `external`: opens in the in-app browser, like links do in the official app.
 * - `system`: handed to the operating system (mail, phone, messages).
 * - `blocked`: dropped. This covers app-store and `twitter://` redirects that
 *   try to push the user out of the web app and into the official client.
 *
 * This module is intentionally dependency-free so it can run under Node tests.
 */
export type UrlDestination = 'internal' | 'external' | 'system' | 'blocked';

/** Hosts (and all of their subdomains) that render inside the WebView. */
const INTERNAL_HOSTS: readonly string[] = [
  'x.com',
  'twitter.com',
  // Sign-in providers must stay in the WebView so the session cookie lands here.
  'accounts.google.com',
  'appleid.apple.com',
  // Login challenge provider. Android reports frame navigations as top-level,
  // so its frames must not be mistaken for external links.
  'arkoselabs.com',
];

/** Non-web schemes the WebView resolves on its own. */
const INLINE_SCHEMES: readonly string[] = ['about', 'blob', 'data'];

/** Schemes delegated to the operating system. */
const SYSTEM_SCHEMES: readonly string[] = ['mailto', 'tel', 'sms'];

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
// Captures the host of an http(s) URL, skipping optional credentials and port.
// Backslashes end the authority like slashes do, matching how browsers parse
// URLs, so `https://evil.example\@x.com` resolves to `evil.example`.
const WEB_HOST_PATTERN = /^https?:\/\/(?:[^/\\?#@]*@)?([^/\\?#:@]+)/i;

function matchesHost(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

/** Returns the lower-cased host of an http(s) URL, or `null` for anything else. */
export function getWebHost(url: string): string | null {
  const match = WEB_HOST_PATTERN.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

export function classifyUrl(url: string): UrlDestination {
  const trimmedUrl = url.trim();
  const scheme = SCHEME_PATTERN.exec(trimmedUrl)?.[1].toLowerCase();
  if (!scheme) {
    return 'blocked';
  }
  if (INLINE_SCHEMES.includes(scheme)) {
    return 'internal';
  }
  if (SYSTEM_SCHEMES.includes(scheme)) {
    return 'system';
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return 'blocked';
  }

  const host = getWebHost(trimmedUrl);
  if (!host) {
    return 'blocked';
  }
  return INTERNAL_HOSTS.some((candidate) => matchesHost(host, candidate))
    ? 'internal'
    : 'external';
}

/** True for links that should load X content inside the WebView (deep links). */
export function isTwitterUrl(url: string): boolean {
  const host = getWebHost(url);
  return host !== null && (matchesHost(host, 'x.com') || matchesHost(host, 'twitter.com'));
}
