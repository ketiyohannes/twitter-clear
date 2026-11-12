/**
 * Helpers for matching the native chrome (status bar, safe areas) to the theme
 * the X web app is currently rendering.
 *
 * Dependency-free so it can run under Node tests.
 */

export const LIGHT_BACKGROUND = '#FFFFFF';
export const DARK_BACKGROUND = '#000000';
export const ACCENT_COLOR = '#1D9BF0';

const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i;
const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

type RgbColor = readonly [red: number, green: number, blue: number];

function parseColor(color: string): RgbColor | null {
  const rgbMatch = RGB_PATTERN.exec(color.trim());
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const hexMatch = HEX_PATTERN.exec(color.trim());
  if (hexMatch) {
    const value = Number.parseInt(hexMatch[1], 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }
  return null;
}

/** True when `color` is a CSS color this module can interpret. */
export function isSupportedColor(color: string): boolean {
  return parseColor(color) !== null;
}

/**
 * Whether a background is dark enough to need light foreground content.
 * Uses the perceived-brightness weighting from ITU-R BT.601.
 */
export function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) {
    return false;
  }
  const [red, green, blue] = rgb;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 128;
}

/** Extracts the background color from a message posted by the injected script. */
export function parseThemeMessage(data: string): string | null {
  try {
    const message: unknown = JSON.parse(data);
    if (typeof message !== 'object' || message === null) {
      return null;
    }
    const { type, backgroundColor } = message as Record<string, unknown>;
    if (type !== 'theme' || typeof backgroundColor !== 'string') {
      return null;
    }
    return isSupportedColor(backgroundColor) ? backgroundColor : null;
  } catch {
    return null;
  }
}
