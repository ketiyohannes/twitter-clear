import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSaveImageMessage, resolveImageDownload } from '../imageDownload.ts';

describe('resolveImageDownload', () => {
  const JPEG_ORIGINAL = {
    url: 'https://pbs.twimg.com/media/Abc123?format=jpg&name=orig',
    fileName: 'Abc123.jpg',
  };
  const PNG_ORIGINAL = {
    url: 'https://pbs.twimg.com/media/Abc123?format=png&name=orig',
    fileName: 'Abc123.png',
  };
  const LARGEST_JPEG = {
    url: 'https://pbs.twimg.com/media/Abc123?format=jpg&name=4096x4096',
    fileName: 'Abc123.jpg',
  };

  it('tries the original of a posted picture, then its largest copy', () => {
    assert.deepEqual(
      resolveImageDownload('https://pbs.twimg.com/media/Abc123?format=jpg&name=small'),
      [JPEG_ORIGINAL, PNG_ORIGINAL, LARGEST_JPEG],
    );
    assert.equal(
      resolveImageDownload('https://pbs.twimg.com/media/GaBc-D_eF12?format=jpg&name=small')?.[0].url,
      'https://pbs.twimg.com/media/GaBc-D_eF12?format=jpg&name=orig',
    );
  });

  it('tries the PNG original first for a picture displayed as PNG', () => {
    assert.deepEqual(
      resolveImageDownload('https://pbs.twimg.com/media/Abc123?name=large&format=png'),
      [PNG_ORIGINAL, JPEG_ORIGINAL, LARGEST_JPEG],
    );
  });

  it('never requests an original in the re-encoded format the page displays', () => {
    // WebP copies are generated for display; no original exists in that format.
    assert.deepEqual(
      resolveImageDownload('https://pbs.twimg.com/media/Abc123?format=webp&name=360x360'),
      [JPEG_ORIGINAL, PNG_ORIGINAL, LARGEST_JPEG],
    );
  });

  it('understands the older address style', () => {
    assert.deepEqual(resolveImageDownload('https://pbs.twimg.com/media/Abc123.jpg:large'), [
      JPEG_ORIGINAL,
      PNG_ORIGINAL,
      LARGEST_JPEG,
    ]);
    assert.deepEqual(resolveImageDownload('https://pbs.twimg.com/media/Abc123.JPEG')?.[0], JPEG_ORIGINAL);
    assert.deepEqual(resolveImageDownload('https://pbs.twimg.com/media/Abc123.png')?.[0], PNG_ORIGINAL);
  });

  it('assumes JPEG when the format is not stated', () => {
    assert.deepEqual(resolveImageDownload('https://pbs.twimg.com/media/Abc123')?.[0], JPEG_ORIGINAL);
  });

  it('tries the original of a profile picture, then the copy on screen', () => {
    assert.deepEqual(
      resolveImageDownload('https://pbs.twimg.com/profile_images/1234/aB_c-9_normal.jpg'),
      [
        { url: 'https://pbs.twimg.com/profile_images/1234/aB_c-9.jpg', fileName: 'aB_c-9.jpg' },
        { url: 'https://pbs.twimg.com/profile_images/1234/aB_c-9_normal.jpg', fileName: 'aB_c-9.jpg' },
      ],
    );
    assert.equal(
      resolveImageDownload('https://pbs.twimg.com/profile_images/1234/photo_400x400.png')?.[0].url,
      'https://pbs.twimg.com/profile_images/1234/photo.png',
    );
    assert.deepEqual(resolveImageDownload('https://pbs.twimg.com/profile_images/1234/photo.jpg'), [
      { url: 'https://pbs.twimg.com/profile_images/1234/photo.jpg', fileName: 'photo.jpg' },
    ]);
  });

  it('requests the largest size of a profile banner', () => {
    const largest = [
      {
        url: 'https://pbs.twimg.com/profile_banners/1234/1700000000/1500x500',
        fileName: 'banner-1234.jpg',
      },
    ];
    assert.deepEqual(
      resolveImageDownload('https://pbs.twimg.com/profile_banners/1234/1700000000/600x200'),
      largest,
    );
    assert.deepEqual(resolveImageDownload('https://pbs.twimg.com/profile_banners/1234/1700000000'), largest);
  });

  it('rejects pictures it has no full-quality address for', () => {
    for (const url of [
      'https://pbs.twimg.com/amplify_video_thumb/123/img/abc.jpg',
      'https://pbs.twimg.com/card_img/123/abc?format=jpg&name=small',
      'https://abs-0.twimg.com/emoji/v2/svg/1f600.svg',
      'https://example.com/media/Abc123?format=jpg&name=small',
      'http://pbs.twimg.com/media/Abc123?format=jpg',
      'https://pbs.twimg.com.example.com/media/Abc123',
      'https://pbs.twimg.com/media/../secret?format=jpg',
      'https://pbs.twimg.com/media/Abc123/extra?format=jpg',
      'file:///data/data/app/secret.jpg',
      '',
    ]) {
      assert.equal(resolveImageDownload(url), null, url);
    }
  });

  it('never produces a file name that leaves its folder', () => {
    for (const url of [
      'https://pbs.twimg.com/media/GaBc-D_eF12?format=jpg&name=small',
      'https://pbs.twimg.com/profile_images/1234/aB_c-9_normal.jpg',
      'https://pbs.twimg.com/profile_banners/1234/1700000000/600x200',
    ]) {
      const sources = resolveImageDownload(url) ?? [];
      assert.ok(sources.length > 0, url);
      for (const source of sources) {
        assert.match(source.fileName, /^[A-Za-z0-9_-]+\.[a-z]+$/);
      }
    }
  });
});

describe('parseSaveImageMessage', () => {
  it('reads the picture from a save request', () => {
    const data = JSON.stringify({
      type: 'saveImage',
      url: 'https://pbs.twimg.com/media/Abc123?format=jpg&name=small',
    });
    assert.equal(parseSaveImageMessage(data)?.[0].fileName, 'Abc123.jpg');
  });

  it('ignores other messages', () => {
    const url = 'https://pbs.twimg.com/media/Abc123?format=jpg&name=small';
    for (const data of [
      'not json',
      'null',
      '"saveImage"',
      JSON.stringify({ type: 'share', url }),
      JSON.stringify({ type: 'saveImage' }),
      JSON.stringify({ type: 'saveImage', url: 42 }),
      JSON.stringify({ type: 'saveImage', url: 'https://example.com/a.jpg' }),
    ]) {
      assert.equal(parseSaveImageMessage(data), null, data);
    }
  });
});
