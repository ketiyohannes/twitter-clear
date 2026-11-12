import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { BIRD_LOGO_SCRIPT } from '../birdLogoScript.ts';

const X_ICON_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const X_LANDING_PATH = 'M285.38 207.711L462.954 1.5H420.874L266.687 180.55L143.538 1.5H1.50003Z';
const HEART_PATH = 'M17.06 3a5.7 5.7 0 0 1 4.81 3.16z';
const BIRD_PATH_PREFIX = 'M23.643 4.937c-.835.37';
const BIRD_COLOR = 'rgb(29, 155, 240)';

function iconSvg(id: string, pathData: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><g><path id="${id}" d="${pathData}"></path></g></svg>`;
}

const LANDING_LOGO =
  '<svg id="landing" aria-label="X" role="img" fill="none" viewBox="0 0 480 490">' +
  '<defs><radialGradient id="glow"></radialGradient></defs>' +
  `<path d="${X_LANDING_PATH}" fill="#222222"></path>` +
  `<path d="${X_LANDING_PATH}" stroke="#fff"></path></svg>`;

type Page = {
  document: Document;
  window: JSDOM['window'];
  settle(): Promise<void>;
};

function createPage(bodyHtml: string): Page {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://x.com/home',
  });
  dom.window.eval(BIRD_LOGO_SCRIPT);
  return {
    document: dom.window.document,
    window: dom.window,
    // Mutation observers deliver their records in a microtask.
    settle: () => new Promise((resolve) => dom.window.setTimeout(() => resolve(), 0)),
  };
}

function pathData(page: Page, id: string): string {
  return page.document.getElementById(id)?.getAttribute('d') ?? '';
}

function fillOf(page: Page, id: string): string {
  return (page.document.getElementById(id) as HTMLElement | null)?.style.fill ?? '';
}

describe('bird logo', () => {
  it('replaces the X icon with the bird and colors it', () => {
    const page = createPage(iconSvg('logo', X_ICON_PATH));

    assert.ok(pathData(page, 'logo').startsWith(BIRD_PATH_PREFIX));
    assert.equal(fillOf(page, 'logo'), BIRD_COLOR);
  });

  it('leaves other icons untouched', () => {
    const page = createPage(iconSvg('heart', HEART_PATH));

    assert.equal(pathData(page, 'heart'), HEART_PATH);
    assert.equal(fillOf(page, 'heart'), '');
  });

  it('replaces logos that are rendered later', async () => {
    const page = createPage('<main id="app"></main>');
    page.document
      .getElementById('app')
      ?.insertAdjacentHTML('beforeend', `<header>${iconSvg('late', X_ICON_PATH)}</header>`);
    await page.settle();

    assert.ok(pathData(page, 'late').startsWith(BIRD_PATH_PREFIX));
  });

  it('only swaps the logo in the loading animation, not its motion path', () => {
    const page = createPage(
      '<svg viewBox="0 0 24 24" id="loading-x-anim-0"><g>' +
        `<path id="logo" d="${X_ICON_PATH}"></path>` +
        '<path id="motion" d="M 10,30 C 183,205 124,182 59,217"></path></g></svg>',
    );

    assert.ok(pathData(page, 'logo').startsWith(BIRD_PATH_PREFIX));
    assert.equal(pathData(page, 'motion'), 'M 10,30 C 183,205 124,182 59,217');
  });

  it('keeps the color of a logo that is the icon of a labelled control', () => {
    const page = createPage(
      `<a href="/i/premium_sign_up">${iconSvg('menu', X_ICON_PATH)}<span>Premium</span></a>` +
        `<a href="/home" aria-label="X">${iconSvg('header', X_ICON_PATH)}</a>`,
    );

    assert.ok(pathData(page, 'menu').startsWith(BIRD_PATH_PREFIX));
    assert.equal(fillOf(page, 'menu'), '');
    assert.equal(fillOf(page, 'header'), BIRD_COLOR);
  });

  it('redraws the landing-page logo as a single bird', async () => {
    const page = createPage(LANDING_LOGO);
    const logo = page.document.getElementById('landing');
    assert.ok(logo);

    assert.equal(logo.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(logo.children.length, 1);
    assert.ok(logo.children[0].getAttribute('d')?.startsWith(BIRD_PATH_PREFIX));
    assert.equal(logo.children[0].getAttribute('fill'), BIRD_COLOR);

    // Replacing its own children must not make the observer process it again.
    const bird = logo.children[0];
    await page.settle();
    assert.equal(logo.children[0], bird);
  });

  it('waits for the document when injected before it has a root element', async () => {
    // Android evaluates injected scripts before the root element exists.
    const dom = new JSDOM(`<!doctype html><html><body>${iconSvg('logo', X_ICON_PATH)}</body></html>`, {
      runScripts: 'outside-only',
      url: 'https://x.com/home',
    });
    const { document } = dom.window;
    Object.defineProperty(document, 'documentElement', { configurable: true, get: () => null });
    dom.window.eval(BIRD_LOGO_SCRIPT);
    assert.equal(document.getElementById('logo')?.getAttribute('d'), X_ICON_PATH);

    // The root element appears, then the document finishes parsing.
    delete (document as unknown as Record<string, unknown>).documentElement;
    document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.ok(document.getElementById('logo')?.getAttribute('d')?.startsWith(BIRD_PATH_PREFIX));

    document.body.insertAdjacentHTML('beforeend', iconSvg('late', X_ICON_PATH));
    await new Promise<void>((resolve) => dom.window.setTimeout(() => resolve(), 0));
    assert.ok(document.getElementById('late')?.getAttribute('d')?.startsWith(BIRD_PATH_PREFIX));
  });

  it('installs only once when the script is injected repeatedly', async () => {
    const page = createPage(iconSvg('logo', X_ICON_PATH));
    page.window.eval(BIRD_LOGO_SCRIPT);
    page.document.body.insertAdjacentHTML('beforeend', iconSvg('second', X_ICON_PATH));
    await page.settle();

    assert.ok(pathData(page, 'second').startsWith(BIRD_PATH_PREFIX));
  });
});
