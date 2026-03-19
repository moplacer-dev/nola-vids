-- Add CMS sync tracking to asset_lists table
-- This migration adds a column to map NOLA.vids slide numbers to CMS page IDs

ALTER TABLE asset_lists
  ADD COLUMN IF NOT EXISTS cms_page_mapping JSONB DEFAULT '{}';

-- Index for queries on cms_page_mapping
CREATE INDEX IF NOT EXISTS idx_asset_lists_cms_mapping
  ON asset_lists USING gin (cms_page_mapping);

COMMENT ON COLUMN asset_lists.cms_page_mapping IS 'Maps slide_number to CMS content_page id for sync tracking';
