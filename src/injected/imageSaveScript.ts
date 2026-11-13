/**
 * JavaScript injected into the X web app to offer saving a picture when it is
 * long-pressed.
 *
 * A browser shows its own menu for that; a WebView shows nothing. A long press
 * raises a `contextmenu` event, so this script reports the picture under the
 * finger to React Native, which downloads it into the device's gallery.
 *
 * It is authored as a string because Hermes cannot return the source of a
 * compiled function, and it must stay ES2017-compatible and self-contained: it
 * runs inside the WebView, not in the React Native runtime.
 */
export const IMAGE_SAVE_SCRIPT = String.raw`
(function () {
  'use strict';

  if (window.__twitterClearImageSaveInstalled) {
    return;
  }
  window.__twitterClearImageSaveInstalled = true;

  // Pictures posted to X, profile pictures and banners are all served from here.
  var IMAGE_URL_PATTERN = /^https:\/\/pbs\.twimg\.com\//;
  var BACKGROUND_URL_PATTERN = /url\(["']?(https:\/\/pbs\.twimg\.com\/[^"')]+)["']?\)/;
  // Where the page renders what floats above it: dialogs, menus, the photo viewer.
  var OVERLAY_SELECTOR = '#layers, [role="dialog"], [aria-modal="true"], [role="menu"]';

  function imageUrlOf(element) {
    if (element.tagName === 'IMG') {
      var source = element.currentSrc || element.src || '';
      return IMAGE_URL_PATTERN.test(source) ? source : null;
    }
    // Some pictures are drawn as the background of a plain element.
    var background = window.getComputedStyle(element).backgroundImage || '';
    var match = BACKGROUND_URL_PATTERN.exec(background);
    return match ? match[1] : null;
  }

  // The page can cover a picture with a link and exclude the picture itself
  // from hit testing. Such a picture is found by position instead, but only
  // inside the post that was pressed, so that pressing a dialog never offers a
  // picture that merely lies behind it. The smallest match is the most specific.
  function findCoveredImageUrl(pressed, x, y) {
    var post = typeof pressed.closest === 'function' ? pressed.closest('article') : null;
    if (!post) {
      return null;
    }
    var images = post.querySelectorAll('img');
    var found = null;
    var foundArea = Infinity;
    for (var index = 0; index < images.length; index += 1) {
      var url = imageUrlOf(images[index]);
      var box = images[index].getBoundingClientRect();
      var area = box.width * box.height;
      var isUnderFinger = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      if (url && isUnderFinger && area > 0 && area < foundArea) {
        found = url;
        foundArea = area;
      }
    }
    return found;
  }

  // The page stacks transparent layers over its pictures, and keeps the actual
  // image element underneath, so every element under the finger is considered.
  // When the press lands on something floating above the page, only that
  // overlay is searched: a picture behind a dialog is not what was pressed.
  function findImageUrl(event) {
    var elements =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(event.clientX, event.clientY)
        : [];
    if (elements.length === 0 && event.target && event.target.nodeType === 1) {
      elements = [event.target];
    }
    if (elements.length === 0) {
      return null;
    }

    var pressed = elements[0];
    var overlay = typeof pressed.closest === 'function' ? pressed.closest(OVERLAY_SELECTOR) : null;
    for (var index = 0; index < elements.length; index += 1) {
      if (overlay && !overlay.contains(elements[index])) {
        continue;
      }
      var url = imageUrlOf(elements[index]);
      if (url) {
        return url;
      }
    }
    return findCoveredImageUrl(pressed, event.clientX, event.clientY);
  }

  document.addEventListener(
    'contextmenu',
    function (event) {
      var bridge = window.ReactNativeWebView;
      if (!bridge) {
        return;
      }
      var url = findImageUrl(event);
      if (!url) {
        return;
      }
      event.preventDefault();
      bridge.postMessage(JSON.stringify({ type: 'saveImage', url: url }));
    },
    true
  );
})();
true;
`;
