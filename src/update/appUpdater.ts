/**
 * Finds, downloads and installs new releases of the app.
 *
 * Releases are published on GitHub. The app is installed from a package file
 * rather than a store, so it updates itself: it downloads the package of the
 * latest release and hands it to the Android package installer. Android only
 * accepts the package when it is signed with the same key as the installed app.
 */
import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

import { RELEASE_REPOSITORY } from '../config';
import { findUpdate, type AppRelease } from './release';

const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const CHECK_TIMEOUT_MS = 15_000;

const VIEW_ACTION = 'android.intent.action.VIEW';
const PACKAGE_MIME_TYPE = 'application/vnd.android.package-archive';
/** `Intent.FLAG_GRANT_READ_URI_PERMISSION`: lets the installer read the package. */
const GRANT_READ_PERMISSION_FLAG = 1;

function getDownloadDirectory(): Directory {
  return new Directory(Paths.cache, 'updates');
}

/** Removes packages left behind by earlier updates. */
export function discardDownloadedUpdates(): void {
  const directory = getDownloadDirectory();
  if (directory.exists) {
    directory.delete();
  }
}

/**
 * Returns the latest release when it is newer than this install, else `null`.
 * Rejects when the release information cannot be fetched.
 */
export async function fetchAvailableUpdate(): Promise<AppRelease | null> {
  const installedVersion = Application.nativeApplicationVersion;
  if (!installedVersion) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      // Includes "no release published yet" and API rate limiting.
      return null;
    }
    return findUpdate(await response.json(), RELEASE_REPOSITORY, installedVersion);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Downloads the package of a release and returns the link the package
 * installer opens it with. `onProgress` receives the completed percentage, or
 * `null` while the total size is unknown.
 */
export async function downloadUpdate(
  release: AppRelease,
  onProgress: (percent: number | null) => void,
  signal: AbortSignal,
): Promise<string> {
  discardDownloadedUpdates();
  const directory = getDownloadDirectory();
  directory.create({ intermediates: true });

  const file = await File.downloadFileAsync(
    release.downloadUrl,
    new File(directory, `TwitterClear-${release.version}.apk`),
    {
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        onProgress(totalBytes > 0 ? Math.floor((bytesWritten / totalBytes) * 100) : null);
      },
    },
  );
  return file.contentUri;
}

/**
 * Opens the Android package installer for a downloaded package. Resolves when
 * the user returns to the app; a successful install replaces the app instead.
 */
export async function installUpdate(packageUri: string): Promise<void> {
  await IntentLauncher.startActivityAsync(VIEW_ACTION, {
    data: packageUri,
    type: PACKAGE_MIME_TYPE,
    flags: GRANT_READ_PERMISSION_FLAG,
  });
}
