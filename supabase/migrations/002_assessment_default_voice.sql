-- Migration: Assessment Default Voice Support
-- Run this SQL in Supabase SQL Editor to add default voice support for assessments

-- Add default voice columns to assessment_assets table
ALTER TABLE assessment_assets
  ADD COLUMN IF NOT EXISTS default_voice_id TEXT,
  ADD COLUMN IF NOT EXISTS default_voice_name TEXT;
