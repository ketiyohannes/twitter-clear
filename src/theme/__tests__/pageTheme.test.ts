import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDarkColor, parseThemeMessage } from '../pageTheme.ts';

describe('isDarkColor', () => {
  it('recognizes the three X themes', () => {
    assert.equal(isDarkColor('rgb(255, 255, 255)'), false); // Default
    assert.equal(isDarkColor('rgb(21, 32, 43)'), true); // Dim
    assert.equal(isDarkColor('rgb(0, 0, 0)'), true); // Lights out
  });

  it('accepts hex and modern rgb notations', () => {
    assert.equal(isDarkColor('#000000'), true);
    assert.equal(isDarkColor('#FFFFFF'), false);
    assert.equal(isDarkColor('rgba(21, 32, 43, 1)'), true);
    assert.equal(isDarkColor('rgb(21 32 43)'), true);
  });

  it('treats unknown colors as light', () => {
    assert.equal(isDarkColor('transparent'), false);
  });
});

describe('parseThemeMessage', () => {
  it('extracts the background color from a theme message', () => {
    const data = JSON.stringify({ type: 'theme', backgroundColor: 'rgb(21, 32, 43)' });
    assert.equal(parseThemeMessage(data), 'rgb(21, 32, 43)');
  });

  it('ignores messages that are malformed or of another type', () => {
    assert.equal(parseThemeMessage('not json'), null);
    assert.equal(parseThemeMessage('null'), null);
    assert.equal(parseThemeMessage(JSON.stringify({ type: 'other' })), null);
    assert.equal(parseThemeMessage(JSON.stringify({ type: 'theme', backgroundColor: 7 })), null);
    assert.equal(
      parseThemeMessage(JSON.stringify({ type: 'theme', backgroundColor: 'url(javascript:1)' })),
      null,
    );
  });
});
