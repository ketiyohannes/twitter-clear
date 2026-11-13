/**
 * The video quality the user can pin playback to, and the messages exchanged
 * with the injected video quality script.
 *
 * Dependency-free so it can run under Node tests.
 */

/** `auto`, `highest`, `lowest`, or the height of a rendition such as `720`. */
export type VideoQuality = string;

export type VideoQualityOption = {
  value: VideoQuality;
  label: string;
  /** What the option means, where the label alone does not say. */
  hint?: string;
};

export const AUTOMATIC_QUALITY: VideoQuality = 'auto';

export const VIDEO_QUALITY_OPTIONS: readonly VideoQualityOption[] = [
  { value: AUTOMATIC_QUALITY, label: 'Auto', hint: 'Adjusts to your connection' },
  { value: 'highest', label: 'Highest', hint: 'The best each video offers' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'lowest', label: 'Lowest', hint: 'Uses the least data' },
];

// Must accept exactly what the injected script accepts.
const QUALITY_PATTERN = /^(?:auto|highest|lowest|[1-9]\d{2,3})$/;

export function isVideoQuality(value: unknown): value is VideoQuality {
  return typeof value === 'string' && QUALITY_PATTERN.test(value);
}

/**
 * Reads the quality currently in effect from the message the page posts when
 * a video is long-pressed, or returns `null` for any other message.
 */
export function parseVideoQualityMessage(data: string): VideoQuality | null {
  try {
    const message: unknown = JSON.parse(data);
    if (typeof message !== 'object' || message === null) {
      return null;
    }
    const { type, quality } = message as Record<string, unknown>;
    if (type !== 'videoQuality') {
      return null;
    }
    return isVideoQuality(quality) ? quality : AUTOMATIC_QUALITY;
  } catch {
    return null;
  }
}

/** The script that makes the page play videos at `quality` from now on. */
export function buildSetVideoQualityScript(quality: VideoQuality): string {
  if (!isVideoQuality(quality)) {
    throw new Error(`Not a video quality: ${quality}`);
  }
  return `window.__twitterClearSetVideoQuality && window.__twitterClearSetVideoQuality(${JSON.stringify(quality)}); true;`;
}
