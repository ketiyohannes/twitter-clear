import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { SHARE_BRIDGE_SCRIPT } from '../shareBridgeScript.ts';

type ShareData = { title?: string; text?: string; url?: string; files?: unknown[] };
type SharingNavigator = Navigator & {
  share(data?: ShareData): Promise<void>;
  canShare(data?: ShareData): boolean;
};

function createPage(options: { bridge?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://x.com/jane/status/1',
  });
  const window = dom.window as unknown as Record<string, unknown> & typeof dom.window;
  const messages: unknown[] = [];
  if (options.bridge !== false) {
    window.ReactNativeWebView = {
      postMessage: (message: string) => messages.push(JSON.parse(message)),
    };
  }
  window.eval(SHARE_BRIDGE_SCRIPT);
  return { window, messages, navigator: window.navigator as SharingNavigator };
}

describe('share bridge', () => {
  it('forwards a share request to the app', async () => {
    const page = createPage();
    await page.navigator.share({ title: 'Post', text: 'Look', url: 'https://x.com/jane/status/1?s=20' });

    assert.deepEqual(page.messages, [
      { type: 'share', title: 'Post', text: 'Look', url: 'https://x.com/jane/status/1?s=20' },
    ]);
  });

  it('resolves relative links against the page', async () => {
    const page = createPage();
    await page.navigator.share({ url: '/jane/status/2' });

    assert.deepEqual(page.messages, [
      { type: 'share', title: '', text: '', url: 'https://x.com/jane/status/2' },
    ]);
  });

  it('rejects requests it cannot fulfil without contacting the app', async () => {
    const page = createPage();

    await assert.rejects(page.navigator.share({}), { name: 'TypeError' });
    await assert.rejects(page.navigator.share(), { name: 'TypeError' });
    await assert.rejects(page.navigator.share({ url: 'https://' }), { name: 'TypeError' });
    await assert.rejects(page.navigator.share({ text: 'x', files: [{}] }), { name: 'NotAllowedError' });
    assert.deepEqual(page.messages, []);
  });

  it('rejects when the app bridge is missing', async () => {
    const page = createPage({ bridge: false });
    await assert.rejects(page.navigator.share({ text: 'x' }), { name: 'NotAllowedError' });
  });

  it('reports what it can share', () => {
    const page = createPage();

    assert.equal(page.navigator.canShare({ url: 'https://x.com' }), true);
    assert.equal(page.navigator.canShare({ files: [{}] }), false);
  });

  it('keeps an implementation the platform already provides', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    const native = () => Promise.resolve();
    Object.defineProperty(dom.window.navigator, 'share', { configurable: true, value: native });
    dom.window.eval(SHARE_BRIDGE_SCRIPT);

    assert.equal((dom.window.navigator as unknown as SharingNavigator).share, native);
  });
});
