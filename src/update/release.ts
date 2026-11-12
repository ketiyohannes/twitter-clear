/**
 * Reads a GitHub release and decides whether it is an update for this install.
 *
 * Dependency-free so it can run under Node tests.
 */

export type AppRelease = {
  /** Version without the tag prefix, for example `1.2.0`. */
  version: string;
  /** Where the installable package for this release is downloaded from. */
  downloadUrl: string;
};

type Version = [major: number, minor: number, patch: number];

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const PACKAGE_NAME_PATTERN = /\.apk$/i;

function parseVersion(value: string): Version | null {
  const match = VERSION_PATTERN.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether `candidate` is a later version than `installed`. Unreadable versions never are. */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const candidateVersion = parseVersion(candidate);
  const installedVersion = parseVersion(installed);
  if (!candidateVersion || !installedVersion) {
    return false;
  }
  for (let index = 0; index < candidateVersion.length; index += 1) {
    if (candidateVersion[index] !== installedVersion[index]) {
      return candidateVersion[index] > installedVersion[index];
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts the published release described by a GitHub "latest release"
 * response, or `null` when it is not one this app can install.
 *
 * The package must be hosted under the given repository's releases, so a
 * tampered response cannot point the app at a download from somewhere else.
 */
export function parseRelease(payload: unknown, repository: string): AppRelease | null {
  if (!isRecord(payload) || payload.draft === true || payload.prerelease === true) {
    return null;
  }
  const version = typeof payload.tag_name === 'string' ? parseVersion(payload.tag_name) : null;
  if (!version || !Array.isArray(payload.assets)) {
    return null;
  }

  const downloadPrefix = `https://github.com/${repository}/releases/download/`;
  for (const asset of payload.assets) {
    if (!isRecord(asset)) {
      continue;
    }
    const { name, browser_download_url: downloadUrl } = asset;
    if (
      typeof name === 'string' &&
      PACKAGE_NAME_PATTERN.test(name) &&
      typeof downloadUrl === 'string' &&
      downloadUrl.startsWith(downloadPrefix)
    ) {
      return { version: version.join('.'), downloadUrl };
    }
  }
  return null;
}

/** Returns the release when it is newer than the installed version, else `null`. */
export function findUpdate(
  payload: unknown,
  repository: string,
  installedVersion: string,
): AppRelease | null {
  const release = parseRelease(payload, repository);
  return release && isNewerVersion(release.version, installedVersion) ? release : null;
}
