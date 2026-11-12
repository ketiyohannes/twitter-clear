/**
 * JavaScript injected into the X web app to show the classic Twitter bird
 * wherever the page renders the X logo.
 *
 * Like the ad filter, it is authored as a string because Hermes cannot return
 * the source of a compiled function, and it must stay ES2017-compatible and
 * self-contained: it runs inside the WebView, not in the React Native runtime.
 *
 * The page draws its logo in two ways, and both are handled:
 *
 * 1. The app interface and the loading screen use a 24x24 icon whose path
 *    starts with a fixed prefix. Only the path data is swapped, so the icon
 *    keeps its size and position.
 * 2. The signed-out landing page uses a larger multi-layer drawing labelled
 *    "X". Its contents are replaced with a single bird path.
 */
export const BIRD_LOGO_SCRIPT = String.raw`
(function () {
  'use strict';

  if (window.__twitterClearLogoInstalled) {
    return;
  }
  window.__twitterClearLogoInstalled = true;

  var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  var BIRD_VIEW_BOX = '0 0 24 24';
  var BIRD_COLOR = 'rgb(29, 155, 240)';
  var BIRD_PATH =
    'M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922' +
    '-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 ' +
    '1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 ' +
    '3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162' +
    '-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 ' +
    '1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 ' +
    '13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z';

  var RESTORED_ATTRIBUTE = 'data-twitter-clear-logo';
  // The 24x24 X icon. Matching on the path data is language-independent.
  var ICON_PATH_SELECTOR = 'path[d^="M18.244 2.25h3.308"]';
  // The large landing-page logo.
  var LABELLED_LOGO_SELECTOR =
    'svg[aria-label="X"][role="img"]:not([' + RESTORED_ATTRIBUTE + '])';
  var LOGO_SELECTOR = ICON_PATH_SELECTOR + ', ' + LABELLED_LOGO_SELECTOR;
  // A logo inside a control that also has a text label is acting as that
  // control's icon (for example a menu entry), so it keeps the control's color.
  var CONTROL_SELECTOR = 'a, button, [role="link"], [role="button"], [role="menuitem"], [role="tab"]';

  function isControlIcon(element) {
    var control = element.closest(CONTROL_SELECTOR);
    return control !== null && control.textContent.trim() !== '';
  }

  function restoreIconPath(path) {
    path.setAttribute('d', BIRD_PATH);
    if (!isControlIcon(path)) {
      path.style.fill = BIRD_COLOR;
    }
  }

  function restoreLabelledLogo(svg) {
    var path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', BIRD_PATH);
    path.setAttribute('fill', BIRD_COLOR);

    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    svg.setAttribute('viewBox', BIRD_VIEW_BOX);
    svg.setAttribute(RESTORED_ATTRIBUTE, '');
    svg.appendChild(path);
  }

  function restoreLogo(element) {
    if (element.tagName.toLowerCase() === 'path') {
      restoreIconPath(element);
    } else {
      restoreLabelledLogo(element);
    }
  }

  function restoreLogosIn(root) {
    if (!root || root.nodeType !== 1) {
      return;
    }
    if (root.matches(LOGO_SELECTOR)) {
      restoreLogo(root);
    }
    var logos = root.querySelectorAll(LOGO_SELECTOR);
    for (var index = 0; index < logos.length; index++) {
      restoreLogo(logos[index]);
    }
  }

  function scanDocument() {
    restoreLogosIn(document.documentElement);
  }

  function start() {
    new MutationObserver(function (mutations) {
      for (var index = 0; index < mutations.length; index++) {
        var addedNodes = mutations[index].addedNodes;
        for (var nodeIndex = 0; nodeIndex < addedNodes.length; nodeIndex++) {
          restoreLogosIn(addedNodes[nodeIndex]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    scanDocument();
  }

  function install() {
    // Android injects this script before the document has a root element, so
    // there is nothing to observe yet. Starting then would throw and leave the
    // logo untouched for the lifetime of the page.
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }

    start();
    // The loading screen is part of the initial HTML, which may still be
    // parsing when this script runs.
    document.addEventListener('DOMContentLoaded', scanDocument, { once: true });
  }

  try {
    install();
  } catch (error) {
    // A cosmetic change must never break the page.
  }
})();
true;
`;
