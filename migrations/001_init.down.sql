-- ============================================
-- IMGABLE DATABASE SCHEMA ROLLBACK
-- Drops all tables, views, functions, triggers, and extensions
-- WARNING: This will destroy all data
-- ============================================

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS people_groups;

-- Drop triggers
DROP TRIGGER IF EXISTS photos_add_to_ai_queue ON photos;
DROP TRIGGER IF EXISTS photos_place_album_sync ON photos;
DROP TRIGGER IF EXISTS photos_favorites_sync ON photos;
DROP TRIGGER IF EXISTS photo_tags_count_trigger ON photo_tags;
DROP TRIGGER IF EXISTS photo_faces_count_trigger ON photo_faces;
DROP TRIGGER IF EXISTS photos_place_count_trigger ON photos;
DROP TRIGGER IF EXISTS album_photos_count_trigger ON album_photos;
DROP TRIGGER IF EXISTS faces_updated_at ON faces;
DROP TRIGGER IF EXISTS persons_updated_at ON persons;
DROP TRIGGER IF EXISTS ai_tags_updated_at ON ai_tags;
DROP TRIGGER IF EXISTS albums_updated_at ON albums;
DROP TRIGGER IF EXISTS places_updated_at ON places;
DROP TRIGGER IF EXISTS photos_updated_at ON photos;

-- Drop functions
DROP FUNCTION IF EXISTS add_to_ai_queue();
DROP FUNCTION IF EXISTS sync_place_album();
DROP FUNCTION IF EXISTS sync_favorites_album();
DROP FUNCTION IF EXISTS update_ai_tag_photo_count();
DROP FUNCTION IF EXISTS update_face_photo_count();
DROP FUNCTION IF EXISTS update_place_photo_count();
DROP FUNCTION IF EXISTS update_album_photo_count();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop tables (order matters due to foreign keys)
DROP TABLE IF EXISTS processing_state;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS shares;
DROP TABLE IF EXISTS hidden_group_photos;
DROP TABLE IF EXISTS photo_tags;
DROP TABLE IF EXISTS photo_faces;
DROP TABLE IF EXISTS album_photos;
DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS ai_queue;
DROP TABLE IF EXISTS photos;
DROP TABLE IF EXISTS ai_tags;
DROP TABLE IF EXISTS faces;
DROP TABLE IF EXISTS persons;
DROP TABLE IF EXISTS places;

-- Drop extensions
DROP EXTENSION IF EXISTS earthdistance;
DROP EXTENSION IF EXISTS cube;
