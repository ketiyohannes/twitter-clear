import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { IMAGE_SAVE_SCRIPT } from '../imageSaveScript.ts';

const PHOTO_URL = 'https://pbs.twimg.com/media/Abc123?format=jpg&name=small';

type Page = {
  document: Document;
  window: JSDOM['window'];
  messages: unknown[];
  /**
   * Long-presses an element, at the given point of the screen. Returns whether
   * the page's default action was suppressed.
   */
  longPress(id: string, point?: { x: number; y: number }): boolean;
  /** Places an element on the screen. */
  place(id: string, box: { left: number; top: number; width: number; height: number }): void;
  /** Declares which elements lie under the finger, topmost first. */
  stackUnderFinger(...ids: string[]): void;
};

function createPage(bodyHtml: string, options: { bridge?: boolean } = {}): Page {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://x.com/home',
  });
  const { document } = dom.window;
  const messages: unknown[] = [];
  if (options.bridge !== false) {
    dom.window.ReactNativeWebView = {
      postMessage: (data: string) => messages.push(JSON.parse(data)),
    };
  }
  dom.window.eval(IMAGE_SAVE_SCRIPT);

  const elementById = (id: string): Element => {
    const element = document.getElementById(id);
    assert.ok(element, `missing element #${id}`);
    return element;
  };

  return {
    document,
    window: dom.window,
    messages,
    longPress(id, point = { x: 0, y: 0 }) {
      const event = new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      });
      elementById(id).dispatchEvent(event);
      return event.defaultPrevented;
    },
    place(id, { left, top, width, height }) {
      // jsdom has no layout, so positions are supplied by the test as well.
      elementById(id).getBoundingClientRect = () =>
        ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    },
    stackUnderFinger(...ids) {
      // jsdom has no layout, so hit testing is supplied by the test.
      document.elementsFromPoint = () => ids.map(elementById);
    },
  };
}

describe('image save script', () => {
  it('reports a long-pressed picture and suppresses the default action', () => {
    const page = createPage(`<img id="photo" src="${PHOTO_URL}">`);

    assert.equal(page.longPress('photo'), true);
    assert.deepEqual(page.messages, [{ type: 'saveImage', url: PHOTO_URL }]);
  });

  it('finds the picture underneath the layers the page stacks over it', () => {
    const page = createPage(
      `<a id="link" href="/someone/status/1/photo/1"><div id="cover"></div>` +
        `<img id="photo" src="${PHOTO_URL}"></a>`,
    );
    page.stackUnderFinger('cover', 'link', 'photo');

    assert.equal(page.longPress('cover'), true);
    assert.deepEqual(page.messages, [{ type: 'saveImage', url: PHOTO_URL }]);
  });

  it('finds a picture drawn as a background', () => {
    const page = createPage(
      `<div id="banner" style="background-image: url(&quot;${PHOTO_URL}&quot;)"></div>`,
    );

    assert.equal(page.longPress('banner'), true);
    assert.deepEqual(page.messages, [{ type: 'saveImage', url: PHOTO_URL }]);
  });

  it('ignores a picture that lies behind a dialog', () => {
    const page = createPage(
      `<main><img id="photo" src="${PHOTO_URL}"></main>` +
        '<div id="layers"><div role="menu"><span id="item">Copy link</span></div></div>',
    );
    page.stackUnderFinger('item', 'photo');

    assert.equal(page.longPress('item'), false);
    assert.deepEqual(page.messages, []);
  });

  it('finds a picture shown inside a dialog, such as the photo viewer', () => {
    const page = createPage(
      '<main><img id="behind" src="https://pbs.twimg.com/media/Behind?format=jpg&name=small"></main>' +
        `<div id="layers"><div role="dialog"><div id="swipe"></div><img id="photo" src="${PHOTO_URL}"></div></div>`,
    );
    page.stackUnderFinger('swipe', 'photo', 'behind');

    assert.equal(page.longPress('swipe'), true);
    assert.deepEqual(page.messages, [{ type: 'saveImage', url: PHOTO_URL }]);
  });

  describe('a picture the page covers and excludes from hit testing', () => {
    const AVATAR_URL = 'https://pbs.twimg.com/profile_images/1234/photo_normal.jpg';
    const POST =
      '<article id="post">' +
      `<img id="avatar" src="${AVATAR_URL}"><p id="text">Hello</p>` +
      `<div inert><a href="/someone/status/1/photo/1"><img id="photo" src="${PHOTO_URL}"></a></div>` +
      '<a id="cover" href="https://m.x.com/someone/status/1/photo/1"></a>' +
      '</article>';

    function createPost(extraHtml = ''): Page {
      const page = createPage(POST + extraHtml);
      page.place('avatar', { left: 16, top: 80, width: 40, height: 40 });
      page.place('photo', { left: 64, top: 274, width: 332, height: 293 });
      return page;
    }

    it('is found by its position inside the pressed post', () => {
      const page = createPost();
      page.stackUnderFinger('cover', 'post');

      assert.equal(page.longPress('cover', { x: 230, y: 420 }), true);
      assert.deepEqual(page.messages, [{ type: 'saveImage', url: PHOTO_URL }]);
    });

    it('is not offered when the press lands elsewhere in the post', () => {
      const page = createPost();
      page.stackUnderFinger('text', 'post');

      assert.equal(page.longPress('text', { x: 230, y: 150 }), false);
      assert.deepEqual(page.messages, []);
    });

    it('is not offered when something outside the post is pressed over it', () => {
      const page = createPost('<div id="dialog">Sign in to continue</div>');
      page.stackUnderFinger('dialog');

      assert.equal(page.longPress('dialog', { x: 230, y: 420 }), false);
      assert.deepEqual(page.messages, []);
    });

    it('prefers the smallest picture under the finger', () => {
      const page = createPost();
      // A picture nested inside the area of a larger one.
      page.place('avatar', { left: 200, top: 400, width: 40, height: 40 });
      page.stackUnderFinger('cover', 'post');

      page.longPress('cover', { x: 220, y: 420 });
      assert.deepEqual(page.messages, [{ type: 'saveImage', url: AVATAR_URL }]);
    });
  });

  it('leaves long presses on anything else alone', () => {
    const page = createPage(
      '<p id="text">Hello</p>' +
        '<img id="emoji" src="https://abs-0.twimg.com/emoji/v2/svg/1f600.svg">' +
        '<img id="foreign" src="https://example.com/picture.jpg">',
    );

    for (const id of ['text', 'emoji', 'foreign']) {
      assert.equal(page.longPress(id), false, id);
    }
    assert.deepEqual(page.messages, []);
  });

  it('does nothing outside the app', () => {
    const page = createPage(`<img id="photo" src="${PHOTO_URL}">`, { bridge: false });

    assert.equal(page.longPress('photo'), false);
  });

  it('reports each long press once when the script is injected repeatedly', () => {
    const page = createPage(`<img id="photo" src="${PHOTO_URL}">`);
    page.window.eval(IMAGE_SAVE_SCRIPT);

    page.longPress('photo');
    assert.equal(page.messages.length, 1);
  });
});
