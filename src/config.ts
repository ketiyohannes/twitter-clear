import { Platform } from 'react-native';

/** Entry point of the X web app. */
export const HOME_URL = 'https://x.com/home';

/**
 * The GitHub repository (`owner/name`) whose releases the app updates itself
 * from. Each release must carry the Android package (`.apk`) as an asset and
 * be tagged with its version, for example `v1.2.0`.
 */
export const RELEASE_REPOSITORY = 'ketiyohannes/twitter-clear';

/**
 * Standard mobile browser user agents.
 *
 * The default WebView user agent identifies itself as an embedded view, which
 * makes X serve "open in app" prompts and makes some sign-in providers refuse
 * to load. Presenting as the platform browser yields the regular mobile site.
 */
const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

export const USER_AGENT = Platform.OS === 'ios' ? IOS_USER_AGENT : ANDROID_USER_AGENT;
