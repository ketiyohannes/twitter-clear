import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildShareContent, parseShareMessage } from '../outgoingShare.ts';

function message(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: 'share', ...fields });
}

describe('parseShareMessage', () => {
  it('reads the fields of a share request', () => {
    assert.deepEqual(
      parseShareMessage(message({ title: 'Post', text: ' Look at this ', url: 'https://x.com/a/status/1' })),
      { title: 'Post', text: 'Look at this', url: 'https://x.com/a/status/1' },
    );
  });

  it('fills in missing fields', () => {
    assert.deepEqual(parseShareMessage(message({ url: 'https://x.com/a/status/1' })), {
      title: '',
      text: '',
      url: 'https://x.com/a/status/1',
    });
  });

  it('drops links that are not web addresses', () => {
    assert.deepEqual(parseShareMessage(message({ text: 'hi', url: 'javascript:alert(1)' })), {
      title: '',
      text: 'hi',
      url: '',
    });
    assert.equal(parseShareMessage(message({ url: 'file:///etc/passwd' })), null);
  });

  it('ignores other messages and malformed input', () => {
    assert.equal(parseShareMessage('not json'), null);
    assert.equal(parseShareMessage('null'), null);
    assert.equal(parseShareMessage(JSON.stringify({ type: 'theme', backgroundColor: '#000' })), null);
    assert.equal(parseShareMessage(message({})), null);
    assert.equal(parseShareMessage(message({ text: 42, url: ['https://x.com'] })), null);
  });

  it('caps the length of each field', () => {
    const request = parseShareMessage(message({ text: 'a'.repeat(10_000) }));
    assert.equal(request?.text.length, 4000);
  });
});

describe('buildShareContent', () => {
  it('puts the link after the text', () => {
    assert.deepEqual(
      buildShareContent({ title: '', text: 'Look at this', url: 'https://x.com/a/status/1' }),
      { message: 'Look at this\nhttps://x.com/a/status/1' },
    );
  });

  it('shares a bare link', () => {
    assert.deepEqual(buildShareContent({ title: '', text: '', url: 'https://x.com/a/status/1' }), {
      message: 'https://x.com/a/status/1',
    });
  });

  it('does not repeat a link the text already contains', () => {
    assert.deepEqual(
      buildShareContent({ title: '', text: 'See https://x.com/a/status/1', url: 'https://x.com/a/status/1' }),
      { message: 'See https://x.com/a/status/1' },
    );
  });

  it('keeps the title as the subject', () => {
    assert.deepEqual(
      buildShareContent({ title: 'A post', text: '', url: 'https://x.com/a/status/1' }),
      { message: 'https://x.com/a/status/1', title: 'A post' },
    );
  });

  it('falls back to the title when it is all there is', () => {
    assert.deepEqual(buildShareContent({ title: 'A post', text: '', url: '' }), { message: 'A post' });
  });

  it('returns null when there is nothing to share', () => {
    assert.equal(buildShareContent({ title: '', text: '', url: '' }), null);
  });
});
