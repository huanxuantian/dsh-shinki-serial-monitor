import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLevel, LEVEL_FOREGROUND } from '../lib/levels.js';

test('ulog tag', () => {
  assert.equal(detectLevel('[W/tag] message'), 'W');
  assert.equal(detectLevel('[D/uart] data'), 'D');
});

test('angle / square markers', () => {
  assert.equal(detectLevel('<ERROR> boom'), 'E');
  assert.equal(detectLevel('[E] fatal'), 'E');
  assert.equal(detectLevel('[I] info'), 'I');
});

test('keyword prefix', () => {
  assert.equal(detectLevel('WARN: low voltage'), 'W');
  assert.equal(detectLevel('ERROR: link down'), 'E');
});

test('inline keywords', () => {
  assert.equal(detectLevel('something failed here'), 'E');
  assert.equal(detectLevel('please be careful warning'), 'W');
  assert.equal(detectLevel('debug info printed'), 'D');
});

test('default is INFO', () => {
  assert.equal(detectLevel('plain line'), 'I');
  assert.equal(detectLevel(''), 'I');
});

test('color table complete', () => {
  assert.deepEqual(Object.keys(LEVEL_FOREGROUND).sort(), ['D', 'E', 'I', 'V', 'W']);
});
