-- NOLA.vids Supabase Schema
-- Run this SQL in Supabase SQL Editor to create all required tables

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- Jobs Table
-- Tracks video generation jobs
-- ==========================================
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  operation_data JSONB,
  operation_name TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

-- ==========================================
-- Videos Table
-- Generated video metadata
-- ==========================================
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  title TEXT,
  folder TEXT,
  source_uri TEXT,
  module_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_job_id ON videos(job_id);
CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder);

-- ==========================================
-- Folders Table
-- Video organization folders
-- ==========================================
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- Characters Table
-- Character definitions with reference images
-- ==========================================
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  character_name TEXT NOT NULL,
  career TEXT,
  appearance_description TEXT,
  anchor_image_path TEXT,
  reference_images JSONB DEFAULT '[]',
  appears_on_slides JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(module_name, character_name)
);

CREATE INDEX IF NOT EXISTS idx_characters_module ON characters(module_name);

-- ==========================================
-- Asset Lists Table
-- Carl v7 imports with slides and assets
-- ==========================================
CREATE TABLE IF NOT EXISTS asset_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  session_number INTEGER,
  session_type TEXT DEFAULT 'regular',
  session_title TEXT,
  assets_json JSONB NOT NULL DEFAULT '[]',
  slides_json JSONB,
  career_character_json JSONB,
  default_voice_id TEXT,
  default_voice_name TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_lists_module ON asset_lists(module_name);
CREATE INDEX IF NOT EXISTS idx_asset_lists_session ON asset_lists(module_name, session_number);

-- Unique constraint on module_name, session_number, session_type
-- This allows "Session 2" and "Session 2 RCP" to coexist
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_lists_unique_session
  ON asset_lists(module_name, session_number, session_type);

-- ==========================================
-- Generated Images Table
-- Image generation records
-- ==========================================
CREATE TABLE IF NOT EXISTS generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_list_id UUID REFERENCES asset_lists(id) ON DELETE CASCADE,
  slide_number INTEGER,
  asset_type TEXT,
  asset_number INTEGER DEFAULT 1,
  cms_filename TEXT,
  original_prompt TEXT,
  modified_prompt TEXT,
  character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  image_path TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_images_asset_list ON generated_images(asset_list_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_status ON generated_images(status);

-- ==========================================
-- Generation History Table
-- Regeneration tracking
-- ==========================================
CREATE TABLE IF NOT EXISTS generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_image_id UUID REFERENCES generated_images(id) ON DELETE CASCADE,
  prompt TEXT,
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_history_image ON generation_history(generated_image_id);

-- ==========================================
-- Motion Graphics Videos Table
-- MG video records (one per slide)
-- ==========================================
CREATE TABLE IF NOT EXISTS motion_graphics_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_list_id UUID REFERENCES asset_lists(id) ON DELETE CASCADE,
  slide_number INTEGER NOT NULL,
  cms_filename TEXT,
  video_path TEXT,
  status TEXT DEFAULT 'pending',
  scene_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(asset_list_id, slide_number)
);

CREATE INDEX IF NOT EXISTS idx_mg_videos_asset_list ON motion_graphics_videos(asset_list_id);

-- ==========================================
-- Generated Audio Table
-- TTS audio records (supports multi-part narration)
-- ==========================================
CREATE TABLE IF NOT EXISTS generated_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_list_id UUID REFERENCES asset_lists(id) ON DELETE CASCADE,
  assessment_asset_id UUID REFERENCES assessment_assets(id) ON DELETE CASCADE,
  slide_number INTEGER,
  question_number INTEGER,
  narration_type TEXT DEFAULT 'slide_narration',
  cms_filename TEXT,
  narration_text TEXT,
  voice_id TEXT,
  voice_name TEXT,
  audio_path TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite unique constraint for multi-part audio
-- For asset lists: unique by asset_list_id, slide_number, narration_type
-- For assessments: unique by assessment_asset_id, question_number, narration_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_audio_asset_list_slide_type
  ON generated_audio(asset_list_id, slide_number, narration_type)
  WHERE asset_list_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_audio_assessment_question_type
  ON generated_audio(assessment_asset_id, question_number, narration_type)
  WHERE assessment_asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generated_audio_asset_list ON generated_audio(asset_list_id);
CREATE INDEX IF NOT EXISTS idx_generated_audio_assessment ON generated_audio(assessment_asset_id);
CREATE INDEX IF NOT EXISTS idx_generated_audio_status ON generated_audio(status);
CREATE INDEX IF NOT EXISTS idx_generated_audio_narration_type ON generated_audio(narration_type);

-- ==========================================
-- Row Level Security (RLS) Policies
-- For now, allow all operations (app uses service key)
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE motion_graphics_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_audio ENABLE ROW LEVEL SECURITY;

-- Create policies that allow all operations for authenticated users (service key bypasses RLS)
-- These are permissive for the service role
CREATE POLICY "Allow all for service role" ON jobs FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON videos FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON folders FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON characters FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON asset_lists FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON generated_images FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON generation_history FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON motion_graphics_videos FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON generated_audio FOR ALL USING (true);

-- ==========================================
-- Assessment Assets Table
-- Pre-Test/Post-Test question data from Carl v7
-- ==========================================
CREATE TABLE IF NOT EXISTS assessment_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL,
  assessment_type TEXT NOT NULL CHECK (assessment_type IN ('pre_test', 'post_test')),
  subject TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  questions_json JSONB NOT NULL DEFAULT '[]',
  asset_summary_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(module_name, assessment_type)
);

CREATE INDEX IF NOT EXISTS idx_assessment_assets_module ON assessment_assets(module_name);
CREATE INDEX IF NOT EXISTS idx_assessment_assets_type ON assessment_assets(assessment_type);

-- Add assessment_asset_id to generated_images for assessment visuals
ALTER TABLE generated_images
  ADD COLUMN IF NOT EXISTS assessment_asset_id UUID REFERENCES assessment_assets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_generated_images_assessment ON generated_images(assessment_asset_id);

-- Enable RLS on assessment_assets
ALTER TABLE assessment_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON assessment_assets FOR ALL USING (true);

-- ==========================================
-- Storage Buckets (create these in Supabase dashboard)
-- ==========================================
-- Required buckets:
-- - videos (public) - Generated videos (.mp4)
-- - images (public) - Generated images (.png, .jpg)
-- - anchors (public) - Character reference images
-- - mg-videos (public) - Motion graphics videos
-- - audio (public) - Generated TTS audio (.mp3)
-- - uploads (private) - Temporary uploads
-- - defaults (public) - Template images (cleanup.png, lab_safety.png)

-- Note: Storage buckets must be created via Supabase dashboard or API
-- After creating buckets, enable public access for: videos, images, anchors, mg-videos, audio, defaults
