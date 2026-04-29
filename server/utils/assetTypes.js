// Visual asset-type whitelist for the v1 /asset-lists ingest path.
//
// The visual-asset loops in routes.js create generated_images records keyed
// off asset.type. Without a whitelist they would consume any asset row Carl
// emits, including tts and any future non-visual types, and produce broken
// generated_images rows. This filter is the defensive guard.
//
// Members are the wire-format type values Carl currently emits from
// transform_asset_list_for_nola() (carl_v7/step_16_media_asset_list/
// nola_client.py:907-1062). motion_graphics_scene was a legacy primary_media
// fallback and is intentionally retired. tts is intentionally excluded —
// that is the entire reason this guard exists; tts rows route through the
// narration ingest path, not this loop.
//
// Sub-phases 5B.1 / 5B.2 / 5B.3 of the narration fan-out plan extend this
// set with production_still_image, default_template, and demo_video as
// the matching Carl-side dispatch branches land.

const VISUAL_ASSET_TYPES = new Set([
  'ai_image',
  'ai_video_clip',
  'procedure_video',
  'screen_recording',
  'interactive_element',
  'reused_asset',
]);

function isVisualAssetType(asset) {
  if (!asset || typeof asset.type !== 'string') return false;
  return VISUAL_ASSET_TYPES.has(asset.type);
}

module.exports = { isVisualAssetType, VISUAL_ASSET_TYPES };
