import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getIconSvg, ICON_NAMES } from '../src/renderer/icons.js';

test('알려진 아이콘은 svg 태그를 반환한다', () => {
  const svg = getIconSvg('building', { size: 72, color: '#12202b' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('width="72"'));
  assert.ok(svg.includes('#12202b'));
});

test('알 수 없는 아이콘은 빈 문자열을 반환한다', () => {
  assert.equal(getIconSvg('not-a-real-icon'), '');
});

test('빈 문자열/undefined도 안전하게 처리한다', () => {
  assert.equal(getIconSvg(''), '');
  assert.equal(getIconSvg(undefined), '');
});

test('ICON_NAMES에 8개 아이콘이 정의되어 있다', () => {
  assert.equal(ICON_NAMES.length, 8);
  assert.ok(ICON_NAMES.includes('trend-up'));
  assert.ok(ICON_NAMES.includes('percent'));
});
