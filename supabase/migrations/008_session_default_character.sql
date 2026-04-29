-- 008_session_default_character.sql
-- Adds default_character_id to asset_lists and assessment_assets so each
-- session/assessment can designate one canonical character (mirrors the
-- existing default_voice_id pattern).

ALTER TABLE asset_lists
  ADD COLUMN IF NOT EXISTS default_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;

ALTER TABLE assessment_assets
  ADD COLUMN IF NOT EXISTS default_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_asset_lists_default_character
  ON asset_lists(default_character_id);
CREATE INDEX IF NOT EXISTS idx_assessment_assets_default_character
  ON assessment_assets(default_character_id);
