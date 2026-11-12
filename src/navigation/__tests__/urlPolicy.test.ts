import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyUrl, getWebHost, isTwitterUrl } from '../urlPolicy.ts';

describe('classifyUrl', () => {
  it('keeps X and its subdomains inside the WebView', () => {
    for (const url of [
      'https://x.com/home',
      'https://twitter.com/jack/status/20',
      'https://mobile.twitter.com/explore',
      'https://api.x.com/1.1/onboarding/task.json',
      'HTTPS://X.COM/i/flow/login',
      'https://x.com:443/home',
    ]) {
      assert.equal(classifyUrl(url), 'internal', url);
    }
  });

  it('keeps sign-in and challenge providers inside the WebView', () => {
    assert.equal(classifyUrl('https://accounts.google.com/o/oauth2/v2/auth'), 'internal');
    assert.equal(classifyUrl('https://appleid.apple.com/auth/authorize'), 'internal');
    assert.equal(classifyUrl('https://client-api.arkoselabs.com/fc/gc/'), 'internal');
  });

  it('sends other websites, including shortened links, to the in-app browser', () => {
    assert.equal(classifyUrl('https://t.co/abc123'), 'external');
    assert.equal(classifyUrl('https://example.com/article'), 'external');
    assert.equal(classifyUrl('http://www.google.com/search?q=x.com'), 'external');
  });

  it('does not treat look-alike hosts as X', () => {
    for (const url of [
      'https://notx.com/home',
      'https://x.com.evil.example/home',
      'https://x.com@evil.example/home',
      'https://evil.example\\@x.com/home',
      'https://evil.example/?next=https://x.com/home',
      'https://evil.example#@x.com',
    ]) {
      assert.equal(classifyUrl(url), 'external', url);
    }
  });

  it('lets the WebView resolve inline documents', () => {
    assert.equal(classifyUrl('about:blank'), 'internal');
    assert.equal(classifyUrl('blob:https://x.com/0f3a'), 'internal');
  });

  it('delegates communication schemes to the operating system', () => {
    assert.equal(classifyUrl('mailto:someone@example.com'), 'system');
    assert.equal(classifyUrl('tel:+15555550100'), 'system');
  });

  it('blocks redirects into the official app and the app stores', () => {
    for (const url of [
      'twitter://timeline',
      'intent://x.com/home#Intent;package=com.twitter.android;end',
      'itms-apps://apps.apple.com/app/id333903271',
      'market://details?id=com.twitter.android',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      assert.equal(classifyUrl(url), 'blocked', url);
    }
  });
});

describe('getWebHost', () => {
  it('returns the lower-cased host without credentials or port', () => {
    assert.equal(getWebHost('https://User:Pass@Sub.X.com:8443/path?q=1#frag'), 'sub.x.com');
  });

  it('returns null for non-web URLs', () => {
    assert.equal(getWebHost('about:blank'), null);
    assert.equal(getWebHost('twitter://timeline'), null);
  });
});

describe('isTwitterUrl', () => {
  it('accepts links to X content', () => {
    assert.equal(isTwitterUrl('https://x.com/jack/status/20'), true);
    assert.equal(isTwitterUrl('https://www.twitter.com/jack'), true);
  });

  it('rejects everything else', () => {
    assert.equal(isTwitterUrl('exp://127.0.0.1:8081'), false);
    assert.equal(isTwitterUrl('twitterclear://home'), false);
    assert.equal(isTwitterUrl('https://accounts.google.com/'), false);
    assert.equal(isTwitterUrl('https://evil.example/x.com'), false);
  });
});
