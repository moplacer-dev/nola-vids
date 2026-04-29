-- 009_backfill_default_character.sql
-- For sessions imported from Carl that already have a career_character_json blob,
-- set default_character_id to the matching character record by (module_name, character_name).

UPDATE asset_lists al
SET default_character_id = c.id
FROM characters c
WHERE al.career_character_json IS NOT NULL
  AND c.module_name = al.module_name
  AND c.character_name = al.career_character_json->>'name'
  AND al.default_character_id IS NULL;
