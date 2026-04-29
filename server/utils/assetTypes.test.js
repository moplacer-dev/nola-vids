const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isVisualAssetType, VISUAL_ASSET_TYPES } = require('./assetTypes');

test('isVisualAssetType returns true for ai_image', () => {
  assert.equal(isVisualAssetType({ type: 'ai_image' }), true);
});

test('isVisualAssetType returns true for ai_video_clip', () => {
  assert.equal(isVisualAssetType({ type: 'ai_video_clip' }), true);
});

test('isVisualAssetType returns true for procedure_video', () => {
  assert.equal(isVisualAssetType({ type: 'procedure_video' }), true);
});

test('isVisualAssetType returns true for screen_recording', () => {
  assert.equal(isVisualAssetType({ type: 'screen_recording' }), true);
});

test('isVisualAssetType returns true for interactive_element', () => {
  assert.equal(isVisualAssetType({ type: 'interactive_element' }), true);
});

test('isVisualAssetType returns true for reused_asset', () => {
  assert.equal(isVisualAssetType({ type: 'reused_asset' }), true);
});

test('isVisualAssetType returns true for production_still_image (5B.1)', () => {
  assert.equal(isVisualAssetType({ type: 'production_still_image' }), true);
});

test('isVisualAssetType returns false for tts', () => {
  assert.equal(isVisualAssetType({ type: 'tts' }), false);
});

test('isVisualAssetType returns false for retired motion_graphics_scene', () => {
  assert.equal(isVisualAssetType({ type: 'motion_graphics_scene' }), false);
});

test('isVisualAssetType returns false for unknown type strings', () => {
  assert.equal(isVisualAssetType({ type: 'something_new' }), false);
  assert.equal(isVisualAssetType({ type: '' }), false);
});

test('isVisualAssetType returns false for missing or non-string type', () => {
  assert.equal(isVisualAssetType({}), false);
  assert.equal(isVisualAssetType({ type: null }), false);
  assert.equal(isVisualAssetType({ type: undefined }), false);
  assert.equal(isVisualAssetType({ type: 42 }), false);
});

test('isVisualAssetType returns false for null or undefined asset', () => {
  assert.equal(isVisualAssetType(null), false);
  assert.equal(isVisualAssetType(undefined), false);
});

test('VISUAL_ASSET_TYPES contains exactly the wire-format types Carl emits', () => {
  assert.deepEqual(
    [...VISUAL_ASSET_TYPES].sort(),
    [
      'ai_image',
      'ai_video_clip',
      'interactive_element',
      'procedure_video',
      'production_still_image',  // 5B.1
      'reused_asset',
      'screen_recording',
    ]
  );
});
