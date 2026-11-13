import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Share,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  DataDetectorTypes,
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { HOME_URL, USER_AGENT } from '../config';
import { AD_FILTER_SCRIPT } from '../injected/adFilterScript';
import { BIRD_LOGO_SCRIPT } from '../injected/birdLogoScript';
import { IMAGE_SAVE_SCRIPT } from '../injected/imageSaveScript';
import { SHARE_BRIDGE_SCRIPT } from '../injected/shareBridgeScript';
import { VIDEO_QUALITY_SCRIPT } from '../injected/videoQualityScript';
import { parseSaveImageMessage } from '../media/imageDownload';
import { promptToSaveImage } from '../media/saveImage';
import { classifyUrl, getWebHost, isTwitterUrl } from '../navigation/urlPolicy';
import { buildComposeUrl } from '../share/incomingShare';
import { buildShareContent, parseShareMessage } from '../share/outgoingShare';
import {
  ACCENT_COLOR,
  DARK_BACKGROUND,
  isDarkColor,
  LIGHT_BACKGROUND,
  parseThemeMessage,
} from '../theme/pageTheme';
import {
  buildSetVideoQualityScript,
  parseVideoQualityMessage,
  type VideoQuality,
} from '../video/videoQuality';
import { ErrorView } from './ErrorView';
import { UpdateBanner } from './UpdateBanner';
import { VideoQualitySheet } from './VideoQualitySheet';

// `WebView<P = undefined>` intersects its props with `P`. TypeScript 6 reduces
// that default to `never`, so the extra-props parameter is pinned explicitly.
type NoExtraProps = Record<never, never>;

// Platform-specific props must be passed in their native shape. Only the iOS
// wrapper normalizes shorthands such as `dataDetectorTypes="none"` or
// `decelerationRate="normal"`; on Android they reach the native prop parser
// unchanged, and a value of the wrong type crashes the app at startup.
const NO_DATA_DETECTORS: DataDetectorTypes[] = ['none'];
/** The value the iOS wrapper substitutes for `decelerationRate="normal"`. */
const NORMAL_DECELERATION_RATE = 0.998;

/**
 * Everything injected into the page. Each script is independent of the others,
 * but the order of the two long-press handlers matters: a press on a video is
 * claimed by the video script before the image script can read the video's
 * poster as a picture to save.
 */
const PAGE_SCRIPT = [
  AD_FILTER_SCRIPT,
  SHARE_BRIDGE_SCRIPT,
  VIDEO_QUALITY_SCRIPT,
  IMAGE_SAVE_SCRIPT,
  BIRD_LOGO_SCRIPT,
].join('\n');

const BIRD_LOGO = require('../../assets/bird.png');

// Every scheme is routed through `onShouldStartLoadWithRequest`. With the
// default whitelist, the WebView hands unknown schemes straight to the OS,
// which is how "open in app" links escape to the official client.
const ORIGIN_WHITELIST = ['*'];

/**
 * Consumes content another app shared into this one and returns the composer
 * link for it, or `null` when nothing usable was shared.
 */
function takeSharedComposeUrl(): string | null {
  try {
    const payloads = Sharing.getSharedPayloads();
    if (payloads.length === 0) {
      return null;
    }
    // Cleared so the same share is not replayed the next time the app resumes.
    Sharing.clearSharedPayloads();
    return buildComposeUrl(payloads);
  } catch {
    // Receiving shares is unavailable in this build (for example in Expo Go).
    return null;
  }
}

/**
 * Picks the first page to load: the composer for content shared into the app,
 * else the link that launched the app when it points at X, else the home timeline.
 */
function resolveInitialUrl(): string {
  const composeUrl = takeSharedComposeUrl();
  if (composeUrl) {
    return composeUrl;
  }
  const launchUrl = Linking.getLinkingURL();
  return launchUrl && isTwitterUrl(launchUrl) ? launchUrl : HOME_URL;
}

function buildNavigationScript(url: string): string {
  return `window.location.assign(${JSON.stringify(url)}); true;`;
}

function ignoreError(): void {
  // Opening a link is best-effort; there is nothing useful to surface.
}

/** The X web app, rendered full screen with ads and promoted content removed. */
export function TwitterWebView() {
  const webViewRef = useRef<WebView<NoExtraProps>>(null);
  const canGoBackRef = useRef(false);
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();

  const [pageBackground, setPageBackground] = useState<string | null>(null);
  // The video quality in effect while its picker is open, else `null`.
  const [videoQualityInEffect, setVideoQualityInEffect] = useState<VideoQuality | null>(null);
  // Bumped to remount the WebView after its render process is killed.
  const [webViewGeneration, setWebViewGeneration] = useState(0);
  const [initialUrl] = useState(resolveInitialUrl);

  const backgroundColor =
    pageBackground ?? (systemColorScheme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND);
  const isDark = isDarkColor(backgroundColor);

  // Read through a ref so link handlers stay stable across theme changes.
  const backgroundColorRef = useRef(backgroundColor);
  useEffect(() => {
    backgroundColorRef.current = backgroundColor;
  }, [backgroundColor]);

  const source = useMemo(() => ({ uri: initialUrl }), [initialUrl]);

  const navigateTo = useCallback((url: string) => {
    webViewRef.current?.injectJavaScript(buildNavigationScript(url));
  }, []);

  const openExternal = useCallback((url: string) => {
    WebBrowser.openBrowserAsync(url, {
      toolbarColor: backgroundColorRef.current,
      controlsColor: ACCENT_COLOR,
    }).catch(() => Linking.openURL(url).catch(ignoreError));
  }, []);

  /** Dispatches a URL to its destination. Returns true when the WebView should load it. */
  const routeUrl = useCallback(
    (url: string): boolean => {
      switch (classifyUrl(url)) {
        case 'internal':
          return true;
        case 'external':
          openExternal(url);
          return false;
        case 'system':
          Linking.openURL(url).catch(ignoreError);
          return false;
        case 'blocked':
          return false;
      }
    },
    [openExternal],
  );

  // Only navigations of the page itself are routed; embedded frames load
  // freely. Android reports top-level navigations only and leaves `isTopFrame`
  // unset, so a request counts as a frame's only when it says so explicitly.
  const handleShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean =>
      (request.isTopFrame as boolean | undefined) === false || routeUrl(request.url),
    [routeUrl],
  );

  // `target="_blank"` links and `window.open` calls. There is a single window,
  // so links that belong to X are loaded in place.
  const handleOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => {
      const { targetUrl } = event.nativeEvent;
      if (routeUrl(targetUrl) && getWebHost(targetUrl) !== null) {
        navigateTo(targetUrl);
      }
    },
    [navigateTo, routeUrl],
  );

  const handleNavigationStateChange = useCallback((state: WebViewNavigation) => {
    canGoBackRef.current = state.canGoBack;
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const { data } = event.nativeEvent;

    const reportedBackground = parseThemeMessage(data);
    if (reportedBackground) {
      setPageBackground(reportedBackground);
      return;
    }

    // The page asked to share something: hand it to the system share sheet.
    const shareRequest = parseShareMessage(data);
    const shareContent = shareRequest && buildShareContent(shareRequest);
    if (shareContent) {
      Share.share(shareContent, { dialogTitle: shareContent.title }).catch(ignoreError);
      return;
    }

    // The user long-pressed a video: offer the qualities to play videos at.
    const videoQuality = parseVideoQualityMessage(data);
    if (videoQuality) {
      setVideoQualityInEffect(videoQuality);
      return;
    }

    // The user long-pressed a picture: offer to save it to the gallery.
    const image = parseSaveImageMessage(data);
    if (image) {
      promptToSaveImage(image);
    }
  }, []);

  const closeVideoQualityPicker = useCallback(() => {
    setVideoQualityInEffect(null);
  }, []);

  const chooseVideoQuality = useCallback((quality: VideoQuality) => {
    webViewRef.current?.injectJavaScript(buildSetVideoQualityScript(quality));
    setVideoQualityInEffect(null);
  }, []);

  const reload = useCallback(() => {
    webViewRef.current?.reload();
  }, []);

  const remount = useCallback(() => {
    canGoBackRef.current = false;
    setWebViewGeneration((generation) => generation + 1);
  }, []);

  // Links opened while the app is already running.
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isTwitterUrl(url)) {
        navigateTo(url);
      }
    });
    return () => subscription.remove();
  }, [navigateTo]);

  // Content shared into the app while it is already running. The share brings
  // the app back to the foreground, which is when the payload becomes readable.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        return;
      }
      const composeUrl = takeSharedComposeUrl();
      if (composeUrl) {
        navigateTo(composeUrl);
      }
    });
    return () => subscription.remove();
  }, [navigateTo]);

  // The Android back button walks the web history before leaving the app.
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBackRef.current) {
        return false;
      }
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const renderLoading = useCallback(
    () => (
      <View style={[styles.overlay, { backgroundColor }]}>
        <Image accessibilityIgnoresInvertColors source={BIRD_LOGO} style={styles.logo} />
      </View>
    ),
    [backgroundColor],
  );

  const renderError = useCallback(
    (_domain: string | undefined, _code: number, description: string) => (
      <ErrorView
        backgroundColor={backgroundColor}
        description={description}
        isDark={isDark}
        onRetry={reload}
      />
    ),
    [backgroundColor, isDark, reload],
  );

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <UpdateBanner />
      {/* iOS resizes the web viewport for the keyboard itself; Android's
          edge-to-edge windows do not, so the view is padded manually there. */}
      <KeyboardAvoidingView
        behavior="padding"
        enabled={Platform.OS === 'android'}
        style={styles.fill}
      >
        <WebView<NoExtraProps>
          key={webViewGeneration}
          ref={webViewRef}
          source={source}
          style={[styles.fill, { backgroundColor }]}
          containerStyle={{ backgroundColor }}
          userAgent={USER_AGENT}
          originWhitelist={ORIGIN_WHITELIST}
          // The script is injected at document start and again after load. It
          // is idempotent, and the second pass covers Android, where the first
          // injection can race with the page's own scripts.
          injectedJavaScriptBeforeContentLoaded={PAGE_SCRIPT}
          injectedJavaScript={PAGE_SCRIPT}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onOpenWindow={handleOpenWindow}
          onNavigationStateChange={handleNavigationStateChange}
          onMessage={handleMessage}
          onContentProcessDidTerminate={reload}
          onRenderProcessGone={remount}
          startInLoadingState
          renderLoading={renderLoading}
          renderError={renderError}
          // Session persistence.
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          cacheEnabled
          // Media behaves like it does in the native client.
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          // Native-feeling navigation and scrolling.
          allowsBackForwardNavigationGestures
          allowsLinkPreview={false}
          decelerationRate={NORMAL_DECELERATION_RATE}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          dataDetectorTypes={NO_DATA_DETECTORS}
          textZoom={100}
          setBuiltInZoomControls={false}
          webviewDebuggingEnabled={__DEV__}
        />
      </KeyboardAvoidingView>
      <VideoQualitySheet
        backgroundColor={backgroundColor}
        current={videoQualityInEffect}
        isDark={isDark}
        onChoose={chooseVideoQuality}
        onClose={closeVideoQualityPicker}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    height: 72,
    resizeMode: 'contain',
    width: 72,
  },
});
