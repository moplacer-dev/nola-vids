-- 006_character_views.sql
-- Add structured character views (front, three_quarter, side, back) for consistency anchoring.
-- Additive only. Existing single-image character records keep working.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS appearance_description TEXT,
  ADD COLUMN IF NOT EXISTS front_view_image_id UUID REFERENCES generated_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS three_quarter_view_image_id UUID REFERENCES generated_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS side_view_image_id UUID REFERENCES generated_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS back_view_image_id UUID REFERENCES generated_images(id) ON DELETE SET NULL;
