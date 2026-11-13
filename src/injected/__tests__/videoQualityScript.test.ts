import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { VIDEO_QUALITY_SCRIPT } from '../videoQualityScript.ts';

const MASTER_URL = 'https://video.twimg.com/amplify_video/1/pl/master.m3u8?tag=29';

// Shaped like the master playlists X serves.
const HEADER = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-32000",AUTOSELECT=YES,URI="/amplify_video/1/pl/mp4a/32000/a.m3u8"',
  '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-128000",AUTOSELECT=YES,URI="/amplify_video/1/pl/mp4a/128000/b.m3u8"',
  '',
];

function rendition(width: number, height: number, bandwidth: number): string[] {
  return [
    `#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=${bandwidth},BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height},CODECS="mp4a.40.2,avc1.4d4015",AUDIO="audio-32000"`,
    `/amplify_video/1/pl/avc1/${width}x${height}/v.m3u8`,
  ];
}

function playlist(...renditions: string[][]): string {
  return [...HEADER, ...renditions.flat(), ''].join('\n');
}

const LANDSCAPE = playlist(
  rendition(480, 270, 223613),
  rendition(640, 360, 644078),
  rendition(1280, 720, 1763591),
  rendition(1920, 1080, 6491970),
);

/** The resolutions a playlist still offers. */
function resolutionsOf(text: string): string[] {
  return Array.from(text.matchAll(/RESOLUTION=(\d+x\d+)/g), (match) => match[1]);
}

type FakeXhr = {
  responseType: string;
  readonly responseText: string;
  readonly response: unknown;
  open(method: string, url: string): void;
  respond(body: string): void;
};

type Page = {
  window: JSDOM['window'] & Record<string, unknown>;
  document: Document;
  messages: unknown[];
  setQuality(quality: unknown): void;
  request(url: string, body: string, responseType?: string): FakeXhr;
  setFetchResponse(body: string, init?: ResponseInit): Response;
  /** Places an element on the screen; jsdom has no layout of its own. */
  place(id: string, box: { left: number; top: number; width: number; height: number }): void;
  /** Long-presses an element. Returns whether the default action was suppressed. */
  longPress(id: string, point: { x: number; y: number }): boolean;
};

/** An XMLHttpRequest stand-in that mirrors the accessor layout of real browsers. */
const FAKE_XHR_SOURCE = `
  window.XMLHttpRequest = function XMLHttpRequest() {
    this.readyState = 0;
    this.responseType = '';
    this.body = '';
  };
  Object.defineProperty(window.XMLHttpRequest.prototype, 'responseText', {
    configurable: true,
    get: function () { return this.body; },
  });
  Object.defineProperty(window.XMLHttpRequest.prototype, 'response', {
    configurable: true,
    get: function () {
      if (this.responseType !== 'arraybuffer') { return this.body; }
      if (this.buffer === undefined) { this.buffer = new TextEncoder().encode(this.body).buffer; }
      return this.buffer;
    },
  });
  window.XMLHttpRequest.prototype.open = function (method, url) { this.readyState = 1; };
  window.XMLHttpRequest.prototype.respond = function (body) {
    this.body = body;
    this.readyState = 4;
  };
`;

function createPage(bodyHtml = '', options: { bridge?: boolean } = {}): Page {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://x.com/home',
  });
  const window = dom.window as unknown as Page['window'];
  const messages: unknown[] = [];
  let fetchResponse = new Response('');
  if (options.bridge !== false) {
    window.ReactNativeWebView = { postMessage: (data: string) => messages.push(JSON.parse(data)) };
  }
  window.Response = Response;
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.fetch = () => Promise.resolve(fetchResponse);
  window.eval(FAKE_XHR_SOURCE);
  window.eval(VIDEO_QUALITY_SCRIPT);

  const elementById = (id: string): Element => {
    const element = window.document.getElementById(id);
    assert.ok(element, `missing element #${id}`);
    return element;
  };

  return {
    window,
    document: window.document,
    messages,
    setQuality(quality) {
      (window.__twitterClearSetVideoQuality as (quality: unknown) => void)(quality);
    },
    request(url, body, responseType = '') {
      const xhr = window.eval('new XMLHttpRequest()') as FakeXhr;
      xhr.responseType = responseType;
      xhr.open('GET', url);
      xhr.respond(body);
      return xhr;
    },
    setFetchResponse(body, init) {
      fetchResponse = new Response(body, init);
      return fetchResponse;
    },
    place(id, { left, top, width, height }) {
      elementById(id).getBoundingClientRect = () =>
        ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    },
    longPress(id, point) {
      const event = new dom.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      });
      elementById(id).dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
}

describe('video quality: playlist rewriting', () => {
  it('leaves playlists alone until a quality is chosen', () => {
    const page = createPage();

    assert.equal(page.request(MASTER_URL, LANDSCAPE).responseText, LANDSCAPE);
  });

  it('reduces a master playlist to the chosen rendition', () => {
    const page = createPage();
    page.setQuality('720');

    const rewritten = page.request(MASTER_URL, LANDSCAPE).responseText;
    assert.equal(rewritten, playlist(rendition(1280, 720, 1763591)));
  });

  it('keeps everything that is not a rendition, such as the audio tracks', () => {
    const page = createPage();
    page.setQuality('360');

    const rewritten = page.request(MASTER_URL, LANDSCAPE).responseText;
    for (const line of HEADER) {
      assert.ok(rewritten.split('\n').includes(line), line);
    }
  });

  it('picks the best rendition that does not exceed the chosen quality', () => {
    const page = createPage();
    const choices: Record<string, string> = {
      '1080': '1920x1080',
      '720': '1280x720',
      // No 480p rendition exists, so the next one down is used.
      '480': '640x360',
      '360': '640x360',
      highest: '1920x1080',
      lowest: '480x270',
    };
    for (const [quality, expected] of Object.entries(choices)) {
      page.setQuality(quality);
      assert.deepEqual(resolutionsOf(page.request(MASTER_URL, LANDSCAPE).responseText), [expected], quality);
    }
  });

  it('uses the smallest rendition when all of them exceed the chosen quality', () => {
    const page = createPage();
    page.setQuality('360');

    const body = playlist(rendition(1920, 1080, 6000000), rendition(1280, 720, 1700000));
    assert.deepEqual(resolutionsOf(page.request(MASTER_URL, body).responseText), ['1280x720']);
  });

  it('measures an upright video by its shorter side', () => {
    const page = createPage();
    page.setQuality('720');

    const body = playlist(
      rendition(320, 568, 300000),
      rendition(720, 1280, 2000000),
      rendition(1080, 1920, 6000000),
    );
    assert.deepEqual(resolutionsOf(page.request(MASTER_URL, body).responseText), ['720x1280']);
  });

  it('prefers the higher bitrate among renditions of the same size', () => {
    const page = createPage();
    page.setQuality('highest');

    const body = playlist(rendition(1280, 720, 1700000), rendition(1280, 720, 2600000));
    const rewritten = page.request(MASTER_URL, body).responseText;
    assert.deepEqual(Array.from(rewritten.matchAll(/,BANDWIDTH=(\d+)/g), (match) => match[1]), ['2600000']);
  });

  it('returns to automatic quality', () => {
    const page = createPage();
    page.setQuality('720');
    page.setQuality('auto');

    assert.equal(page.request(MASTER_URL, LANDSCAPE).responseText, LANDSCAPE);
  });

  it('ignores a quality it does not understand', () => {
    const page = createPage();
    page.setQuality('720');
    for (const quality of ['720p', 'best', '', '99999', 720, null, undefined]) {
      page.setQuality(quality);
    }

    assert.deepEqual(resolutionsOf(page.request(MASTER_URL, LANDSCAPE).responseText), ['1280x720']);
  });

  it('remembers the chosen quality across page loads', () => {
    const page = createPage();
    page.setQuality('1080');

    assert.equal(page.window.localStorage.getItem('twitterClear.videoQuality'), '1080');
  });

  it('leaves playlists it cannot choose from untouched', () => {
    const page = createPage();
    page.setQuality('720');

    const single = playlist(rendition(640, 360, 644078));
    const media = '#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3.0,\n/amplify_video/1/vid/a.m4s\n#EXT-X-ENDLIST\n';
    const unsized = [
      ...HEADER,
      '#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"',
      '/audio-only.m3u8',
      ...rendition(640, 360, 644078),
      '',
    ].join('\n');
    for (const body of [single, media, unsized, '']) {
      assert.equal(page.request(MASTER_URL, body).responseText, body);
    }
  });

  it('only touches video playlists', () => {
    const page = createPage();
    page.setQuality('720');

    for (const url of [
      'https://x.com/i/api/graphql/abc/HomeTimeline',
      'https://example.com/pl/master.m3u8',
      'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/a.mp4',
      'https://video.twimg.com.example.com/pl/master.m3u8',
    ]) {
      assert.equal(page.request(url, LANDSCAPE).responseText, LANDSCAPE, url);
    }
  });

  it('rewrites every way of reading a request', () => {
    const page = createPage();
    page.setQuality('720');
    const expected = playlist(rendition(1280, 720, 1763591));

    assert.equal(page.request(MASTER_URL, LANDSCAPE, 'text').response, expected);
    assert.equal(page.request(MASTER_URL, LANDSCAPE).response, expected);

    const binary = page.request(MASTER_URL, LANDSCAPE, 'arraybuffer');
    const buffer = binary.response as ArrayBuffer;
    assert.equal(new TextDecoder().decode(buffer), expected);
    assert.equal(binary.response, buffer, 'repeated reads return the same buffer');
  });

  it('leaves a request alone while it is still loading', () => {
    const page = createPage();
    page.setQuality('720');

    const xhr = page.window.eval('new XMLHttpRequest()') as FakeXhr & { body: string; readyState: number };
    xhr.open('GET', MASTER_URL);
    xhr.body = LANDSCAPE.slice(0, 200);
    xhr.readyState = 3;
    assert.equal(xhr.responseText, LANDSCAPE.slice(0, 200));
  });

  it('rewrites playlists requested through fetch', async () => {
    const page = createPage();
    page.setQuality('720');
    page.setFetchResponse(LANDSCAPE, { headers: { 'content-type': 'application/x-mpegURL' } });

    const response = (await page.window.fetch(MASTER_URL)) as Response;
    assert.equal(await response.text(), playlist(rendition(1280, 720, 1763591)));
    assert.equal(response.headers.get('content-type'), 'application/x-mpegURL');
  });

  it('passes fetch responses through when there is nothing to rewrite', async () => {
    const page = createPage();

    const automatic = page.setFetchResponse(LANDSCAPE);
    assert.equal(await page.window.fetch(MASTER_URL), automatic);

    page.setQuality('720');
    const other = page.setFetchResponse(LANDSCAPE);
    assert.equal(await page.window.fetch('https://x.com/i/api/graphql/abc/HomeTimeline'), other);

    const failed = page.setFetchResponse('Not found', { status: 404 });
    assert.equal(await page.window.fetch(MASTER_URL), failed);
  });
});

describe('video quality: long press', () => {
  const POST =
    '<article id="post"><p id="text">Hello</p>' +
    '<div id="player"><video id="video"></video><div id="controls"></div></div></article>';

  function createPost(extraHtml = ''): Page {
    const page = createPage(POST + extraHtml);
    page.place('video', { left: 64, top: 300, width: 332, height: 187 });
    return page;
  }

  it('asks the app to offer the qualities, reporting the one in effect', () => {
    const page = createPost();

    assert.equal(page.longPress('controls', { x: 200, y: 400 }), true);
    page.setQuality('720');
    page.longPress('video', { x: 200, y: 400 });

    assert.deepEqual(page.messages, [
      { type: 'videoQuality', quality: 'auto' },
      { type: 'videoQuality', quality: '720' },
    ]);
  });

  it('leaves long presses outside a video alone', () => {
    const page = createPost();

    assert.equal(page.longPress('text', { x: 200, y: 150 }), false);
    assert.deepEqual(page.messages, []);
  });

  it('keeps a press on a video from reaching handlers installed after it', () => {
    const page = createPost();
    const seen: string[] = [];
    page.document.addEventListener(
      'contextmenu',
      (event) => seen.push((event.target as Element).id),
      true,
    );

    page.longPress('video', { x: 200, y: 400 });
    page.longPress('text', { x: 200, y: 150 });

    assert.deepEqual(seen, ['text']);
  });

  it('ignores a video that lies behind a dialog', () => {
    const page = createPost('<div id="layers"><div role="dialog"><span id="notice">Sign in</span></div></div>');

    assert.equal(page.longPress('notice', { x: 200, y: 400 }), false);
    assert.deepEqual(page.messages, []);
  });

  it('finds a video shown inside a dialog, such as the media viewer', () => {
    const page = createPage(
      '<div id="layers"><div role="dialog"><video id="video"></video><div id="swipe"></div></div></div>',
    );
    page.place('video', { left: 0, top: 200, width: 400, height: 225 });

    assert.equal(page.longPress('swipe', { x: 200, y: 300 }), true);
    assert.deepEqual(page.messages, [{ type: 'videoQuality', quality: 'auto' }]);
  });

  it('does not mistake a video in a dialog for the page behind it', () => {
    const page = createPage(
      '<p id="text">Hello</p>' +
        '<div id="layers"><div role="dialog"><video id="video"></video></div></div>',
    );
    page.place('video', { left: 0, top: 200, width: 400, height: 225 });

    assert.equal(page.longPress('text', { x: 200, y: 300 }), false);
  });

  it('does nothing outside the app', () => {
    const page = createPage(POST, { bridge: false });
    page.place('video', { left: 64, top: 300, width: 332, height: 187 });

    assert.equal(page.longPress('video', { x: 200, y: 400 }), false);
  });

  it('reports each long press once when the script is injected repeatedly', () => {
    const page = createPost();
    page.window.eval(VIDEO_QUALITY_SCRIPT);

    page.longPress('video', { x: 200, y: 400 });
    assert.equal(page.messages.length, 1);
  });
});
