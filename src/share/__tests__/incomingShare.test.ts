import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildComposeUrl } from '../incomingShare.ts';

function parametersOf(url: string | null): Record<string, string> {
  assert.ok(url !== null && url.startsWith('https://x.com/intent/post?'), String(url));
  return Object.fromEntries(new URL(url).searchParams);
}

describe('buildComposeUrl', () => {
  it('opens the composer with shared text', () => {
    assert.deepEqual(parametersOf(buildComposeUrl([{ shareType: 'text', value: 'Hello there' }])), {
      text: 'Hello there',
    });
  });

  it('treats text that is only an address as a link', () => {
    assert.deepEqual(
      parametersOf(buildComposeUrl([{ shareType: 'text', value: ' https://example.com/a?b=1&c=2 ' }])),
      { url: 'https://example.com/a?b=1&c=2' },
    );
  });

  it('combines a link with accompanying text', () => {
    assert.deepEqual(
      parametersOf(
        buildComposeUrl([
          { shareType: 'text', value: 'An article' },
          { shareType: 'url', value: 'https://example.com/article' },
        ]),
      ),
      { text: 'An article', url: 'https://example.com/article' },
    );
  });

  it('keeps text that merely contains a link as text', () => {
    assert.deepEqual(
      parametersOf(buildComposeUrl([{ shareType: 'text', value: 'Read https://example.com now' }])),
      { text: 'Read https://example.com now' },
    );
  });

  it('escapes characters that would break the link', () => {
    const url = buildComposeUrl([{ shareType: 'text', value: '50% off & more #sale\nline two' }]);

    assert.equal(parametersOf(url).text, '50% off & more #sale\nline two');
    assert.ok(!url?.includes('#'));
  });

  it('does not repeat a link that is shared twice', () => {
    assert.deepEqual(
      parametersOf(
        buildComposeUrl([
          { shareType: 'url', value: 'https://example.com' },
          { shareType: 'text', value: 'https://example.com' },
        ]),
      ),
      { url: 'https://example.com' },
    );
  });

  it('ignores files and empty payloads', () => {
    assert.equal(buildComposeUrl([]), null);
    assert.equal(buildComposeUrl([{ shareType: 'text', value: '   ' }]), null);
    assert.equal(buildComposeUrl([{ shareType: 'image', value: 'content://media/1' }]), null);
  });

  it('caps very long text', () => {
    const url = buildComposeUrl([{ shareType: 'text', value: 'a'.repeat(10_000) }]);
    assert.equal(parametersOf(url).text.length, 4000);
  });
});
