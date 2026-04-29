const { test } = require('node:test');
const assert = require('node:assert/strict');

const { narrationTypeToCode } = require('./narrationParser');

test('narrationTypeToCode maps slide_narration to NAR1', () => {
  assert.equal(narrationTypeToCode('slide_narration'), 'NAR1');
});

test('narrationTypeToCode maps known answer types', () => {
  assert.equal(narrationTypeToCode('answer_a'), 'ANS_A');
  assert.equal(narrationTypeToCode('answer_f'), 'ANS_F');
});

test('narrationTypeToCode maps two-part question codes', () => {
  assert.equal(narrationTypeToCode('part_a_question'), 'PA_Q');
  assert.equal(narrationTypeToCode('part_b_answer_d'), 'PB_D');
});

test('narrationTypeToCode falls back to NAR1 for unknown types', () => {
  assert.equal(narrationTypeToCode('not_a_real_type'), 'NAR1');
});
