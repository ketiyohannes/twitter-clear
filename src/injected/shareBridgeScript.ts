/**
 * JavaScript injected into the X web app to provide the Web Share API.
 *
 * Android's WebView does not implement `navigator.share`, so the web app hides
 * its "share via" action there. This script supplies the API and forwards each
 * request to React Native, which opens the system share sheet.
 *
 * It is authored as a string because Hermes cannot return the source of a
 * compiled function, and it must stay ES2017-compatible and self-contained: it
 * runs inside the WebView, not in the React Native runtime.
 */
export const SHARE_BRIDGE_SCRIPT = String.raw`
(function () {
  'use strict';

  if (window.__twitterClearShareInstalled) {
    return;
  }
  window.__twitterClearShareInstalled = true;

  // Keep a real implementation where the platform has one.
  if (typeof navigator.share === 'function') {
    return;
  }

  function toText(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function hasFiles(data) {
    return Boolean(data && data.files && data.files.length > 0);
  }

  function rejectWith(name, message) {
    return Promise.reject(new DOMException(message, name));
  }

  function share(data) {
    var bridge = window.ReactNativeWebView;
    if (!bridge) {
      return rejectWith('NotAllowedError', 'Sharing is unavailable.');
    }
    if (hasFiles(data)) {
      return rejectWith('NotAllowedError', 'Sharing files is not supported.');
    }

    var title = toText(data && data.title);
    var text = toText(data && data.text);
    var url = toText(data && data.url);
    if (url) {
      try {
        // The API accepts relative URLs and resolves them against the page.
        url = new URL(url, document.baseURI).href;
      } catch (error) {
        return Promise.reject(new TypeError('The URL to share is invalid.'));
      }
    }
    if (!title && !text && !url) {
      return Promise.reject(new TypeError('There is nothing to share.'));
    }

    bridge.postMessage(JSON.stringify({ type: 'share', title: title, text: text, url: url }));
    return Promise.resolve();
  }

  function canShare(data) {
    return !hasFiles(data);
  }

  try {
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      writable: true,
      value: canShare,
    });
  } catch (error) {
    // Without the API the page simply keeps its "copy link" action.
  }
})();
true;
`;
