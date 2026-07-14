import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJob, updateJob, getJob } from '../src/publisher/naverJobStore.js';

test('작업 생성·갱신·조회', () => {
  createJob('a1');
  assert.equal(getJob('a1').status, 'pending');
  updateJob('a1', 'saving');
  assert.equal(getJob('a1').status, 'saving');
  updateJob('a1', 'done', '임시저장 완료');
  assert.equal(getJob('a1').status, 'done');
  assert.equal(getJob('a1').message, '임시저장 완료');
});

test('없는 작업 갱신은 조용히 무시, 조회는 undefined', () => {
  updateJob('nope', 'done');
  assert.equal(getJob('nope'), undefined);
});
