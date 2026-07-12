import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCardHtml } from '../src/renderer/templates.js';

test('cover 템플릿에 제목·페이지 표시가 들어간다', () => {
  const html = renderCardHtml({ template: 'cover', title: '기준금리 동결', body: '' }, { seq: 1, total: 5, bgDataUri: null });
  assert.ok(html.includes('기준금리 동결'));
  assert.ok(html.includes('1080'));
  assert.ok(html.includes('1 / 5'));
});

test('HTML 특수문자 이스케이프', () => {
  const html = renderCardHtml({ template: 'text', title: 'a<b>', body: '' }, { seq: 2, total: 5, bgDataUri: null });
  assert.ok(!html.includes('<h2>a<b></h2>'));
  assert.ok(html.includes('a&lt;b&gt;'));
});

test('배경 데이터 URI가 있으면 bg div가 들어간다', () => {
  const html = renderCardHtml({ template: 'data', title: '추이', dataLabel: '2.5%', body: '' }, { seq: 3, total: 5, bgDataUri: 'data:image/png;base64,AAA' });
  assert.ok(html.includes('class="bg"'));
  assert.ok(html.includes('2.5%'));
});
