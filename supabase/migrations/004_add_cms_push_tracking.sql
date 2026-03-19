-- Migration: Add CMS push tracking columns
-- Track when assets are pushed to Directus CMS

-- Add CMS push tracking to generated_images
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS cms_file_id UUID;
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS cms_push_status TEXT DEFAULT 'pending';
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS cms_pushed_at TIMESTAMPTZ;

-- Add CMS push tracking to generated_audio
ALTER TABLE generated_audio ADD COLUMN IF NOT EXISTS cms_file_id UUID;
ALTER TABLE generated_audio ADD COLUMN IF NOT EXISTS cms_push_status TEXT DEFAULT 'pending';
ALTER TABLE generated_audio ADD COLUMN IF NOT EXISTS cms_pushed_at TIMESTAMPTZ;

-- Add CMS push tracking to motion_graphics_videos
ALTER TABLE motion_graphics_videos ADD COLUMN IF NOT EXISTS cms_file_id UUID;
ALTER TABLE motion_graphics_videos ADD COLUMN IF NOT EXISTS cms_push_status TEXT DEFAULT 'pending';
ALTER TABLE motion_graphics_videos ADD COLUMN IF NOT EXISTS cms_pushed_at TIMESTAMPTZ;

-- Create indexes for efficient querying of push status
CREATE INDEX IF NOT EXISTS idx_generated_images_cms_push_status ON generated_images(cms_push_status);
CREATE INDEX IF NOT EXISTS idx_generated_audio_cms_push_status ON generated_audio(cms_push_status);
CREATE INDEX IF NOT EXISTS idx_motion_graphics_videos_cms_push_status ON motion_graphics_videos(cms_push_status);
