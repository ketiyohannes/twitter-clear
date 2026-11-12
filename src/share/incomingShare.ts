/**
 * Turns content shared into the app by another app into a link that opens the
 * X composer with that content filled in.
 *
 * Dependency-free so it can run under Node tests.
 */

/** The subset of a shared payload this module relies on. */
export type IncomingSharePayload = {
  value: string;
  shareType: string;
};

const COMPOSE_URL = 'https://x.com/intent/post';
// Keeps the composer link within what browsers and servers accept.
const MAX_TEXT_LENGTH = 4000;
const WEB_URL_PATTERN = /^https?:\/\/\S+$/i;

/**
 * Returns the composer link for the shared payloads, or `null` when they carry
 * nothing the web composer can accept. Only text and links are supported;
 * shared files are ignored because the web composer cannot be handed a file.
 */
export function buildComposeUrl(payloads: readonly IncomingSharePayload[]): string | null {
  let url = '';
  const texts: string[] = [];

  for (const payload of payloads) {
    if (payload.shareType !== 'text' && payload.shareType !== 'url') {
      continue;
    }
    const value = payload.value.trim();
    if (value === '') {
      continue;
    }
    // Browsers share a page as plain text holding just its address.
    if (url === '' && WEB_URL_PATTERN.test(value)) {
      url = value;
    } else if (value !== url) {
      texts.push(value);
    }
  }

  const text = texts.join('\n').slice(0, MAX_TEXT_LENGTH);
  const parameters: string[] = [];
  if (text !== '') {
    parameters.push(`text=${encodeURIComponent(text)}`);
  }
  if (url !== '') {
    parameters.push(`url=${encodeURIComponent(url)}`);
  }
  return parameters.length > 0 ? `${COMPOSE_URL}?${parameters.join('&')}` : null;
}
