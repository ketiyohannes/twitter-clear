import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSetVideoQualityScript,
  isVideoQuality,
  parseVideoQualityMessage,
  VIDEO_QUALITY_OPTIONS,
} from '../videoQuality.ts';

describe('video quality options', () => {
  it('offers only qualities the page accepts, each once', () => {
    const values = VIDEO_QUALITY_OPTIONS.map((option) => option.value);
    assert.deepEqual([...new Set(values)], values);
    for (const value of values) {
      assert.equal(isVideoQuality(value), true, value);
    }
    assert.equal(values[0], 'auto');
  });
});

describe('parseVideoQualityMessage', () => {
  it('reads the quality in effect from a long press on a video', () => {
    assert.equal(parseVideoQualityMessage(JSON.stringify({ type: 'videoQuality', quality: '720' })), '720');
    assert.equal(
      parseVideoQualityMessage(JSON.stringify({ type: 'videoQuality', quality: 'highest' })),
      'highest',
    );
  });

  it('treats an unreadable quality as automatic', () => {
    for (const quality of [undefined, 42, '', '720p', 'best', '99999']) {
      assert.equal(
        parseVideoQualityMessage(JSON.stringify({ type: 'videoQuality', quality })),
        'auto',
        String(quality),
      );
    }
  });

  it('ignores other messages', () => {
    for (const data of [
      'not json',
      'null',
      '"videoQuality"',
      JSON.stringify({ type: 'saveImage', quality: '720' }),
      JSON.stringify({ quality: '720' }),
    ]) {
      assert.equal(parseVideoQualityMessage(data), null, data);
    }
  });
});

describe('buildSetVideoQualityScript', () => {
  it('passes the quality to the page', () => {
    const calls: string[] = [];
    const window = { __twitterClearSetVideoQuality: (quality: string) => calls.push(quality) };
    new Function('window', buildSetVideoQualityScript('720'))(window);
    assert.deepEqual(calls, ['720']);
  });

  it('does nothing on a page without the video quality script', () => {
    assert.doesNotThrow(() => new Function('window', buildSetVideoQualityScript('auto'))({}));
  });

  it('refuses anything that is not a quality', () => {
    assert.throws(() => buildSetVideoQualityScript('720"); alert(1); ("'));
  });
});
