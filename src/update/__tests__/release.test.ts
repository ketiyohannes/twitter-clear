import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findUpdate, isNewerVersion, parseRelease } from '../release.ts';

const REPOSITORY = 'someone/twitter-clear';
const DOWNLOAD_URL =
  'https://github.com/someone/twitter-clear/releases/download/v1.2.0/TwitterClear-1.2.0-arm64.apk';

function releasePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v1.2.0',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'notes.txt', browser_download_url: `${DOWNLOAD_URL}.txt` },
      { name: 'TwitterClear-1.2.0-arm64.apk', browser_download_url: DOWNLOAD_URL },
    ],
    ...overrides,
  };
}

describe('isNewerVersion', () => {
  it('compares each part numerically', () => {
    assert.equal(isNewerVersion('1.0.10', '1.0.9'), true);
    assert.equal(isNewerVersion('1.1.0', '1.0.9'), true);
    assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
    assert.equal(isNewerVersion('1.0.9', '1.0.10'), false);
    assert.equal(isNewerVersion('1.9.9', '2.0.0'), false);
  });

  it('does not treat the same version as newer', () => {
    assert.equal(isNewerVersion('1.0.4', '1.0.4'), false);
    assert.equal(isNewerVersion('v1.0.4', '1.0.4'), false);
  });

  it('never reports an unreadable version as newer', () => {
    assert.equal(isNewerVersion('latest', '1.0.4'), false);
    assert.equal(isNewerVersion('1.1', '1.0.4'), false);
    assert.equal(isNewerVersion('1.1.0-beta', '1.0.4'), false);
    assert.equal(isNewerVersion('1.1.0', ''), false);
  });
});

describe('parseRelease', () => {
  it('reads the version and the package download link', () => {
    assert.deepEqual(parseRelease(releasePayload(), REPOSITORY), {
      version: '1.2.0',
      downloadUrl: DOWNLOAD_URL,
    });
  });

  it('accepts a tag without the "v" prefix', () => {
    assert.equal(parseRelease(releasePayload({ tag_name: '1.2.0' }), REPOSITORY)?.version, '1.2.0');
  });

  it('ignores drafts and pre-releases', () => {
    assert.equal(parseRelease(releasePayload({ draft: true }), REPOSITORY), null);
    assert.equal(parseRelease(releasePayload({ prerelease: true }), REPOSITORY), null);
  });

  it('ignores a release without an installable package', () => {
    const assets = [{ name: 'notes.txt', browser_download_url: `${DOWNLOAD_URL}.txt` }];
    assert.equal(parseRelease(releasePayload({ assets }), REPOSITORY), null);
    assert.equal(parseRelease(releasePayload({ assets: [] }), REPOSITORY), null);
  });

  it('rejects a package hosted outside the repository releases', () => {
    for (const downloadUrl of [
      'https://example.com/TwitterClear-1.2.0-arm64.apk',
      'http://github.com/someone/twitter-clear/releases/download/v1.2.0/app.apk',
      'https://github.com/someone-else/twitter-clear/releases/download/v1.2.0/app.apk',
      'https://github.com.example.com/someone/twitter-clear/releases/download/v1.2.0/app.apk',
    ]) {
      const assets = [{ name: 'app.apk', browser_download_url: downloadUrl }];
      assert.equal(parseRelease(releasePayload({ assets }), REPOSITORY), null, downloadUrl);
    }
  });

  it('rejects malformed responses', () => {
    for (const payload of [null, 'v1.2.0', [], {}, { tag_name: 'v1.2.0' }, { tag_name: 7 }]) {
      assert.equal(parseRelease(payload, REPOSITORY), null);
    }
    assert.equal(parseRelease(releasePayload({ tag_name: 'nightly' }), REPOSITORY), null);
    assert.equal(parseRelease(releasePayload({ assets: [null, 'app.apk'] }), REPOSITORY), null);
  });
});

describe('findUpdate', () => {
  it('returns the release when it is newer than the installed version', () => {
    assert.equal(findUpdate(releasePayload(), REPOSITORY, '1.1.9')?.version, '1.2.0');
  });

  it('returns nothing when the install is current or ahead', () => {
    assert.equal(findUpdate(releasePayload(), REPOSITORY, '1.2.0'), null);
    assert.equal(findUpdate(releasePayload(), REPOSITORY, '1.3.0'), null);
  });
});
