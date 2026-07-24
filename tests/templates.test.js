import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCardHtml } from '../src/renderer/templates.js';

test('cover 템플릿에 제목·페이지 표시가 들어간다', () => {
  const html = renderCardHtml({ template: 'cover', title: '기준금리 동결', body: '' }, { seq: 1, total: 5 });
  assert.ok(html.includes('기준금리 동결'));
  assert.ok(html.includes('1080'));
  assert.ok(html.includes('1 / 5'));
});

test('HTML 특수문자 이스케이프', () => {
  const html = renderCardHtml({ template: 'text', title: 'a<b>', body: '' }, { seq: 2, total: 5 });
  assert.ok(!html.includes('<h2>a<b></h2>'));
  assert.ok(html.includes('a&lt;b&gt;'));
});

test('tag가 있으면 색상 클래스와 텍스트가 들어간다', () => {
  const html = renderCardHtml(
    { template: 'cover', title: '헤드라인', body: '', tag: { text: '긴급속보', color: 'red' } },
    { seq: 1, total: 3 }
  );
  assert.ok(html.includes('class="tag red"'));
  assert.ok(html.includes('긴급속보'));
});

test('tag가 없으면 tag div가 렌더링되지 않는다', () => {
  const html = renderCardHtml({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 1 });
  assert.ok(!html.includes('class="tag'));
});

test('source가 있으면 출처 문구가 들어간다', () => {
  const html = renderCardHtml(
    { template: 'data', title: '환율', dataLabel: '1,495원', source: '* 출처: 하나은행' },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('* 출처: 하나은행'));
});

test('data 카드는 dataColor에 맞는 클래스로 큰 숫자를 강조한다', () => {
  const html = renderCardHtml(
    { template: 'data', title: '환율', dataLabel: '1,495원', dataColor: 'red' },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('class="big-stat red"'));
  assert.ok(html.includes('1,495원'));
});

test('data 카드는 rows가 있으면 미니 표를 렌더링한다', () => {
  const html = renderCardHtml(
    { template: 'data', title: '환율', dataLabel: '1,495원', rows: [{ label: '현찰 살 때', value: '1,521.77' }] },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('현찰 살 때'));
  assert.ok(html.includes('1,521.77'));
});

test('chart 카드는 캔버스와 Chart 인스턴스 스크립트를 포함한다', () => {
  const html = renderCardHtml(
    { template: 'chart', title: '기준금리 추이', chartType: 'line', labels: ['1월', '2월'], values: [3.0, 2.75], unit: '%' },
    { seq: 2, total: 5, chartLibJs: '/* chartjs */' }
  );
  assert.ok(html.includes('<canvas'));
  assert.ok(html.includes('new Chart('));
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

test('table 카드는 columns가 없으면 순위·이름·값·증감을 행으로 렌더링한다', () => {
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
});

test('table 카드는 columns가 있으면 헤더 있는 그리드 표를 렌더링한다', () => {
  const html = renderCardHtml(
    { template: 'table', title: '분양가', columns: ['주택형', '평형', '분양가'],
      rows: [['51', '22평', '5.9억'], ['55', '24평', '6.4억']] },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('class="grid-table"'));
  assert.ok(html.includes('<th>주택형</th>'));
  assert.ok(html.includes('<td>5.9억</td>'));
});

test('subscription 카드는 지역·총세대수·접수기간·발표일을 렌더링한다', () => {
  const html = renderCardHtml(
    {
      template: 'subscription', title: '남양주왕숙 A-24블록', region: '경기', totalSupply: '390세대',
      receiptStart: '2025.12.08', receiptEnd: '2025.12.12', winnerDate: '2025.12.24',
    },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('남양주왕숙 A-24블록'));
  assert.ok(html.includes('경기'));
  assert.ok(html.includes('390세대'));
  assert.ok(html.includes('2025.12.08'));
  assert.ok(html.includes('2025.12.12'));
  assert.ok(html.includes('2025.12.24'));
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

test('text 카드는 bullets가 있으면 체크리스트로 렌더링한다', () => {
  const html = renderCardHtml(
    { template: 'text', title: '핵심 요약', bullets: ['입주 2029년 2월', '분양가상한제 적용'] },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('bullet-item'));
  assert.ok(html.includes('입주 2029년 2월'));
});

test('모든 카드는 렌더 완료 신호를 포함한다', () => {
  const html = renderCardHtml({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 1 });
  assert.ok(html.includes('window.__ready = true'));
});

test('chart 카드에서 labels/values의 </script> 이스케이프로 HTML 주입 방지', () => {
  const html = renderCardHtml(
    { template: 'chart', title: '테스트', chartType: 'line', labels: ['안전</script>한<레이블', '정상'], values: [1, 2], unit: '단위' },
    { seq: 1, total: 1, chartLibJs: '/* chartjs */' }
  );
  // 스크립트 블록 내에서 labels/values가 들어갈 부분 추출 (new Chart 호출 부분)
  const scriptStart = html.indexOf('new Chart(');
  const scriptEnd = html.indexOf('</script>', scriptStart);
  assert.ok(scriptStart >= 0, '차트 script 블록이 있어야 함');
  assert.ok(scriptEnd >= 0, '차트 script 블록의 끝이 있어야 함');

  const chartScriptSection = html.substring(scriptStart, scriptEnd);
  // 스크립트 내에서 raw </script> 패턴이 없어야 함 (escape됨)
  assert.ok(!chartScriptSection.includes('</script>'), 'labels/values 내 </script>는 이스케이프되어야 함');
  assert.ok(chartScriptSection.includes('\\u003c'), 'escape 시퀀스가 포함되어야 함');
});
