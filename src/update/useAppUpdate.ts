import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import {
  discardDownloadedUpdates,
  downloadUpdate,
  fetchAvailableUpdate,
  installUpdate,
} from './appUpdater';
import type { AppRelease } from './release';

export type UpdateState =
  | { status: 'none' }
  | { status: 'available'; release: AppRelease }
  | { status: 'downloading'; release: AppRelease; percent: number | null }
  | { status: 'downloaded'; release: AppRelease; packageUri: string }
  | { status: 'failed'; release: AppRelease };

export type AppUpdate = {
  state: UpdateState;
  /** Downloads the update and opens the installer, or reopens it once downloaded. */
  startUpdate: () => void;
  /** Hides the update, cancelling a download in progress, until the app restarts. */
  dismiss: () => void;
};

const NO_UPDATE: UpdateState = { status: 'none' };
/** How often a long-running app looks for a new release when it is reopened. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Updates are installed from a package file, which only Android allows. A
// development build is signed with a different key, so no release can replace it.
const IS_SUPPORTED = Platform.OS === 'android' && !__DEV__;

/** Looks for a newer release at launch and when the app is reopened, and installs it on request. */
export function useAppUpdate(): AppUpdate {
  const [state, setState] = useState<UpdateState>(NO_UPDATE);
  // Mirrors `state` so handlers always act on the latest value, including
  // between two taps that land before the next render.
  const stateRef = useRef<UpdateState>(NO_UPDATE);
  const downloadRef = useRef<AbortController | null>(null);
  const dismissedVersionRef = useRef<string | null>(null);
  const lastCheckRef = useRef(0);

  const transition = useCallback((next: UpdateState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const check = useCallback(async () => {
    const now = Date.now();
    if (stateRef.current.status !== 'none' || now - lastCheckRef.current < CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckRef.current = now;

    let release: AppRelease | null;
    try {
      release = await fetchAvailableUpdate();
    } catch {
      // Offline or the request timed out: try again the next time the app opens.
      lastCheckRef.current = 0;
      return;
    }
    if (stateRef.current.status !== 'none') {
      return;
    }
    if (!release) {
      try {
        discardDownloadedUpdates();
      } catch {
        // Leftover packages live in the cache, which the system clears itself.
      }
      return;
    }
    if (release.version !== dismissedVersionRef.current) {
      transition({ status: 'available', release });
    }
  }, [transition]);

  useEffect(() => {
    if (!IS_SUPPORTED) {
      return undefined;
    }
    void check();
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') {
        void check();
      }
    });
    return () => subscription.remove();
  }, [check]);

  const openInstaller = useCallback(
    async (release: AppRelease, packageUri: string) => {
      try {
        await installUpdate(packageUri);
      } catch {
        transition({ status: 'failed', release });
      }
    },
    [transition],
  );

  const startUpdate = useCallback(() => {
    const current = stateRef.current;
    if (current.status === 'downloaded') {
      void openInstaller(current.release, current.packageUri);
      return;
    }
    if (current.status !== 'available' && current.status !== 'failed') {
      return;
    }

    const { release } = current;
    const download = new AbortController();
    downloadRef.current = download;
    transition({ status: 'downloading', release, percent: null });

    const reportProgress = (percent: number | null) => {
      const latest = stateRef.current;
      if (!download.signal.aborted && latest.status === 'downloading' && latest.percent !== percent) {
        transition({ status: 'downloading', release, percent });
      }
    };

    downloadUpdate(release, reportProgress, download.signal).then(
      (packageUri) => {
        if (download.signal.aborted) {
          return;
        }
        transition({ status: 'downloaded', release, packageUri });
        void openInstaller(release, packageUri);
      },
      () => {
        if (!download.signal.aborted) {
          transition({ status: 'failed', release });
        }
      },
    );
  }, [openInstaller, transition]);

  const dismiss = useCallback(() => {
    const current = stateRef.current;
    if (current.status === 'none') {
      return;
    }
    downloadRef.current?.abort();
    downloadRef.current = null;
    dismissedVersionRef.current = current.release.version;
    transition(NO_UPDATE);
  }, [transition]);

  return { state, startUpdate, dismiss };
}
