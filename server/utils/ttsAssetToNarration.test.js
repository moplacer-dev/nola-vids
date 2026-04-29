const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mapTtsAssetsToNarrations } = require('./ttsAssetToNarration');

// ---- main_narration -------------------------------------------------------

test('main_narration on a slide without choices maps to slide_narration', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'main_narration', ttsText: 'Welcome to phase changes.', ttsOrder: 1 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'slide_narration', narrationText: 'Welcome to phase changes.' },
  ]);
});

test('main_narration on a slide with answer_choice siblings maps to question', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'A', ttsText: 'Solid', ttsOrder: 1 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'B', ttsText: 'Liquid', ttsOrder: 2 },
    { type: 'tts', ttsType: 'main_narration', ttsText: 'Which state is water at room temp?', ttsOrder: 3 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'answer_a', narrationText: 'Solid' },
    { narrationType: 'answer_b', narrationText: 'Liquid' },
    { narrationType: 'question', narrationText: 'Which state is water at room temp?' },
  ]);
});

test('isAssessment forces main_narration to question even without answer_choice siblings', () => {
  const out = mapTtsAssetsToNarrations(
    [{ type: 'tts', ttsType: 'main_narration', ttsText: 'Stem text only.', ttsOrder: 1 }],
    { isAssessment: true }
  );
  assert.deepEqual(out, [
    { narrationType: 'question', narrationText: 'Stem text only.' },
  ]);
});

// ---- answer_choice --------------------------------------------------------

test('answer_choice maps label A-D to lowercase answer_a/answer_b/...', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'A', ttsText: 'A text', ttsOrder: 1 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'B', ttsText: 'B text', ttsOrder: 2 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'C', ttsText: 'C text', ttsOrder: 3 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'D', ttsText: 'D text', ttsOrder: 4 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'answer_a', narrationText: 'A text' },
    { narrationType: 'answer_b', narrationText: 'B text' },
    { narrationType: 'answer_c', narrationText: 'C text' },
    { narrationType: 'answer_d', narrationText: 'D text' },
  ]);
});

test('answer_choice without ttsLabel is skipped', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'answer_choice', ttsText: 'orphan choice', ttsOrder: 1 },
  ]);
  assert.deepEqual(out, []);
});

// ---- correct / incorrect_response -----------------------------------------

test('correct_response maps to correct_response', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'correct_response', ttsText: 'Right answer feedback', ttsOrder: 1 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'correct_response', narrationText: 'Right answer feedback' },
  ]);
});

test('incorrect_response chunks count up by appearance order: incorrect_1, incorrect_2', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'correct_response', ttsText: 'Correct.', ttsOrder: 5 },
    { type: 'tts', ttsType: 'incorrect_response', ttsText: 'First wrong.', ttsOrder: 6 },
    { type: 'tts', ttsType: 'incorrect_response', ttsText: 'Second wrong.', ttsOrder: 7 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'correct_response', narrationText: 'Correct.' },
    { narrationType: 'incorrect_1', narrationText: 'First wrong.' },
    { narrationType: 'incorrect_2', narrationText: 'Second wrong.' },
  ]);
});

// ---- full RCP / Apply slide -----------------------------------------------

test('full RCP slide fans out to question + answer_a..d + correct + incorrect_1 + incorrect_2', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'A', ttsText: 'A', ttsOrder: 1 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'B', ttsText: 'B', ttsOrder: 2 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'C', ttsText: 'C', ttsOrder: 3 },
    { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'D', ttsText: 'D', ttsOrder: 4 },
    { type: 'tts', ttsType: 'main_narration', ttsText: 'Question stem', ttsOrder: 5 },
    { type: 'tts', ttsType: 'correct_response', ttsText: 'Correct feedback', ttsOrder: 6 },
    { type: 'tts', ttsType: 'incorrect_response', ttsText: 'First incorrect feedback', ttsOrder: 7 },
    { type: 'tts', ttsType: 'incorrect_response', ttsText: 'Second incorrect feedback', ttsOrder: 8 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'answer_a', narrationText: 'A' },
    { narrationType: 'answer_b', narrationText: 'B' },
    { narrationType: 'answer_c', narrationText: 'C' },
    { narrationType: 'answer_d', narrationText: 'D' },
    { narrationType: 'question', narrationText: 'Question stem' },
    { narrationType: 'correct_response', narrationText: 'Correct feedback' },
    { narrationType: 'incorrect_1', narrationText: 'First incorrect feedback' },
    { narrationType: 'incorrect_2', narrationText: 'Second incorrect feedback' },
  ]);
});

// ---- two-part assessment --------------------------------------------------

test('two-part assessment prefixes question and answer_* with part_a_/part_b_', () => {
  const out = mapTtsAssetsToNarrations(
    [
      { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'A', ttsText: 'A choice partA', ttsOrder: 1, partLabel: 'A' },
      { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'B', ttsText: 'B choice partA', ttsOrder: 2, partLabel: 'A' },
      { type: 'tts', ttsType: 'main_narration', ttsText: 'Part A stem', ttsOrder: 3, partLabel: 'A' },
      { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'A', ttsText: 'A choice partB', ttsOrder: 4, partLabel: 'B' },
      { type: 'tts', ttsType: 'answer_choice', ttsLabel: 'B', ttsText: 'B choice partB', ttsOrder: 5, partLabel: 'B' },
      { type: 'tts', ttsType: 'main_narration', ttsText: 'Part B stem', ttsOrder: 6, partLabel: 'B' },
    ],
    { isAssessment: true, isTwoPart: true }
  );
  assert.deepEqual(out, [
    { narrationType: 'part_a_answer_a', narrationText: 'A choice partA' },
    { narrationType: 'part_a_answer_b', narrationText: 'B choice partA' },
    { narrationType: 'part_a_question', narrationText: 'Part A stem' },
    { narrationType: 'part_b_answer_a', narrationText: 'A choice partB' },
    { narrationType: 'part_b_answer_b', narrationText: 'B choice partB' },
    { narrationType: 'part_b_question', narrationText: 'Part B stem' },
  ]);
});

// ---- skip / defensive cases ----------------------------------------------

test('popup_narration maps ttsLabel to popup_N narrationType', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'main_narration', ttsText: 'Lead in', ttsOrder: 1 },
    { type: 'tts', ttsType: 'popup_narration', ttsLabel: '1', ttsText: 'Popup 1 body', ttsOrder: 2 },
    { type: 'tts', ttsType: 'popup_narration', ttsLabel: '2', ttsText: 'Popup 2 body', ttsOrder: 3 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'slide_narration', narrationText: 'Lead in' },
    { narrationType: 'popup_1', narrationText: 'Popup 1 body' },
    { narrationType: 'popup_2', narrationText: 'Popup 2 body' },
  ]);
});

test('popup_narration without ttsLabel is skipped', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'popup_narration', ttsText: 'orphan popup', ttsOrder: 1 },
  ]);
  assert.deepEqual(out, []);
});

test('non-tts rows are ignored (visual ingest is a separate path)', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'ai_image', prompt: 'a diagram' },
    { type: 'tts', ttsType: 'main_narration', ttsText: 'narration only', ttsOrder: 1 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'slide_narration', narrationText: 'narration only' },
  ]);
});

test('empty or whitespace ttsText is dropped', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'main_narration', ttsText: '   ', ttsOrder: 1 },
    { type: 'tts', ttsType: 'main_narration', ttsText: '', ttsOrder: 2 },
  ]);
  assert.deepEqual(out, []);
});

test('null/undefined input returns empty', () => {
  assert.deepEqual(mapTtsAssetsToNarrations(null), []);
  assert.deepEqual(mapTtsAssetsToNarrations(undefined), []);
  assert.deepEqual(mapTtsAssetsToNarrations([]), []);
});

test('unknown ttsType is skipped without throwing', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'something_new', ttsText: 'unknown', ttsOrder: 1 },
    { type: 'tts', ttsType: 'main_narration', ttsText: 'known', ttsOrder: 2 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'slide_narration', narrationText: 'known' },
  ]);
});

test('text is trimmed before storing', () => {
  const out = mapTtsAssetsToNarrations([
    { type: 'tts', ttsType: 'main_narration', ttsText: '  padded narration  ', ttsOrder: 1 },
  ]);
  assert.deepEqual(out, [
    { narrationType: 'slide_narration', narrationText: 'padded narration' },
  ]);
});
