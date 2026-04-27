-- 007_lessons_v2.sql
-- Add unified lessons table for v2 push contract.
-- Additive: existing asset_lists and assessment_assets tables remain.

CREATE TABLE IF NOT EXISTS lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('session', 'session_rcp', 'pre_test', 'post_test')),
  lesson_label TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  career_character_ref TEXT,
  slides_json JSONB NOT NULL,
  default_voice_id TEXT,
  default_voice_name TEXT,
  cms_page_mapping JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_name, lesson_type, lesson_label)
);

CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_name);

ALTER TABLE generated_images
  ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE;

ALTER TABLE generated_audio
  ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_generated_images_lesson ON generated_images (lesson_id);
CREATE INDEX IF NOT EXISTS idx_generated_audio_lesson ON generated_audio (lesson_id);

-- Match project convention: enable RLS with a permissive policy.
-- Server uses service key (bypasses RLS); policy keeps surface area consistent.
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for service role" ON lessons;
CREATE POLICY "Allow all for service role" ON lessons FOR ALL USING (true);
