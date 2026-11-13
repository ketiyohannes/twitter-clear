# Twitter Clear

A React Native (Expo) client for X/Twitter that shows the regular X interface
with ads and promoted posts removed, and the classic Twitter bird in place of
the X logo. Nothing else is changed.

It renders the X web app (`https://x.com`) in a full-screen WebView and filters
promoted content before it reaches the screen. You sign in with your own
account; the session is stored in the WebView on your device.

## Install it

On Android, download the `.apk` from the
[latest release](https://github.com/ketiyohannes/twitter-clear/releases/latest)
and open it. Android asks once for permission to install apps from your browser.
After that the app keeps itself up to date (see [Updates](#updates)).

## Run it from source

```bash
npm install
npx expo run:android   # requires the Android SDK
npx expo run:ios       # requires Xcode
```

The app contains native modules that are not part of Expo Go, so it needs a
build of its own.

## How ads are removed

`src/injected/adFilterScript.ts` is injected into the page and works in two
layers:

1. **Network layer.** `XMLHttpRequest` and `fetch` are wrapped so responses from
   the X API (`/i/api/...`) are rewritten before the web app reads them. Any
   timeline entry that carries promoted metadata, or whose id marks it as
   promoted, is dropped. This covers promoted posts, promoted accounts in "Who
   to follow", and promoted trends. It does not depend on the interface language.
2. **DOM layer.** A `MutationObserver` hides any cell that still renders with an
   "Ad" or "Promoted" label. This is a fallback for requests issued before the
   network hooks were installed, and it only recognizes the English labels.

Organic content is never reordered or modified.

## The bird logo

`src/injected/birdLogoScript.ts` swaps the X logo for the classic Twitter bird
wherever the page draws it. The app icon, splash screen and loading screen use
the same bird, rendered into `assets/`.

The bird and the Twitter name are trademarks of X Corp. This project is not
affiliated with or endorsed by X Corp.

## Sharing

- **Out of the app.** Android's WebView lacks the Web Share API, so X hides its
  "share via" action there. `src/injected/shareBridgeScript.ts` provides the API
  and the app forwards each request to the system share sheet.
- **Into the app (Android).** The app registers as a share target for text and
  links through the `expo-sharing` plugin and opens the X composer with the
  shared content filled in. Shared images and videos are not supported: the web
  composer only accepts files the user picks by hand.

## Saving images

Long-press a picture to save it to the gallery. A WebView has no menu for
that, so `src/injected/imageSaveScript.ts` reports the picture under the finger
and the app downloads it. Posted pictures, profile pictures and banners are
saved in their original quality rather than the scaled-down copy on screen.
Videos and GIFs are not covered.

## Updates

The app is installed from a package file rather than a store, so it updates
itself from this repository's [releases](https://github.com/ketiyohannes/twitter-clear/releases)
(Android only):

1. At launch, and when reopened after a few hours, it asks GitHub for the latest
   release and compares its tag with the installed version.
2. When the release is newer, a bar at the top offers the update. Nothing is
   downloaded until you tap **Update**.
3. The app downloads the release's `.apk` and opens the Android installer. The
   first time, Android asks for permission to install apps from Twitter Clear.

Android only accepts an update signed with the same key as the installed app,
so a package from anyone else is rejected by the system. The repository the app
updates from is `RELEASE_REPOSITORY` in `src/config.ts`.

## Behavior

- Links to other websites open in an in-app browser, like in the official app.
- Redirects into the official app or the app stores are blocked.
- The status bar and safe areas follow the X theme (Default, Dim, Lights out).
- The Android back button and the iOS back swipe walk the X navigation history.
- On Android, `x.com` and `twitter.com` links can be opened with this app.

## Development

```bash
npm test            # unit tests (Node test runner + jsdom)
npm run typecheck   # TypeScript
npx expo lint       # ESLint
```

| Path | Purpose |
| --- | --- |
| `src/components/TwitterWebView.tsx` | The WebView screen and its native integration |
| `src/injected/adFilterScript.ts` | Ad filter injected into the page |
| `src/injected/birdLogoScript.ts` | Logo swap injected into the page |
| `src/injected/shareBridgeScript.ts` | Web Share API bridge injected into the page |
| `src/share/` | Converts shares to and from the system share sheet |
| `src/injected/imageSaveScript.ts` | Long-press detection injected into the page |
| `src/media/` | Downloads pictures into the gallery |
| `src/update/` | Finds, downloads and installs new releases |
| `src/navigation/urlPolicy.ts` | Decides where each navigation is handled |
| `scripts/release-android.sh` | Builds and publishes a release |
| `src/theme/pageTheme.ts` | Matches native chrome to the page theme |

## Releasing

1. Raise `version` and `android.versionCode` in `app.json`, then commit and push.
2. Run `scripts/release-android.sh --publish`. It builds the signed package,
   checks its signature and creates the GitHub release `v<version>` with the
   package attached. Without `--publish` it only builds into `dist/`.

Installed copies pick the release up the next time they check. The tag must be
`v` followed by the version, and the package must be a release asset.

The script needs the Android SDK, JDK 17, the [GitHub CLI](https://cli.github.com)
and a signing key, described by `~/.config/twitter-clear/signing.env`:

```bash
TWITTER_CLEAR_KEYSTORE="/path/to/release.keystore"
TWITTER_CLEAR_KEYSTORE_PASSWORD="..."
TWITTER_CLEAR_KEY_ALIAS="twitter-clear"
```

Keep the keystore private and backed up. Every release must be signed with the
same key; if it is lost, installed copies can no longer be updated and have to
be reinstalled. A fork needs its own key, package name and `RELEASE_REPOSITORY`.

## Limitations

- "Sign in with Google" is likely to fail: Google restricts sign-in inside
  embedded WebViews. Sign in with your username and password instead.
- X can change its API response shape or markup at any time. If ads reappear,
  the patterns at the top of `adFilterScript.ts` are the place to update.
- This is an unofficial client for personal use and is not affiliated with X.
