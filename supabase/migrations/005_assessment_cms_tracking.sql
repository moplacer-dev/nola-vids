-- Add CMS sync tracking to assessment_assets table
-- This migration adds a column to map question numbers to CMS page IDs for Pre/Post tests

ALTER TABLE assessment_assets
  ADD COLUMN IF NOT EXISTS cms_page_mapping JSONB DEFAULT '{}';

-- Index for queries on cms_page_mapping
CREATE INDEX IF NOT EXISTS idx_assessment_assets_cms_mapping
  ON assessment_assets USING gin (cms_page_mapping);

COMMENT ON COLUMN assessment_assets.cms_page_mapping IS 'Maps question_number to CMS content_page id for sync tracking. For two-part questions, uses "N" for Part A and "Nb" for Part B';
