import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

test('config가 기본값을 가진다', () => {
  assert.equal(typeof config.port, 'number');
  assert.equal(config.geminiTextModel.length > 0, true);
  assert.ok(config.dataDir.endsWith('data'));
});
