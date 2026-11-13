import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { AD_FILTER_SCRIPT } from '../adFilterScript.ts';

const TIMELINE_URL = 'https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D';

// ---------------------------------------------------------------------------
// Fixtures shaped like X timeline responses
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function tweetEntry(entryId: string, itemContentExtras: JsonObject = {}): JsonObject {
  return {
    entryId,
    sortIndex: '1',
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: { result: { rest_id: entryId, legacy: { full_text: `Text of ${entryId}` } } },
        ...itemContentExtras,
      },
    },
  };
}

function userItem(entryId: string, itemContentExtras: JsonObject = {}): JsonObject {
  return {
    entryId,
    item: {
      itemContent: {
        itemType: 'TimelineUser',
        user_results: { result: { rest_id: entryId } },
        ...itemContentExtras,
      },
    },
  };
}

function moduleEntry(entryId: string, items: JsonObject[]): JsonObject {
  return { entryId, sortIndex: '1', content: { entryType: 'TimelineTimelineModule', items } };
}

const PROMOTED_METADATA = { advertiser_results: { result: { rest_id: '99' } }, impressionId: 'i1' };

function buildTimeline(entries: JsonObject[]): JsonObject {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [{ type: 'TimelineAddEntries', entries }],
        },
      },
    },
  };
}

function entryIdsOf(payload: unknown): string[] {
  const timeline = payload as {
    data: { home: { home_timeline_urt: { instructions: { entries: { entryId: string }[] }[] } } };
  };
  // Copied into a local array: payloads pruned in place belong to the page's
  // realm, and strict deep equality compares prototypes.
  return Array.from(
    timeline.data.home.home_timeline_urt.instructions[0].entries,
    (entry) => entry.entryId,
  );
}

const MIXED_TIMELINE = buildTimeline([
  tweetEntry('tweet-1'),
  tweetEntry('promoted-tweet-2-abc', { promotedMetadata: PROMOTED_METADATA }),
  // Promoted content does not always carry a recognizable entry id.
  tweetEntry('tweet-3', { promotedMetadata: PROMOTED_METADATA }),
  // Organic tweets may mention the word or carry an empty marker.
  tweetEntry('tweet-4', { note: 'This tweet was not promoted', promoted_content: null }),
  moduleEntry('who-to-follow-5', [
    userItem('who-to-follow-5-user-1', { userPromotedMetadata: PROMOTED_METADATA }),
    userItem('who-to-follow-5-user-2'),
  ]),
  moduleEntry('who-to-follow-6', [
    userItem('who-to-follow-6-user-1', { promotedMetadata: PROMOTED_METADATA }),
  ]),
  { entryId: 'cursor-bottom-7', content: { entryType: 'TimelineTimelineCursor', value: 'c' } },
]);

const EXPECTED_ENTRY_IDS = ['tweet-1', 'tweet-4', 'who-to-follow-5', 'cursor-bottom-7'];

// ---------------------------------------------------------------------------
// Page harness
// ---------------------------------------------------------------------------

type FakeXhr = {
  responseType: string;
  readonly responseText: string;
  readonly response: unknown;
  open(method: string, url: string): void;
  respond(body: string): void;
};

type Page = {
  dom: JSDOM;
  document: Document;
  messages: string[];
  createXhr(): FakeXhr;
  setFetchResponse(body: string, contentType: string): Response;
  nextFrame(): Promise<void>;
};

/** Defines an XMLHttpRequest stand-in that mirrors the accessor layout of real browsers. */
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
      if (this.responseType !== 'json') { return this.body; }
      if (this.parsed === undefined) { this.parsed = JSON.parse(this.body); }
      return this.parsed;
    },
  });
  window.XMLHttpRequest.prototype.open = function (method, url) { this.readyState = 1; };
  window.XMLHttpRequest.prototype.respond = function (body) {
    this.body = body;
    this.readyState = 4;
  };
`;

function createPage(bodyHtml = ''): Page {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://x.com/home',
  });
  const window = dom.window as unknown as Record<string, unknown> & typeof dom.window;

  const messages: string[] = [];
  let fetchResponse = new Response('');
  window.ReactNativeWebView = { postMessage: (message: string) => messages.push(message) };
  window.Response = Response;
  window.fetch = () => Promise.resolve(fetchResponse);
  window.eval(FAKE_XHR_SOURCE);
  window.eval(AD_FILTER_SCRIPT);

  return {
    dom,
    document: window.document,
    messages,
    createXhr: () => window.eval('new XMLHttpRequest()') as FakeXhr,
    setFetchResponse(body, contentType) {
      fetchResponse = new Response(body, { headers: { 'content-type': contentType } });
      return fetchResponse;
    },
    nextFrame: () =>
      new Promise((resolve) => {
        window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0));
      }),
  };
}

function requestThroughXhr(page: Page, url: string, body: string, responseType = ''): FakeXhr {
  const xhr = page.createXhr();
  xhr.responseType = responseType;
  xhr.open('GET', url);
  xhr.respond(body);
  return xhr;
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

describe('XMLHttpRequest filter', () => {
  it('removes promoted entries from text responses', () => {
    const xhr = requestThroughXhr(createPage(), TIMELINE_URL, JSON.stringify(MIXED_TIMELINE));

    assert.deepEqual(entryIdsOf(JSON.parse(xhr.responseText)), EXPECTED_ENTRY_IDS);
    assert.deepEqual(entryIdsOf(JSON.parse(xhr.response as string)), EXPECTED_ENTRY_IDS);
  });

  it('keeps organic items of a module and drops only the promoted ones', () => {
    const xhr = requestThroughXhr(createPage(), TIMELINE_URL, JSON.stringify(MIXED_TIMELINE));
    const filtered = JSON.parse(xhr.responseText);
    const whoToFollow = filtered.data.home.home_timeline_urt.instructions[0].entries[2];

    assert.deepEqual(
      whoToFollow.content.items.map((item: { entryId: string }) => item.entryId),
      ['who-to-follow-5-user-2'],
    );
  });

  it('removes promoted entries from JSON responses', () => {
    const xhr = requestThroughXhr(
      createPage(),
      TIMELINE_URL,
      JSON.stringify(MIXED_TIMELINE),
      'json',
    );

    assert.deepEqual(entryIdsOf(xhr.response), EXPECTED_ENTRY_IDS);
    assert.equal(xhr.response, xhr.response, 'the pruned object must be stable across reads');
  });

  it('removes promoted trends', () => {
    const payload = {
      data: {
        timeline: {
          instructions: [
            {
              entries: [
                {
                  entryId: 'trends-1',
                  content: {
                    items: [
                      { entryId: 'trend-a', item: { itemContent: { name: 'Organic trend' } } },
                      {
                        entryId: 'trend-b',
                        item: {
                          itemContent: {
                            name: 'Sponsored trend',
                            promoted_metadata: { advertiser_name: 'Brand' },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };
    const xhr = requestThroughXhr(createPage(), TIMELINE_URL, JSON.stringify(payload));
    const items = JSON.parse(xhr.responseText).data.timeline.instructions[0].entries[0].content.items;

    assert.deepEqual(
      items.map((item: { entryId: string }) => item.entryId),
      ['trend-a'],
    );
  });

  it('returns responses without promoted content byte for byte', () => {
    const organic = JSON.stringify(
      buildTimeline([tweetEntry('tweet-1'), tweetEntry('tweet-2', { promoted_content: null })]),
    );
    const xhr = requestThroughXhr(createPage(), TIMELINE_URL, organic);

    assert.equal(xhr.responseText, organic);
  });

  it('leaves non-API requests and unparseable bodies untouched', () => {
    const page = createPage();
    const body = JSON.stringify(MIXED_TIMELINE);

    assert.equal(requestThroughXhr(page, 'https://example.com/data.json', body).responseText, body);
    assert.equal(
      requestThroughXhr(page, TIMELINE_URL, 'promoted but not json').responseText,
      'promoted but not json',
    );
  });

  it('does not expose a partial body as filtered before the request completes', () => {
    const xhr = createPage().createXhr();
    xhr.open('GET', TIMELINE_URL);

    assert.equal(xhr.responseText, '');
  });

  it('installs only once when the script is injected repeatedly', () => {
    const page = createPage();
    const window = page.dom.window;
    const openAfterFirstInjection = window.eval('XMLHttpRequest.prototype.open');
    window.eval(AD_FILTER_SCRIPT);

    assert.equal(window.eval('XMLHttpRequest.prototype.open'), openAfterFirstInjection);
  });
});

describe('fetch filter', () => {
  it('removes promoted entries from JSON API responses', async () => {
    const page = createPage();
    page.setFetchResponse(JSON.stringify(MIXED_TIMELINE), 'application/json; charset=utf-8');

    const response: Response = await page.dom.window.fetch(TIMELINE_URL);

    assert.equal(response.status, 200);
    assert.deepEqual(entryIdsOf(await response.json()), EXPECTED_ENTRY_IDS);
  });

  it('passes through the original response when nothing was removed', async () => {
    const page = createPage();
    const original = page.setFetchResponse(
      JSON.stringify(buildTimeline([tweetEntry('tweet-1')])),
      'application/json',
    );

    assert.equal(await page.dom.window.fetch(TIMELINE_URL), original);
  });

  it('passes through non-API and non-JSON responses', async () => {
    const page = createPage();
    const body = JSON.stringify(MIXED_TIMELINE);

    const nonApi = page.setFetchResponse(body, 'application/json');
    assert.equal(await page.dom.window.fetch('https://example.com/data.json'), nonApi);

    const nonJson = page.setFetchResponse(body, 'text/html');
    assert.equal(await page.dom.window.fetch(TIMELINE_URL), nonJson);
  });
});

// ---------------------------------------------------------------------------
// DOM layer
// ---------------------------------------------------------------------------

function tweetCell(id: string, innerHtml: string): string {
  return `<div data-testid="cellInnerDiv" id="${id}"><article data-testid="tweet">${innerHtml}</article></div>`;
}

const ORGANIC_TWEET =
  '<div data-testid="User-Name"><span>Jane</span></div>' +
  '<a href="/jane/status/1"><time>2h</time></a>' +
  '<div data-testid="tweetText"><span>Hello world</span></div>';

const PROMOTED_TWEET =
  '<div data-testid="User-Name"><span>Brand</span></div>' +
  '<div><span>Ad</span></div>' +
  '<div data-testid="tweetText"><span>Buy things</span></div>';

function isHidden(page: Page, id: string): boolean {
  return page.document.getElementById(id)?.hasAttribute('data-twitter-clear-hidden') ?? false;
}

describe('DOM filter', () => {
  it('hides promoted cells that are already rendered', async () => {
    const page = createPage(tweetCell('organic', ORGANIC_TWEET) + tweetCell('ad', PROMOTED_TWEET));
    await page.nextFrame();

    assert.equal(isHidden(page, 'ad'), true);
    assert.equal(isHidden(page, 'organic'), false);
  });

  it('hides promoted cells that are added later', async () => {
    const page = createPage('<main id="timeline"></main>');
    await page.nextFrame();

    const timeline = page.document.getElementById('timeline');
    assert.ok(timeline);
    timeline.insertAdjacentHTML(
      'beforeend',
      tweetCell('organic', ORGANIC_TWEET) + tweetCell('ad', PROMOTED_TWEET),
    );
    await page.nextFrame();

    assert.equal(isHidden(page, 'ad'), true);
    assert.equal(isHidden(page, 'organic'), false);
  });

  it('hides a cell whose ad label renders after the cell itself', async () => {
    const page = createPage(tweetCell('late', ORGANIC_TWEET));
    await page.nextFrame();
    assert.equal(isHidden(page, 'late'), false);

    page.document
      .querySelector('#late article')
      ?.insertAdjacentHTML('beforeend', '<div><span>Ad</span></div>');
    await page.nextFrame();

    assert.equal(isHidden(page, 'late'), true);
  });

  it('never reads user-generated text as an ad label', async () => {
    const page = createPage(
      tweetCell(
        'named-ad',
        '<div data-testid="User-Name"><span>Ad</span></div>' +
          '<div data-testid="tweetText"><span>Hello</span></div>',
      ) +
        tweetCell(
          'text-ad',
          '<div data-testid="User-Name"><span>Jane</span></div>' +
            '<div data-testid="tweetText"><span>Ad</span></div>',
        ) +
        tweetCell(
          'linked-ad',
          '<div data-testid="User-Name"><span>Jane</span></div>' +
            '<a href="/hashtag/Ad"><span>Ad</span></a>',
        ) +
        tweetCell(
          'mentions-ad',
          '<div data-testid="User-Name"><span>Jane</span></div><div><span>Ad break soon</span></div>',
        ),
    );
    await page.nextFrame();

    for (const id of ['named-ad', 'text-ad', 'linked-ad', 'mentions-ad']) {
      assert.equal(isHidden(page, id), false, id);
    }
  });

  it('hides promoted trends and promoted accounts', async () => {
    const page = createPage(
      '<div data-testid="cellInnerDiv" id="trend-ad"><div data-testid="trend">' +
        '<span>Sponsored trend</span><span>Promoted by Brand</span></div></div>' +
        '<div data-testid="cellInnerDiv" id="trend-organic"><div data-testid="trend">' +
        '<span>Organic trend</span><span>12K posts</span></div></div>' +
        '<div data-testid="UserCell" id="user-ad"><a href="/brand"><span>Brand</span></a>' +
        '<span>Promoted</span></div>' +
        '<div data-testid="UserCell" id="user-organic"><a href="/jane"><span>Jane</span></a></div>',
    );
    await page.nextFrame();

    assert.equal(isHidden(page, 'trend-ad'), true);
    assert.equal(isHidden(page, 'trend-organic'), false);
    assert.equal(isHidden(page, 'user-ad'), true);
    assert.equal(isHidden(page, 'user-organic'), false);
  });

  it('reveals a recycled cell once it holds organic content', async () => {
    const page = createPage(tweetCell('recycled', PROMOTED_TWEET));
    await page.nextFrame();
    assert.equal(isHidden(page, 'recycled'), true);

    const article = page.document.querySelector('#recycled article');
    assert.ok(article);
    article.innerHTML = ORGANIC_TWEET;
    await page.nextFrame();

    assert.equal(isHidden(page, 'recycled'), false);
  });

  it('hides a judged post when an ad label is written into an existing element', async () => {
    const page = createPage(tweetCell('written', ORGANIC_TWEET + '<div><span id="slot">2h</span></div>'));
    await page.nextFrame();
    assert.equal(isHidden(page, 'written'), false);

    const slot = page.document.getElementById('slot');
    assert.ok(slot?.firstChild);
    slot.firstChild.nodeValue = 'Ad';
    await page.nextFrame();

    assert.equal(isHidden(page, 'written'), true);
  });

  it('reveals a hidden cell once its ad label is rewritten', async () => {
    const page = createPage(
      tweetCell('rewritten', ORGANIC_TWEET + '<div><span id="label">Ad</span></div>'),
    );
    await page.nextFrame();
    assert.equal(isHidden(page, 'rewritten'), true);

    const label = page.document.getElementById('label');
    assert.ok(label?.firstChild);
    label.firstChild.nodeValue = '2h';
    await page.nextFrame();

    assert.equal(isHidden(page, 'rewritten'), false);
  });

  it('reads only what changed inside a post it has already judged', async () => {
    const words = Array.from({ length: 50 }, (_, index) => `<span>word ${index}</span>`).join('');
    const page = createPage(
      tweetCell('busy', ORGANIC_TWEET + `<div>${words}</div><div><span id="count">1</span></div>`),
    );
    await page.nextFrame();

    // Counts how many elements have their text read from here on.
    const prototype = page.dom.window.Node.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'textContent');
    assert.ok(descriptor?.get && descriptor.set);
    const readText = descriptor.get;
    let reads = 0;
    Object.defineProperty(prototype, 'textContent', {
      configurable: true,
      get(this: Node) {
        reads += 1;
        return readText.call(this);
      },
      set: descriptor.set,
    });

    const count = page.document.getElementById('count');
    assert.ok(count?.firstChild);
    for (let tick = 2; tick <= 20; tick += 1) {
      count.firstChild.nodeValue = String(tick);
      await page.nextFrame();
    }

    assert.equal(isHidden(page, 'busy'), false);
    // One read per tick: the counter itself, not the fifty spans around it.
    assert.ok(reads <= 19, `read the text of ${reads} elements for 19 small changes`);
  });

  it('ships the rule that actually hides marked cells', () => {
    const page = createPage();
    const rules = Array.from(page.document.querySelectorAll('style'), (style) => style.textContent);

    assert.ok(rules.some((rule) => rule?.includes('[data-twitter-clear-hidden] { display: none')));
  });
});

// ---------------------------------------------------------------------------
// Theme bridge
// ---------------------------------------------------------------------------

describe('theme bridge', () => {
  it('reports the page background and its later changes', async () => {
    const page = createPage();
    assert.deepEqual(page.messages, [], 'a transparent background is not a theme');

    page.document.body.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    await page.nextFrame();
    assert.deepEqual(page.messages, [], 'an explicitly transparent background is not a theme');

    page.document.body.style.backgroundColor = 'rgb(21, 32, 43)';
    await page.nextFrame();
    page.document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    await page.nextFrame();

    assert.deepEqual(
      page.messages.map((message) => JSON.parse(message)),
      [
        { type: 'theme', backgroundColor: 'rgb(21, 32, 43)' },
        { type: 'theme', backgroundColor: 'rgb(0, 0, 0)' },
      ],
    );
  });
});
