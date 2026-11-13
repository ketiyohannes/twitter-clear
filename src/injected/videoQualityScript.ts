/**
 * JavaScript injected into the X web app to play videos at a quality the user
 * chose, and to let them choose it by long-pressing a video.
 *
 * X streams a video as a set of renditions listed in a master playlist, and
 * its player switches between them by measured bandwidth. This script rewrites
 * the playlist before the player reads it so that only the chosen rendition is
 * left. It works below the player's interface, so it does not depend on which
 * controls the player happens to show.
 *
 * The choice is kept in the page's local storage: it has to be readable
 * synchronously, at the moment a playlist arrives.
 *
 * It is authored as a string because Hermes cannot return the source of a
 * compiled function, and it must stay ES2017-compatible and self-contained: it
 * runs inside the WebView, not in the React Native runtime.
 */
export const VIDEO_QUALITY_SCRIPT = String.raw`
(function () {
  'use strict';

  if (window.__twitterClearVideoQualityInstalled) {
    return;
  }
  window.__twitterClearVideoQualityInstalled = true;

  var STORAGE_KEY = 'twitterClear.videoQuality';
  var AUTOMATIC = 'auto';
  var HIGHEST = 'highest';
  var LOWEST = 'lowest';
  // Either a keyword or the height of a rendition, such as "720".
  var QUALITY_PATTERN = /^(?:auto|highest|lowest|[1-9]\d{2,3})$/;

  var PLAYLIST_URL_PATTERN = /^https:\/\/video\.twimg\.com\/[^?#]*\.m3u8(?:[?#]|$)/;
  var RENDITION_TAG = '#EXT-X-STREAM-INF:';
  var RESOLUTION_PATTERN = /[:,]RESOLUTION=(\d+)x(\d+)/;
  var BANDWIDTH_PATTERN = /[:,]BANDWIDTH=(\d+)/;
  // Where the page renders what floats above it: dialogs, menus, the media viewer.
  var OVERLAY_SELECTOR = '#layers, [role="dialog"], [aria-modal="true"], [role="menu"]';

  // ---------------------------------------------------------------------------
  // The chosen quality
  // ---------------------------------------------------------------------------

  function readQuality() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return stored && QUALITY_PATTERN.test(stored) ? stored : AUTOMATIC;
    } catch (error) {
      // Storage can be unavailable; the player then keeps choosing by itself.
      return AUTOMATIC;
    }
  }

  // Called by the app when the user picks a quality.
  window.__twitterClearSetVideoQuality = function (quality) {
    if (typeof quality !== 'string' || !QUALITY_PATTERN.test(quality)) {
      return;
    }
    try {
      if (quality === AUTOMATIC) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, quality);
      }
    } catch (error) {
      // Nothing to fall back to: the choice simply does not stick.
    }
  };

  // ---------------------------------------------------------------------------
  // Playlist rewriting
  // ---------------------------------------------------------------------------

  /**
   * Picks the rendition for a quality. A rendition is described by its height,
   * which for an upright video is its shorter side: "720p" is 1280x720 and
   * 720x1280 alike. A numeric quality selects the best rendition that does not
   * exceed it, or the smallest one when all of them do.
   */
  function chooseRendition(renditions, quality) {
    var chosen = null;
    for (var index = 0; index < renditions.length; index++) {
      var rendition = renditions[index];
      if (chosen === null) {
        chosen = rendition;
        continue;
      }
      var isLarger =
        rendition.height > chosen.height ||
        (rendition.height === chosen.height && rendition.bandwidth > chosen.bandwidth);
      if (quality === HIGHEST) {
        chosen = isLarger ? rendition : chosen;
      } else if (quality === LOWEST) {
        chosen = isLarger ? chosen : rendition;
      } else {
        var limit = Number(quality);
        var fits = rendition.height <= limit;
        var chosenFits = chosen.height <= limit;
        if (fits !== chosenFits) {
          chosen = fits ? rendition : chosen;
        } else {
          // Among those that fit, the largest; among those that do not, the smallest.
          chosen = isLarger === fits ? rendition : chosen;
        }
      }
    }
    return chosen;
  }

  /**
   * Returns a master playlist reduced to the rendition for the chosen quality,
   * or the input when there is nothing to choose from.
   */
  function rewritePlaylist(text, quality) {
    if (quality === AUTOMATIC || typeof text !== 'string' || text.indexOf(RENDITION_TAG) === -1) {
      return text;
    }
    var lines = text.split('\n');
    var renditions = [];
    for (var index = 0; index < lines.length; index++) {
      if (lines[index].indexOf(RENDITION_TAG) !== 0) {
        continue;
      }
      var resolution = RESOLUTION_PATTERN.exec(lines[index]);
      var bandwidth = BANDWIDTH_PATTERN.exec(lines[index]);
      if (!resolution) {
        // A rendition that cannot be compared: leave the playlist to the player.
        return text;
      }
      // The address of a rendition is the next line that is not a tag or blank.
      var addressIndex = index + 1;
      while (
        addressIndex < lines.length &&
        (lines[addressIndex].trim() === '' || lines[addressIndex].charAt(0) === '#')
      ) {
        addressIndex++;
      }
      if (addressIndex >= lines.length) {
        return text;
      }
      renditions.push({
        first: index,
        last: addressIndex,
        height: Math.min(Number(resolution[1]), Number(resolution[2])),
        bandwidth: bandwidth ? Number(bandwidth[1]) : 0,
      });
      index = addressIndex;
    }
    if (renditions.length < 2) {
      return text;
    }

    var chosen = chooseRendition(renditions, quality);
    var kept = [];
    var renditionIndex = 0;
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      while (renditionIndex < renditions.length && renditions[renditionIndex].last < lineIndex) {
        renditionIndex++;
      }
      var rendition = renditions[renditionIndex];
      var belongsToRendition =
        rendition !== undefined && lineIndex >= rendition.first && lineIndex <= rendition.last;
      if (!belongsToRendition || rendition === chosen) {
        kept.push(lines[lineIndex]);
      }
    }
    return kept.join('\n');
  }

  function isPlaylistUrl(url) {
    return typeof url === 'string' && PLAYLIST_URL_PATTERN.test(url);
  }

  function installXhrRewriter() {
    var prototype = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!prototype) {
      return;
    }
    var textDescriptor = Object.getOwnPropertyDescriptor(prototype, 'responseText');
    var responseDescriptor = Object.getOwnPropertyDescriptor(prototype, 'response');
    if (!textDescriptor || !textDescriptor.get || !responseDescriptor || !responseDescriptor.get) {
      return;
    }

    function attachRewriter(xhr) {
      var rawText;
      var rewrittenText;
      var rawBuffer;
      var rewrittenBuffer;

      function readRewrittenText() {
        var text = textDescriptor.get.call(xhr);
        if (xhr.readyState !== 4) {
          return text;
        }
        if (text !== rawText) {
          rawText = text;
          rewrittenText = rewritePlaylist(text, readQuality());
        }
        return rewrittenText;
      }

      Object.defineProperty(xhr, 'responseText', {
        configurable: true,
        get: readRewrittenText,
      });

      Object.defineProperty(xhr, 'response', {
        configurable: true,
        get: function () {
          var type = xhr.responseType;
          if (type === '' || type === 'text') {
            return readRewrittenText();
          }
          var response = responseDescriptor.get.call(xhr);
          if (type !== 'arraybuffer' || xhr.readyState !== 4 || !response) {
            return response;
          }
          if (response !== rawBuffer) {
            rawBuffer = response;
            var text = new TextDecoder().decode(response);
            var rewritten = rewritePlaylist(text, readQuality());
            rewrittenBuffer = rewritten === text ? response : new TextEncoder().encode(rewritten).buffer;
          }
          return rewrittenBuffer;
        },
      });
    }

    var originalOpen = prototype.open;
    prototype.open = function (method, url) {
      try {
        if (isPlaylistUrl(String(url)) && !this.__twitterClearPlaylist) {
          this.__twitterClearPlaylist = true;
          attachRewriter(this);
        }
      } catch (error) {
        // Never let the rewriter break a request.
      }
      return originalOpen.apply(this, arguments);
    };
  }

  function installFetchRewriter() {
    var originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') {
      return;
    }

    window.fetch = function (input) {
      var request = originalFetch.apply(this, arguments);
      var url = typeof input === 'string' ? input : input && (input.url || String(input));
      if (!isPlaylistUrl(url) || readQuality() === AUTOMATIC) {
        return request;
      }

      return request.then(function (response) {
        if (!response.ok) {
          return response;
        }
        return response
          .clone()
          .text()
          .then(function (text) {
            var rewritten = rewritePlaylist(text, readQuality());
            if (rewritten === text) {
              return response;
            }
            var replacement = new Response(rewritten, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            Object.defineProperty(replacement, 'url', { value: response.url });
            return replacement;
          })
          .catch(function () {
            return response;
          });
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Choosing by long press
  // ---------------------------------------------------------------------------

  function isUnderFinger(element, x, y) {
    var box = element.getBoundingClientRect();
    return (
      box.width > 0 && box.height > 0 && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    );
  }

  /**
   * Whether a long press landed on a video. The player stacks its controls
   * over the video and can exclude the video itself from hit testing, so the
   * video is found by position. A press on something floating above the page
   * only counts for a video inside that same overlay.
   */
  function pressedVideo(event) {
    var pressed = event.target && event.target.nodeType === 1 ? event.target : null;
    if (!pressed) {
      return false;
    }
    var overlay = typeof pressed.closest === 'function' ? pressed.closest(OVERLAY_SELECTOR) : null;
    var videos = (overlay || document).getElementsByTagName('video');
    for (var index = 0; index < videos.length; index++) {
      var video = videos[index];
      if (!overlay && video.closest(OVERLAY_SELECTOR)) {
        continue;
      }
      if (isUnderFinger(video, event.clientX, event.clientY)) {
        return true;
      }
    }
    return false;
  }

  function installLongPress() {
    document.addEventListener(
      'contextmenu',
      function (event) {
        var bridge = window.ReactNativeWebView;
        if (!bridge || !pressedVideo(event)) {
          return;
        }
        event.preventDefault();
        // A video's poster is a picture, and the press is not a request to save it.
        event.stopImmediatePropagation();
        bridge.postMessage(JSON.stringify({ type: 'videoQuality', quality: readQuality() }));
      },
      true
    );
  }

  function runSafely(task) {
    try {
      task();
    } catch (error) {
      // A failing part must not take down the page or the other parts.
    }
  }

  runSafely(installXhrRewriter);
  runSafely(installFetchRewriter);
  runSafely(installLongPress);
})();
true;
`;
