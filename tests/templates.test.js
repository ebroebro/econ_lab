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

test('chart 카드는 캔버스와 Chart 인스턴스 스크립트를 포함하고 밝은 배경이다', () => {
  const html = renderCardHtml(
    { template: 'chart', title: '기준금리 추이', chartType: 'line', labels: ['1월', '2월'], values: [3.0, 2.75], unit: '%' },
    { seq: 2, total: 5, chartLibJs: '/* chartjs */' }
  );
  assert.ok(html.includes('<canvas'));
  assert.ok(html.includes('new Chart('));
  assert.ok(html.includes('class="card light"'));
  assert.ok(html.includes('/* chartjs */'));
  assert.ok(html.includes('단위: %'));
});

test('chart 카드에 데이터가 없으면 캔버스 대신 안내 문구를 보여준다', () => {
  const html = renderCardHtml(
    { template: 'chart', title: '데이터 없음', labels: [], values: [] },
    { seq: 2, total: 5 }
  );
  assert.ok(!html.includes('<canvas'));
  assert.ok(html.includes('데이터가 없습니다'));
});

test('table 카드는 순위·이름·값·증감을 행으로 렌더링한다', () => {
  const html = renderCardHtml(
    { template: 'table', title: '거래량 순위', rows: [
      { rank: 1, label: '강남구', value: '1,204건', delta: '+12' },
      { rank: 2, label: '송파구', value: '980건', delta: '-3' },
    ] },
    { seq: 3, total: 5 }
  );
  assert.ok(html.includes('강남구'));
  assert.ok(html.includes('1,204건'));
  assert.ok(html.includes('rank-delta down')); // -3은 down 클래스
  assert.ok(html.includes('class="card light"'));
});

test('text 카드에 icon이 있으면 svg가 포함된다', () => {
  const html = renderCardHtml(
    { template: 'text', title: '금리 인상', body: '설명', icon: 'trend-up' },
    { seq: 2, total: 5 }
  );
  assert.ok(html.includes('<svg'));
});

test('icon이 없는 카드는 svg를 포함하지 않는다', () => {
  const html = renderCardHtml({ template: 'text', title: '제목', body: '본문' }, { seq: 2, total: 5 });
  assert.ok(!html.includes('<svg'));
});

test('모든 카드는 렌더 완료 신호를 포함한다', () => {
  const html = renderCardHtml({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 1 });
  assert.ok(html.includes('window.__ready = true'));
});

test('cover/outro는 여전히 다크 배경(light 클래스 없음)이다', () => {
  const html = renderCardHtml({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 1 });
  assert.ok(!html.includes('class="card light"'));
});
