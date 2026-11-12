/**
 * Turns a share request posted by the page into content for the system share
 * sheet.
 *
 * Dependency-free so it can run under Node tests.
 */

export type ShareRequest = {
  title: string;
  text: string;
  url: string;
};

export type ShareContent = {
  /** The text handed to the receiving app; includes the link. */
  message: string;
  /** Shown as the sheet title and used as the subject by mail apps. */
  title?: string;
};

// Far above anything the page shares; guards the native bridge against abuse.
const MAX_FIELD_LENGTH = 4000;
const WEB_URL_PATTERN = /^https?:\/\//i;

function readField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim().slice(0, MAX_FIELD_LENGTH) : '';
}

/** Extracts a share request from a message posted by the injected script. */
export function parseShareMessage(data: string): ShareRequest | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const fields = message as Record<string, unknown>;
  if (fields.type !== 'share') {
    return null;
  }

  const url = readField(fields, 'url');
  const request: ShareRequest = {
    title: readField(fields, 'title'),
    text: readField(fields, 'text'),
    // Only web links are shareable; anything else is dropped rather than passed on.
    url: WEB_URL_PATTERN.test(url) ? url : '',
  };
  return request.title || request.text || request.url ? request : null;
}

/** Builds the share sheet content, or `null` when there is nothing to share. */
export function buildShareContent(request: ShareRequest): ShareContent | null {
  const { title, text, url } = request;
  // Android has no separate link field, so the link travels in the message.
  const parts = text.includes(url) ? [text] : [text, url];
  const message = parts.filter((part) => part !== '').join('\n') || title;
  if (!message) {
    return null;
  }
  return title && title !== message ? { message, title } : { message };
}
