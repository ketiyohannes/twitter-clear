/**
 * Turns a picture reported by the page into the downloads that save it at full
 * quality.
 *
 * The page displays scaled-down, re-encoded copies. Each kind of picture has
 * its own address scheme for the original, so only the kinds listed here can
 * be saved.
 *
 * Dependency-free so it can run under Node tests.
 */

export type ImageSource = {
  /** Address the picture is downloaded from. */
  url: string;
  /** Name the picture is saved under, with the extension matching its format. */
  fileName: string;
};

/**
 * The places one picture can be downloaded from, best quality first. Later
 * entries are fallbacks for when an earlier one does not exist. Never empty.
 */
export type ImageDownload = ImageSource[];

const IMAGE_HOST = 'https://pbs.twimg.com';
const EXTENSION = 'jpe?g|png|webp';

// A posted picture: `/media/<id>?format=jpg&name=small`, or the older
// `/media/<id>.jpg:large`.
const MEDIA_PATTERN = new RegExp(
  `^${IMAGE_HOST}/media/([A-Za-z0-9_-]+)(?:\\.(${EXTENSION}))?(?::[a-z0-9]+)?(?:\\?([^#]*))?$`,
  'i',
);
const FORMAT_PARAMETER_PATTERN = new RegExp(`(?:^|&)format=(${EXTENSION})(?:&|$)`, 'i');

// A profile picture: `/profile_images/<account>/<name>_normal.jpg`. The size
// suffix is dropped to get the original.
const PROFILE_IMAGE_PATTERN = new RegExp(
  `^${IMAGE_HOST}/profile_images/(\\d+)/([A-Za-z0-9_-]+?)` +
    `(?:_(?:normal|bigger|mini|reasonably_small|x96|200x200|400x400))?\\.(${EXTENSION}|gif)$`,
  'i',
);

// A profile banner: `/profile_banners/<account>/<revision>/600x200`. Banners
// have no extension and are always JPEG; 1500x500 is their largest size.
const PROFILE_BANNER_PATTERN = new RegExp(`^${IMAGE_HOST}/profile_banners/(\\d+)/(\\d+)(?:/\\w+)?$`);

function normalizeExtension(extension: string): string {
  const lowerCase = extension.toLowerCase();
  return lowerCase === 'jpeg' ? 'jpg' : lowerCase;
}

function mediaSource(id: string, format: string, size: string): ImageSource {
  return { url: `${IMAGE_HOST}/media/${id}?format=${format}&name=${size}`, fileName: `${id}.${format}` };
}

/**
 * The uploaded original (`name=orig`) only exists in the format it was
 * uploaded in, JPEG or PNG, and the page does not say which: it usually shows
 * a WebP re-encoding. Both are tried, the more likely one first, before
 * settling for the largest JPEG copy, which always exists.
 */
function resolveMedia(id: string, displayedFormat: string): ImageDownload {
  const originalFormats = displayedFormat === 'png' ? ['png', 'jpg'] : ['jpg', 'png'];
  return [
    ...originalFormats.map((format) => mediaSource(id, format, 'orig')),
    mediaSource(id, 'jpg', '4096x4096'),
  ];
}

/** Returns how to download the full-quality version of a picture, or `null` if it cannot be saved. */
export function resolveImageDownload(url: string): ImageDownload | null {
  const media = MEDIA_PATTERN.exec(url);
  if (media) {
    const [, id, extension, query = ''] = media;
    return resolveMedia(
      id,
      normalizeExtension(FORMAT_PARAMETER_PATTERN.exec(query)?.[1] ?? extension ?? 'jpg'),
    );
  }

  const profileImage = PROFILE_IMAGE_PATTERN.exec(url);
  if (profileImage) {
    const [, account, name, extension] = profileImage;
    const fileName = `${name}.${normalizeExtension(extension)}`;
    const original = `${IMAGE_HOST}/profile_images/${account}/${name}.${extension}`;
    // The copy on screen is the fallback in case the original is gone.
    return url === original
      ? [{ url, fileName }]
      : [
          { url: original, fileName },
          { url, fileName },
        ];
  }

  const profileBanner = PROFILE_BANNER_PATTERN.exec(url);
  if (profileBanner) {
    const [, account, revision] = profileBanner;
    return [
      {
        url: `${IMAGE_HOST}/profile_banners/${account}/${revision}/1500x500`,
        fileName: `banner-${account}.jpg`,
      },
    ];
  }

  return null;
}

/** Extracts the picture to save from a message posted by the injected script. */
export function parseSaveImageMessage(data: string): ImageDownload | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const { type, url } = message as Record<string, unknown>;
  return type === 'saveImage' && typeof url === 'string' ? resolveImageDownload(url) : null;
}
