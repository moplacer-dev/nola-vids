-- Migration: Multi-Part Narration Support
-- Run this SQL in Supabase SQL Editor to add multi-part narration support

-- Add new columns to generated_audio table
ALTER TABLE generated_audio
  ADD COLUMN IF NOT EXISTS assessment_asset_id UUID REFERENCES assessment_assets(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS question_number INTEGER,
  ADD COLUMN IF NOT EXISTS narration_type TEXT DEFAULT 'slide_narration';

-- Make slide_number nullable (assessments use question_number instead)
ALTER TABLE generated_audio
  ALTER COLUMN slide_number DROP NOT NULL;

-- Drop the old unique constraint if it exists
ALTER TABLE generated_audio DROP CONSTRAINT IF EXISTS generated_audio_asset_list_id_slide_number_key;

-- Create new composite unique indexes for multi-part audio
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_audio_asset_list_slide_type
  ON generated_audio(asset_list_id, slide_number, narration_type)
  WHERE asset_list_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_audio_assessment_question_type
  ON generated_audio(assessment_asset_id, question_number, narration_type)
  WHERE assessment_asset_id IS NOT NULL;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_generated_audio_assessment ON generated_audio(assessment_asset_id);
CREATE INDEX IF NOT EXISTS idx_generated_audio_narration_type ON generated_audio(narration_type);

-- Update existing records to have the default narration_type
UPDATE generated_audio
SET narration_type = 'slide_narration'
WHERE narration_type IS NULL;
