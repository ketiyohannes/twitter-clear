/**
 * JavaScript injected into the X web app to remove ads and promoted content.
 *
 * It is authored as a string (not a function serialized with `toString()`)
 * because Hermes compiles functions to bytecode and cannot return their source.
 *
 * Two independent layers are used:
 *
 * 1. Network layer: API responses are rewritten before the web app reads them,
 *    so promoted entries never reach the timeline. This is language-independent
 *    and avoids layout flashes.
 * 2. DOM layer: a MutationObserver hides any promoted cell that still renders,
 *    for example when a request was issued before the network hooks were
 *    installed (Android injects scripts at page start, which can race with the
 *    page's own scripts).
 *
 * The script must stay ES2017-compatible and self-contained: it runs inside the
 * WebView, not in the React Native runtime.
 */
export const AD_FILTER_SCRIPT = String.raw`
(function () {
  'use strict';

  if (window.__twitterClearInstalled) {
    return;
  }
  window.__twitterClearInstalled = true;

  // ---------------------------------------------------------------------------
  // Network layer
  // ---------------------------------------------------------------------------

  var API_PATH_PATTERN = /\/i\/api\//;
  var PROMOTED_KEY_PATTERN = /promoted_?(?:metadata|content)$/i;
  var PROMOTED_ENTRY_ID_PATTERN = /^promoted/i;
  var PROMOTED_HINT = 'promoted';

  var removedCount = 0;

  function isApiUrl(url) {
    return typeof url === 'string' && API_PATH_PATTERN.test(url);
  }

  function isPromotedMarker(key, value) {
    return value !== null && typeof value === 'object' && PROMOTED_KEY_PATTERN.test(key);
  }

  /**
   * Removes promoted entries from a parsed API payload in place.
   *
   * Returns true when "node" is promoted and must be removed by its owner. The
   * signal bubbles up through plain objects until it reaches the closest array,
   * which drops the offending element. This removes a promoted tweet entry, a
   * promoted item inside a module, or a promoted trend without knowing the
   * exact response shape.
   */
  function prunePromoted(node) {
    if (Array.isArray(node)) {
      for (var index = node.length - 1; index >= 0; index--) {
        if (prunePromoted(node[index])) {
          node.splice(index, 1);
          removedCount++;
        }
      }
      return false;
    }

    if (node === null || typeof node !== 'object') {
      return false;
    }

    var isEntry = typeof node.entryId === 'string';
    if (isEntry && PROMOTED_ENTRY_ID_PATTERN.test(node.entryId)) {
      return true;
    }

    var removedBefore = removedCount;
    var promoted = false;
    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) {
        continue;
      }
      var value = node[key];
      if (isPromotedMarker(key, value) || prunePromoted(value)) {
        promoted = true;
      }
    }
    if (promoted) {
      return true;
    }

    // A module whose items were all promoted would render as an empty shell.
    var items = isEntry && node.content ? node.content.items : undefined;
    return Array.isArray(items) && items.length === 0 && removedCount > removedBefore;
  }

  /** Returns the payload text without promoted entries, or the input if unchanged. */
  function filterResponseText(text) {
    if (typeof text !== 'string' || text.indexOf(PROMOTED_HINT) === -1) {
      return text;
    }
    try {
      var payload = JSON.parse(text);
      var removedBefore = removedCount;
      prunePromoted(payload);
      return removedCount > removedBefore ? JSON.stringify(payload) : text;
    } catch (error) {
      return text;
    }
  }

  function installXhrFilter() {
    var prototype = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!prototype) {
      return;
    }
    var textDescriptor = Object.getOwnPropertyDescriptor(prototype, 'responseText');
    var responseDescriptor = Object.getOwnPropertyDescriptor(prototype, 'response');
    if (!textDescriptor || !textDescriptor.get || !responseDescriptor || !responseDescriptor.get) {
      return;
    }

    function attachFilter(xhr) {
      var rawText;
      var filteredText;
      var prunedResponse;

      function readFilteredText() {
        var text = textDescriptor.get.call(xhr);
        if (xhr.readyState !== 4) {
          return text;
        }
        if (text !== rawText) {
          rawText = text;
          filteredText = filterResponseText(text);
        }
        return filteredText;
      }

      Object.defineProperty(xhr, 'responseText', {
        configurable: true,
        get: readFilteredText,
      });

      Object.defineProperty(xhr, 'response', {
        configurable: true,
        get: function () {
          var type = xhr.responseType;
          if (type === '' || type === 'text') {
            return readFilteredText();
          }
          var response = responseDescriptor.get.call(xhr);
          if (
            type === 'json' &&
            xhr.readyState === 4 &&
            response !== null &&
            typeof response === 'object' &&
            response !== prunedResponse
          ) {
            prunePromoted(response);
            prunedResponse = response;
          }
          return response;
        },
      });
    }

    var originalOpen = prototype.open;
    prototype.open = function (method, url) {
      try {
        if (isApiUrl(String(url)) && !this.__twitterClearFiltered) {
          this.__twitterClearFiltered = true;
          attachFilter(this);
        }
      } catch (error) {
        // Never let the filter break a request.
      }
      return originalOpen.apply(this, arguments);
    };
  }

  function installFetchFilter() {
    var originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') {
      return;
    }

    window.fetch = function (input) {
      var request = originalFetch.apply(this, arguments);
      var url = typeof input === 'string' ? input : input && (input.url || String(input));
      if (!isApiUrl(url)) {
        return request;
      }

      return request.then(function (response) {
        var contentType = response.headers.get('content-type') || '';
        if (!response.ok || contentType.indexOf('json') === -1) {
          return response;
        }
        return response
          .clone()
          .text()
          .then(function (text) {
            var filtered = filterResponseText(text);
            if (filtered === text) {
              return response;
            }
            var replacement = new Response(filtered, {
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
  // DOM layer
  // ---------------------------------------------------------------------------

  var HIDDEN_ATTRIBUTE = 'data-twitter-clear-hidden';
  var CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
  var CANDIDATE_SELECTOR =
    'article[data-testid="tweet"], [data-testid="trend"], [data-testid="UserCell"]';
  // Regions whose text is user-generated and must never be read as an ad label.
  var USER_CONTENT_SELECTOR =
    '[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="UserName"], ' +
    '[data-testid="UserDescription"], [data-testid^="card."], [data-testid="socialContext"], ' +
    'a[href]';
  // Labels X renders on promoted content. The network layer does not depend on
  // them; they only back up the DOM fallback for the English interface.
  var AD_LABEL_PATTERN = /^(?:Ad|Promoted(?: by .+)?)$/;

  function hasAdLabel(candidate) {
    var spans = candidate.getElementsByTagName('span');
    for (var index = 0; index < spans.length; index++) {
      var span = spans[index];
      if (span.childElementCount !== 0) {
        continue;
      }
      var text = span.textContent;
      if (!text || text.length > 80 || !AD_LABEL_PATTERN.test(text.trim())) {
        continue;
      }
      if (!span.closest(USER_CONTENT_SELECTOR)) {
        return true;
      }
    }
    return false;
  }

  function evaluateCandidate(candidate) {
    if (!candidate.isConnected) {
      return;
    }
    var container = candidate.closest(CELL_SELECTOR) || candidate;
    if (hasAdLabel(candidate)) {
      container.setAttribute(HIDDEN_ATTRIBUTE, '');
    } else if (container.hasAttribute(HIDDEN_ATTRIBUTE)) {
      // Virtualized lists can reuse a node for organic content.
      container.removeAttribute(HIDDEN_ATTRIBUTE);
    }
  }

  var pendingCandidates = new Set();
  var flushScheduled = false;

  function flushCandidates() {
    flushScheduled = false;
    var candidates = Array.from(pendingCandidates);
    pendingCandidates.clear();
    for (var index = 0; index < candidates.length; index++) {
      evaluateCandidate(candidates[index]);
    }
  }

  function scheduleFlush() {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(flushCandidates);
  }

  function collectCandidates(node) {
    if (!node || node.nodeType !== 1) {
      return;
    }
    var owner = node.closest(CANDIDATE_SELECTOR);
    if (owner) {
      pendingCandidates.add(owner);
    }
    var nested = node.querySelectorAll(CANDIDATE_SELECTOR);
    for (var index = 0; index < nested.length; index++) {
      pendingCandidates.add(nested[index]);
    }
  }

  function installDomFilter() {
    var style = document.createElement('style');
    style.textContent = '[' + HIDDEN_ATTRIBUTE + '] { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);

    var observer = new MutationObserver(function (mutations) {
      for (var index = 0; index < mutations.length; index++) {
        var mutation = mutations[index];
        if (mutation.type === 'characterData') {
          collectCandidates(mutation.target.parentElement);
          continue;
        }
        var addedNodes = mutation.addedNodes;
        for (var nodeIndex = 0; nodeIndex < addedNodes.length; nodeIndex++) {
          var added = addedNodes[nodeIndex];
          collectCandidates(added.nodeType === 1 ? added : added.parentElement);
        }
      }
      if (pendingCandidates.size > 0) {
        scheduleFlush();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    collectCandidates(document.documentElement);
    scheduleFlush();
  }

  // ---------------------------------------------------------------------------
  // Theme bridge
  // ---------------------------------------------------------------------------

  /** Reports the page background so the native chrome can match the X theme. */
  function installThemeBridge() {
    // Matches a fully transparent color only: four components with a zero
    // alpha. Opaque black, "rgb(0, 0, 0)", is a real theme and must pass.
    var TRANSPARENT_PATTERN = /^rgba\([^)]*,\s*0(?:\.0+)?\)$/;
    var lastColor = '';

    function reportTheme() {
      var bridge = window.ReactNativeWebView;
      if (!document.body || !bridge) {
        return;
      }
      var color = window.getComputedStyle(document.body).backgroundColor;
      if (!color || color === lastColor || color === 'transparent' || TRANSPARENT_PATTERN.test(color)) {
        return;
      }
      lastColor = color;
      bridge.postMessage(JSON.stringify({ type: 'theme', backgroundColor: color }));
    }

    reportTheme();
    new MutationObserver(reportTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      childList: true,
      subtree: false,
    });
    if (document.body) {
      new MutationObserver(reportTheme).observe(document.body, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    window.addEventListener('load', reportTheme);
  }

  function whenDocumentReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function runSafely(task) {
    try {
      task();
    } catch (error) {
      // A failing layer must not take down the page or the other layers.
    }
  }

  runSafely(installXhrFilter);
  runSafely(installFetchFilter);
  whenDocumentReady(function () {
    runSafely(installDomFilter);
    runSafely(installThemeBridge);
  });
})();
true;
`;
