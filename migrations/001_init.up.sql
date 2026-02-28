-- ============================================
-- IMGABLE DATABASE SCHEMA
-- Version: 2.0.0
-- Description: Complete database schema for Imgable family photo gallery
--              with AI-powered face recognition, object detection, and OCR
-- ============================================

-- ============================================
-- EXTENSIONS
-- ============================================

-- Enable earthdistance for geo calculations (uses cube)
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ============================================
-- PLACES
-- Geographic locations for grouping photos
-- Created automatically during GPS processing
-- ============================================
CREATE TABLE places (
    id TEXT PRIMARY KEY,                          -- UUID or hash from coordinates

    -- Name (from Nominatim or user-defined)
    name TEXT NOT NULL,                           -- 'Moscow' / 'Central Park' / 'Home'
    name_source TEXT NOT NULL DEFAULT 'auto',     -- 'auto' (Nominatim) / 'manual' (user)

    -- Address (from Nominatim)
    country TEXT,                                 -- 'Russia'
    city TEXT,                                    -- 'Moscow'
    address TEXT,                                 -- full address if available

    -- Center coordinates of the place
    gps_lat DOUBLE PRECISION NOT NULL,            -- latitude of center
    gps_lon DOUBLE PRECISION NOT NULL,            -- longitude of center
    radius_m INT NOT NULL DEFAULT 500,            -- place radius in meters for grouping

    -- Statistics (denormalized for performance)
    photo_count INT NOT NULL DEFAULT 0,           -- number of photos in this place

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- PERSONS
-- People identified by AI face recognition
-- One person can have multiple face embeddings (different ages, angles, etc.)
-- ============================================
CREATE TABLE persons (
    id TEXT PRIMARY KEY,                          -- 'person_abc123'

    -- Name
    name TEXT NOT NULL,                           -- 'Unknown 1' → 'Эдуард'
    name_source TEXT NOT NULL DEFAULT 'auto',     -- 'auto' / 'manual'

    -- Cover face for preview (user-selected or auto-first)
    cover_face_id TEXT,                           -- FK added after photo_faces table created

    -- Statistics (denormalized for performance)
    photo_count INT NOT NULL DEFAULT 0,           -- number of photos with this person

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- FACES
-- Face embeddings belonging to a person
-- One person can have 1-100 different face embeddings
-- ============================================
CREATE TABLE faces (
    id TEXT PRIMARY KEY,                          -- 'face_abc123'

    -- Link to person
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,

    -- Face embedding for matching new faces
    embedding REAL[] NOT NULL,                    -- 512 float values from ArcFace

    -- Statistics
    photo_count INT NOT NULL DEFAULT 0,           -- number of photos with this face

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- AI TAGS
-- Objects and scenes detected by AI (NOT persons)
-- ============================================
CREATE TABLE ai_tags (
    id TEXT PRIMARY KEY,                          -- 'object_car', 'scene_beach'

    -- Tag type
    type TEXT NOT NULL,                           -- 'object' / 'scene'

    -- Name
    name TEXT NOT NULL,                           -- 'car' / 'beach' / 'sunset'

    -- Statistics (denormalized for performance)
    photo_count INT NOT NULL DEFAULT 0,           -- number of photos with this tag

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_ai_tag_type CHECK (type IN ('object', 'scene'))
);

-- ============================================
-- PHOTOS AND VIDEOS
-- Main table storing all media files
-- ============================================
CREATE TABLE photos (
    -- Identification
    id TEXT PRIMARY KEY,                          -- SHA256 first 12 chars, used in path: /ab/c1/abc123def456_s.webp
    type TEXT NOT NULL,                           -- 'photo' or 'video', determines processing and display logic
    status TEXT NOT NULL DEFAULT 'processing',    -- 'processing' / 'ready' / 'error', for tracking state

    -- Original path info
    original_path TEXT,                           -- '/my photos/2023/IMG_1234.jpg', for debugging and understanding source
    original_filename TEXT,                       -- 'IMG_1234.jpg', original filename

    -- Timestamps
    taken_at TIMESTAMP,                           -- when shot (from EXIF or OCR), may be NULL if no metadata
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),  -- when added to system
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),  -- when last modified (comment, album)

    -- Visual placeholder
    blurhash TEXT,                                -- 'LEHV6nWB2yk8...' string for instant placeholder in browser

    -- Original dimensions
    width INT,                                    -- original width in pixels
    height INT,                                   -- original height in pixels

    -- Preview dimensions (actual after resize, may be smaller if original is small)
    small_width INT,                              -- small preview width (target 800px)
    small_height INT,                             -- small preview height
    large_width INT,                              -- large preview width (target 2500px), NULL for video
    large_height INT,                             -- large preview height, NULL for video

    -- File sizes in bytes (for statistics and download optimization)
    size_original INT,                            -- original size (for video — video file size)
    size_small INT,                               -- small preview size
    size_large INT,                               -- large preview size

    -- Video specific
    duration_sec INT,                             -- video duration in seconds, NULL for photos
    video_codec TEXT,                             -- 'h264' / 'hevc', for information

    -- EXIF camera metadata
    camera_make TEXT,                             -- 'Apple' / 'Canon' / 'Sony'
    camera_model TEXT,                            -- 'iPhone 15 Pro' / 'Canon EOS R5'
    lens TEXT,                                    -- 'EF 50mm f/1.4'
    iso INT,                                      -- 100 / 400 / 3200
    aperture REAL,                                -- 1.8 / 2.8 / 5.6 (f-number)
    shutter_speed TEXT,                           -- '1/120' / '1/1000' / '30' (string as it can be fraction)
    focal_length REAL,                            -- 50.0 / 24.0 (in mm)
    flash BOOLEAN,                                -- whether flash was used

    -- Geolocation
    gps_lat DOUBLE PRECISION,                     -- latitude, e.g. 55.751244
    gps_lon DOUBLE PRECISION,                     -- longitude, e.g. 37.618423
    gps_altitude REAL,                            -- altitude above sea level in meters
    place_id TEXT REFERENCES places(id) ON DELETE SET NULL,  -- reference to place (filled after geocoding)

    -- User data
    comment TEXT,                                 -- user comment on photo
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,   -- in favorites or not

    -- Soft-delete (trash)
    deleted_at TIMESTAMPTZ,                       -- NULL = active, set = in trash, auto-purged after 30 days

    -- AI processing results
    ai_processed_at TIMESTAMP,                    -- when AI processing completed, NULL = not processed
    ai_person_ids TEXT[],                         -- ['person_abc', 'person_def'] - references to persons table
    ai_faces_count INT GENERATED ALWAYS AS (coalesce(array_length(ai_person_ids, 1), 0)) STORED,  -- number of faces (computed)

    -- AI OCR results
    ai_ocr_text TEXT,                             -- recognized text from photo
    ai_ocr_date DATE,                             -- date extracted from text (for old photos with printed date)

    -- AI additional data
    ai_colors TEXT[],                             -- dominant colors: ['#1e90ff', '#ffd700']
    ai_quality_score REAL,                        -- photo quality score 0.0-1.0 (sharpness, exposure, composition)

    -- Constraints
    CONSTRAINT valid_type CHECK (type IN ('photo', 'video')),
    CONSTRAINT valid_status CHECK (status IN ('processing', 'ready', 'error'))
);

-- ============================================
-- ALBUMS
-- Photo collections, created by user or automatically
-- ============================================
CREATE TABLE albums (
    id TEXT PRIMARY KEY,                          -- UUID, 'favorites' is hardcoded

    -- Album type
    type TEXT NOT NULL DEFAULT 'manual',          -- 'manual' / 'favorites' / 'place'

    -- Data
    name TEXT NOT NULL,                           -- 'Vacation 2023' / 'Favorites' / 'Moscow'
    description TEXT,                             -- album description

    -- Cover
    cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,  -- photo for cover, NULL = first photo

    -- Link to place (for type='place')
    place_id TEXT REFERENCES places(id) ON DELETE CASCADE,  -- if this is auto-album by place

    -- Statistics (denormalized)
    photo_count INT NOT NULL DEFAULT 0,           -- photo count

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_album_type CHECK (type IN ('manual', 'favorites', 'place'))
);

-- ============================================
-- ALBUM <-> PHOTO RELATIONSHIP
-- Many to many, photo can be in multiple albums
-- ============================================
CREATE TABLE album_photos (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,   -- on album delete, remove links
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,   -- on photo delete, remove from albums

    added_at TIMESTAMP NOT NULL DEFAULT NOW(),    -- when added to album
    sort_order INT,                               -- order in album (NULL = by date)

    PRIMARY KEY (album_id, photo_id)
);

-- ============================================
-- PHOTO <-> FACE RELATIONSHIP
-- Stores detected faces with bounding boxes
-- ============================================
CREATE TABLE photo_faces (
    id TEXT PRIMARY KEY,                          -- 'pface_abc123'

    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    face_id TEXT NOT NULL REFERENCES faces(id) ON DELETE CASCADE,

    -- Bounding box coordinates (relative 0.0-1.0)
    box_x REAL NOT NULL,                          -- x position (left edge)
    box_y REAL NOT NULL,                          -- y position (top edge)
    box_w REAL NOT NULL,                          -- width
    box_h REAL NOT NULL,                          -- height

    -- Face embedding for this specific detection
    embedding REAL[] NOT NULL,                    -- 512 float values from ArcFace

    -- Detection confidence
    confidence REAL,                              -- 0.0-1.0

    -- Hidden from person's photo list (but AI data preserved)
    hidden BOOLEAN NOT NULL DEFAULT FALSE,

    -- Timestamp
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- PHOTO <-> AI TAG RELATIONSHIP
-- Stores detected objects and scenes
-- ============================================
CREATE TABLE photo_tags (
    id TEXT PRIMARY KEY,                          -- 'ptag_abc123'

    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES ai_tags(id) ON DELETE CASCADE,

    -- Detection confidence
    confidence REAL,                              -- 0.0-1.0

    -- Timestamp
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- HIDDEN GROUP PHOTOS
-- Photos hidden from people group views
-- ============================================
CREATE TABLE hidden_group_photos (
    person_ids TEXT[] NOT NULL,                   -- sorted array of person IDs
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,

    hidden_at TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (person_ids, photo_id)
);

-- ============================================
-- AI PROCESSING QUEUE
-- Tracks photos pending AI processing
-- ============================================
CREATE TABLE ai_queue (
    photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,

    -- Status
    status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' / 'processing' / 'done' / 'error'
    priority INT NOT NULL DEFAULT 0,              -- higher = process first
    attempts INT NOT NULL DEFAULT 0,              -- number of processing attempts
    last_error TEXT,                              -- last error message if failed

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),  -- when added to queue
    started_at TIMESTAMP,                         -- when processing started
    completed_at TIMESTAMP,                       -- when processing completed

    -- Constraints
    CONSTRAINT valid_ai_queue_status CHECK (status IN ('pending', 'processing', 'done', 'error'))
);

-- ============================================
-- PUBLIC LINKS
-- For sharing photos and albums without auth
-- ============================================
CREATE TABLE shares (
    id TEXT PRIMARY KEY,                          -- short code for URL: /s/abc123

    -- What we're sharing
    type TEXT NOT NULL,                           -- 'photo' / 'album'
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,  -- if sharing photo
    album_id TEXT REFERENCES albums(id) ON DELETE CASCADE,  -- if sharing album

    -- Protection
    password_hash TEXT,                           -- bcrypt hash of password, NULL = no password

    -- Expiration
    expires_at TIMESTAMP,                         -- when expires, NULL = never

    -- Statistics
    view_count INT NOT NULL DEFAULT 0,            -- how many times opened

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints: either photo_id or album_id, not both
    CONSTRAINT valid_share_type CHECK (type IN ('photo', 'album')),
    CONSTRAINT share_target_check CHECK (
        (type = 'photo' AND photo_id IS NOT NULL AND album_id IS NULL) OR
        (type = 'album' AND album_id IS NOT NULL AND photo_id IS NULL)
    )
);

-- ============================================
-- EVENTS
-- For realtime updates via SSE
-- Frontend subscribes and receives new events
-- ============================================
CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,                     -- auto-increment for ordering

    type TEXT NOT NULL,                           -- 'photo_added' / 'photo_updated' / 'photo_deleted' / 'album_created' / ...
    payload JSONB NOT NULL,                       -- {"photo_id": "abc123", "album_id": "xyz"} — event data

    created_at TIMESTAMP NOT NULL DEFAULT NOW()   -- event timestamp
);

-- ============================================
-- SYSTEM SETTINGS
-- Key-value storage for configuration
-- ============================================
CREATE TABLE settings (
    key TEXT PRIMARY KEY,                         -- 'nominatim_enabled' / 'processing_workers' / ...
    value TEXT NOT NULL,                          -- value as string
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- PROCESSING QUEUE STATE
-- Tracks files being processed for crash recovery
-- ============================================
CREATE TABLE processing_state (
    file_path TEXT PRIMARY KEY,                   -- original path in /uploads
    status TEXT NOT NULL DEFAULT 'queued',        -- 'queued' / 'processing' / 'completed' / 'failed'
    attempts INT NOT NULL DEFAULT 0,              -- number of processing attempts
    last_error TEXT,                              -- last error message if failed
    worker_id TEXT,                               -- which worker is processing (for debugging)
    started_at TIMESTAMP,                         -- when processing started
    completed_at TIMESTAMP,                       -- when completed (success or final failure)
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),  -- when added to queue

    CONSTRAINT valid_processing_status CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
);

-- ============================================
-- INDEXES
-- ============================================

-- Photos: main queries
CREATE INDEX idx_photos_taken_at ON photos(taken_at DESC NULLS LAST);           -- sort by shot date
CREATE INDEX idx_photos_created_at ON photos(created_at DESC);                   -- sort by add date
CREATE INDEX idx_photos_updated_at ON photos(updated_at DESC);                   -- for sync
CREATE INDEX idx_photos_status ON photos(status) WHERE status != 'ready';        -- find unprocessed
CREATE INDEX idx_photos_type ON photos(type);                                    -- filter photo/video
CREATE INDEX idx_photos_favorite ON photos(is_favorite) WHERE is_favorite;       -- quick access to favorites
CREATE INDEX idx_photos_place ON photos(place_id) WHERE place_id IS NOT NULL;    -- photos by place
CREATE INDEX idx_photos_gps ON photos(gps_lat, gps_lon) WHERE gps_lat IS NOT NULL;  -- search by coordinates
CREATE INDEX idx_photos_camera ON photos(camera_make, camera_model);             -- filter by camera
CREATE INDEX idx_photos_year_month ON photos(                                    -- group by year/month
    EXTRACT(YEAR FROM taken_at),
    EXTRACT(MONTH FROM taken_at)
) WHERE taken_at IS NOT NULL;

-- Photos: AI indexes
CREATE INDEX idx_photos_ai_processed ON photos(ai_processed_at) WHERE ai_processed_at IS NOT NULL;
CREATE INDEX idx_photos_ai_persons ON photos USING GIN (ai_person_ids) WHERE ai_person_ids IS NOT NULL;
CREATE INDEX idx_photos_ai_faces_count ON photos(ai_faces_count) WHERE ai_faces_count > 0;
CREATE INDEX idx_photos_ai_ocr_date ON photos(ai_ocr_date) WHERE ai_ocr_date IS NOT NULL;
CREATE INDEX idx_photos_ai_colors ON photos USING GIN (ai_colors) WHERE ai_colors IS NOT NULL;
CREATE INDEX idx_photos_ai_quality ON photos(ai_quality_score DESC) WHERE ai_quality_score IS NOT NULL;

-- Photos: soft-delete (trash)
CREATE INDEX idx_photos_deleted_at ON photos(deleted_at) WHERE deleted_at IS NOT NULL;  -- trash listing and auto-purge

-- Places
CREATE INDEX idx_places_gps ON places(gps_lat, gps_lon);                         -- find nearest place
CREATE INDEX idx_places_country_city ON places(country, city);                   -- filter by country/city

-- Persons
CREATE INDEX idx_persons_name ON persons(name);                                  -- search by name
CREATE INDEX idx_persons_photo_count ON persons(photo_count DESC);               -- sort by photo count

-- Faces
CREATE INDEX idx_faces_person ON faces(person_id);                               -- faces for person

-- AI Tags
CREATE INDEX idx_ai_tags_type ON ai_tags(type);                                  -- filter by type
CREATE INDEX idx_ai_tags_name ON ai_tags(name);                                  -- search by name

-- Photo Faces
CREATE INDEX idx_photo_faces_photo ON photo_faces(photo_id);                     -- faces on photo
CREATE INDEX idx_photo_faces_face ON photo_faces(face_id);                       -- photos with face
CREATE INDEX idx_photo_faces_hidden ON photo_faces(photo_id) WHERE hidden = TRUE; -- hidden faces

-- Photo Tags
CREATE INDEX idx_photo_tags_photo ON photo_tags(photo_id);                       -- tags for photo
CREATE INDEX idx_photo_tags_tag ON photo_tags(tag_id);                           -- photos with tag

-- Hidden Group Photos
CREATE INDEX idx_hidden_group_photos_ids ON hidden_group_photos USING GIN (person_ids);  -- find by person combo

-- AI Queue
CREATE INDEX idx_ai_queue_status ON ai_queue(status, priority DESC, created_at); -- get next to process
CREATE INDEX idx_ai_queue_pending ON ai_queue(created_at) WHERE status = 'pending';  -- pending count

-- Albums
CREATE INDEX idx_albums_type ON albums(type);                                    -- filter by type
CREATE INDEX idx_albums_place ON albums(place_id) WHERE place_id IS NOT NULL;    -- place albums
CREATE INDEX idx_albums_updated ON albums(updated_at DESC);                      -- sorting

-- Album-photo links
CREATE INDEX idx_album_photos_album ON album_photos(album_id);                   -- photos in album
CREATE INDEX idx_album_photos_photo ON album_photos(photo_id);                   -- which albums photo is in

-- Sharing
CREATE INDEX idx_shares_photo ON shares(photo_id) WHERE photo_id IS NOT NULL;
CREATE INDEX idx_shares_album ON shares(album_id) WHERE album_id IS NOT NULL;
CREATE INDEX idx_shares_expires ON shares(expires_at) WHERE expires_at IS NOT NULL;  -- for cleanup

-- Events (for polling/SSE)
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_id_created ON events(id, created_at);                    -- for cursor pagination

-- Processing state
CREATE INDEX idx_processing_state_status ON processing_state(status);
CREATE INDEX idx_processing_state_created ON processing_state(created_at);

-- ============================================
-- FOREIGN KEY CONSTRAINTS (added after all tables created)
-- ============================================

-- Add FK for persons.cover_face_id after photo_faces exists
ALTER TABLE persons
    ADD CONSTRAINT fk_persons_cover_face
    FOREIGN KEY (cover_face_id) REFERENCES photo_faces(id) ON DELETE SET NULL;

-- ============================================
-- MATERIALIZED VIEW: People Groups
-- Groups of 2+ persons appearing together in photos
-- Refreshed periodically for performance at 1M+ photos
-- ============================================
CREATE MATERIALIZED VIEW people_groups AS
SELECT
    (SELECT array_agg(pid ORDER BY pid) FROM unnest(ai_person_ids) AS pid) AS person_ids,
    COUNT(*) AS photo_count
FROM photos
WHERE ai_person_ids IS NOT NULL
  AND array_length(ai_person_ids, 1) >= 2
  AND status = 'ready'
  AND deleted_at IS NULL
GROUP BY (SELECT array_agg(pid ORDER BY pid) FROM unnest(ai_person_ids) AS pid)
ORDER BY photo_count DESC;

-- Index for fast lookups
CREATE INDEX idx_people_groups_ids ON people_groups USING GIN (person_ids);
CREATE INDEX idx_people_groups_count ON people_groups(photo_count DESC);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update album photo_count
CREATE OR REPLACE FUNCTION update_album_photo_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE albums SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.album_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE albums SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = OLD.album_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to update place photo_count
-- Handles place_id changes and soft-delete (deleted_at) transitions
CREATE OR REPLACE FUNCTION update_place_photo_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.place_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE places SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.place_id;
    ELSIF TG_OP = 'DELETE' AND OLD.place_id IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE places SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = OLD.place_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Soft-delete: photo moved to trash
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.place_id IS NOT NULL THEN
            UPDATE places SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = NEW.place_id;
        -- Restore from trash
        ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.place_id IS NOT NULL THEN
            UPDATE places SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.place_id;
        -- Place changed on active photo
        ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND OLD.place_id IS DISTINCT FROM NEW.place_id THEN
            IF OLD.place_id IS NOT NULL THEN
                UPDATE places SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = OLD.place_id;
            END IF;
            IF NEW.place_id IS NOT NULL THEN
                UPDATE places SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.place_id;
            END IF;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to update face and person photo_count when photo_faces changes
CREATE OR REPLACE FUNCTION update_face_photo_count()
RETURNS TRIGGER AS $$
DECLARE
    v_person_id TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Increment face photo_count
        UPDATE faces SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.face_id;
        -- Increment person photo_count (only if this is first face of this person on this photo)
        SELECT person_id INTO v_person_id FROM faces WHERE id = NEW.face_id;
        IF NOT EXISTS (
            SELECT 1 FROM photo_faces pf
            JOIN faces f ON f.id = pf.face_id
            WHERE pf.photo_id = NEW.photo_id AND f.person_id = v_person_id AND pf.id != NEW.id
        ) THEN
            UPDATE persons SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = v_person_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        -- Decrement face photo_count
        UPDATE faces SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = OLD.face_id;
        -- Decrement person photo_count (only if this was last face of this person on this photo)
        SELECT person_id INTO v_person_id FROM faces WHERE id = OLD.face_id;
        IF v_person_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM photo_faces pf
            JOIN faces f ON f.id = pf.face_id
            WHERE pf.photo_id = OLD.photo_id AND f.person_id = v_person_id AND pf.id != OLD.id
        ) THEN
            UPDATE persons SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = v_person_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to update ai_tag photo_count when photo_tags changes
CREATE OR REPLACE FUNCTION update_ai_tag_photo_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Increment only if this is the first occurrence of this tag on this photo
        IF NOT EXISTS (
            SELECT 1 FROM photo_tags
            WHERE photo_id = NEW.photo_id AND tag_id = NEW.tag_id AND id != NEW.id
        ) THEN
            UPDATE ai_tags SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.tag_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        -- Decrement only if this was the last occurrence of this tag on this photo
        IF NOT EXISTS (
            SELECT 1 FROM photo_tags
            WHERE photo_id = OLD.photo_id AND tag_id = OLD.tag_id AND id != OLD.id
        ) THEN
            UPDATE ai_tags SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = OLD.tag_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to handle favorites album sync
-- Handles is_favorite changes and soft-delete (deleted_at) transitions
CREATE OR REPLACE FUNCTION sync_favorites_album()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Soft-delete: remove from favorites album (but keep is_favorite flag for restore)
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.is_favorite = TRUE THEN
            DELETE FROM album_photos WHERE album_id = 'favorites' AND photo_id = NEW.id;
        -- Restore from trash: re-add to favorites album if still favorite
        ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.is_favorite = TRUE THEN
            INSERT INTO album_photos (album_id, photo_id, added_at)
            VALUES ('favorites', NEW.id, NOW())
            ON CONFLICT (album_id, photo_id) DO NOTHING;
        -- Normal favorite toggle on active photo
        ELSIF NEW.deleted_at IS NULL THEN
            IF OLD.is_favorite = FALSE AND NEW.is_favorite = TRUE THEN
                INSERT INTO album_photos (album_id, photo_id, added_at)
                VALUES ('favorites', NEW.id, NOW())
                ON CONFLICT (album_id, photo_id) DO NOTHING;
            ELSIF OLD.is_favorite = TRUE AND NEW.is_favorite = FALSE THEN
                DELETE FROM album_photos WHERE album_id = 'favorites' AND photo_id = NEW.id;
            END IF;
        END IF;
    ELSIF TG_OP = 'INSERT' AND NEW.is_favorite = TRUE AND NEW.deleted_at IS NULL THEN
        INSERT INTO album_photos (album_id, photo_id, added_at)
        VALUES ('favorites', NEW.id, NOW())
        ON CONFLICT (album_id, photo_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to handle place album sync
-- When photo.place_id changes or photo is soft-deleted/restored, sync place albums
CREATE OR REPLACE FUNCTION sync_place_album()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Soft-delete: remove from place album
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.place_id IS NOT NULL THEN
            DELETE FROM album_photos
            WHERE photo_id = NEW.id
            AND album_id IN (SELECT id FROM albums WHERE place_id = NEW.place_id);
        -- Restore from trash: re-add to place album
        ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.place_id IS NOT NULL THEN
            INSERT INTO album_photos (album_id, photo_id, added_at)
            SELECT id, NEW.id, NOW() FROM albums WHERE place_id = NEW.place_id
            ON CONFLICT (album_id, photo_id) DO NOTHING;
        -- Place changed on active photo
        ELSIF NEW.deleted_at IS NULL THEN
            IF OLD.place_id IS NOT NULL AND OLD.place_id IS DISTINCT FROM NEW.place_id THEN
                DELETE FROM album_photos
                WHERE photo_id = NEW.id
                AND album_id IN (SELECT id FROM albums WHERE place_id = OLD.place_id);
            END IF;
            IF NEW.place_id IS NOT NULL AND OLD.place_id IS DISTINCT FROM NEW.place_id THEN
                INSERT INTO album_photos (album_id, photo_id, added_at)
                SELECT id, NEW.id, NOW() FROM albums WHERE place_id = NEW.place_id
                ON CONFLICT (album_id, photo_id) DO NOTHING;
            END IF;
        END IF;
    ELSIF TG_OP = 'INSERT' AND NEW.place_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        INSERT INTO album_photos (album_id, photo_id, added_at)
        SELECT id, NEW.id, NOW() FROM albums WHERE place_id = NEW.place_id
        ON CONFLICT (album_id, photo_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to add photo to AI queue when ready
CREATE OR REPLACE FUNCTION add_to_ai_queue()
RETURNS TRIGGER AS $$
BEGIN
    -- Add to AI queue when photo becomes ready (skip if soft-deleted)
    IF NEW.status = 'ready' AND NEW.deleted_at IS NULL AND (OLD IS NULL OR OLD.status != 'ready') THEN
        INSERT INTO ai_queue (photo_id, status, priority, created_at)
        VALUES (NEW.id, 'pending', 0, NOW())
        ON CONFLICT (photo_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at for photos
CREATE TRIGGER photos_updated_at
    BEFORE UPDATE ON photos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for places
CREATE TRIGGER places_updated_at
    BEFORE UPDATE ON places
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for albums
CREATE TRIGGER albums_updated_at
    BEFORE UPDATE ON albums
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for ai_tags
CREATE TRIGGER ai_tags_updated_at
    BEFORE UPDATE ON ai_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for persons
CREATE TRIGGER persons_updated_at
    BEFORE UPDATE ON persons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for faces
CREATE TRIGGER faces_updated_at
    BEFORE UPDATE ON faces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update album photo_count
CREATE TRIGGER album_photos_count_trigger
    AFTER INSERT OR DELETE ON album_photos
    FOR EACH ROW
    EXECUTE FUNCTION update_album_photo_count();

-- Auto-update place photo_count
CREATE TRIGGER photos_place_count_trigger
    AFTER INSERT OR UPDATE OR DELETE ON photos
    FOR EACH ROW
    EXECUTE FUNCTION update_place_photo_count();

-- Auto-update face and person photo_count
CREATE TRIGGER photo_faces_count_trigger
    AFTER INSERT OR DELETE ON photo_faces
    FOR EACH ROW
    EXECUTE FUNCTION update_face_photo_count();

-- Auto-update ai_tag photo_count
CREATE TRIGGER photo_tags_count_trigger
    AFTER INSERT OR DELETE ON photo_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_tag_photo_count();

-- Auto-sync favorites album
CREATE TRIGGER photos_favorites_sync
    AFTER INSERT OR UPDATE OF is_favorite ON photos
    FOR EACH ROW
    EXECUTE FUNCTION sync_favorites_album();

-- Auto-sync place album
CREATE TRIGGER photos_place_album_sync
    AFTER INSERT OR UPDATE OF place_id ON photos
    FOR EACH ROW
    EXECUTE FUNCTION sync_place_album();

-- Auto-add to AI queue when photo is ready
CREATE TRIGGER photos_add_to_ai_queue
    AFTER INSERT OR UPDATE OF status ON photos
    FOR EACH ROW
    EXECUTE FUNCTION add_to_ai_queue();

-- ============================================
-- INITIAL DATA
-- ============================================

-- System album "Favorites"
INSERT INTO albums (id, type, name, photo_count, created_at, updated_at)
VALUES ('favorites', 'favorites', 'Favorites', 0, NOW(), NOW());

-- Default settings
INSERT INTO settings (key, value, updated_at) VALUES
    ('nominatim_enabled', 'true', NOW()),                                    -- use geocoding
    ('nominatim_url', 'https://nominatim.openstreetmap.org', NOW()),        -- Nominatim URL
    ('nominatim_rate_limit_ms', '1000', NOW()),                             -- rate limit for nominatim (1 req/sec)
    ('place_radius_m', '500', NOW()),                                       -- default place radius
    ('processing_workers', '4', NOW()),                                     -- number of workers
    ('processing_max_retries', '3', NOW()),                                 -- max retry attempts
    ('preview_quality', '85', NOW()),                                       -- WebP quality
    ('preview_small_px', '800', NOW()),                                     -- small preview target
    ('preview_large_px', '2500', NOW()),                                    -- large preview target
    ('ai_enabled', 'true', NOW()),                                          -- enable AI processing
    ('ai_faces_enabled', 'true', NOW()),                                    -- enable face detection
    ('ai_tags_enabled', 'true', NOW()),                                     -- enable object/scene tagging
    ('ai_ocr_enabled', 'true', NOW()),                                      -- enable OCR
    ('ai_ocr_mode', 'auto', NOW()),                                         -- OCR mode: 'auto' (bottom only) / 'full' / 'off'
    ('ai_cluster_threshold', '0.6', NOW()),                                 -- face clustering threshold
    ('ai_min_face_confidence', '0.5', NOW()),                               -- minimum face detection confidence
    ('ai_min_tag_confidence', '0.15', NOW());                               -- minimum tag confidence

-- ============================================
-- COMMENTS ON TABLES AND COLUMNS
-- ============================================

COMMENT ON TABLE photos IS 'Main table storing all photo and video metadata. Files are stored on disk in /media/{id[0:2]}/{id[2:4]}/{id}_{size}.webp';
COMMENT ON TABLE places IS 'Geographic locations for grouping photos. Created automatically during GPS processing or manually by user';
COMMENT ON TABLE persons IS 'People identified by AI face recognition. One person can have multiple face embeddings';
COMMENT ON TABLE faces IS 'Face embeddings belonging to a person. One person can have 1-100 different face embeddings (different ages, angles)';
COMMENT ON TABLE ai_tags IS 'AI-detected tags: objects (car, dog) and scenes (beach, mountain). NOT persons - those are in persons table';
COMMENT ON TABLE albums IS 'Photo collections. Includes system album "favorites" and auto-generated place albums';
COMMENT ON TABLE album_photos IS 'Many-to-many relationship between albums and photos with ordering support';
COMMENT ON TABLE photo_faces IS 'Links photos to detected faces with bounding box coordinates and embeddings';
COMMENT ON TABLE photo_tags IS 'Links photos to AI tags (objects/scenes) with confidence scores';
COMMENT ON TABLE hidden_group_photos IS 'Photos hidden from people group views. Preserves AI data but excludes from display';
COMMENT ON TABLE ai_queue IS 'Queue for AI processing. Photos are added when ready and processed in priority order';
COMMENT ON TABLE shares IS 'Public sharing links for photos and albums with optional password protection and expiration';
COMMENT ON TABLE events IS 'Event log for real-time updates via SSE. Clients poll this table for changes';
COMMENT ON TABLE settings IS 'System configuration key-value store';
COMMENT ON TABLE processing_state IS 'Tracks file processing state for crash recovery and progress monitoring';

COMMENT ON COLUMN photos.id IS 'SHA256 hash first 12 characters. Used to construct file path: /media/{id[0:2]}/{id[2:4]}/{id}_{size}.webp';
COMMENT ON COLUMN photos.blurhash IS 'BlurHash string for instant low-quality placeholder while full image loads';
COMMENT ON COLUMN photos.status IS 'Processing status: processing (being processed), ready (available for viewing), error (processing failed)';
COMMENT ON COLUMN photos.ai_processed_at IS 'Timestamp when AI processing completed. NULL means not yet processed by AI';
COMMENT ON COLUMN photos.ai_person_ids IS 'Array of person IDs detected in this photo. References persons table';
COMMENT ON COLUMN photos.ai_faces_count IS 'Computed column: number of unique persons detected (length of ai_person_ids array)';
COMMENT ON COLUMN photos.ai_ocr_text IS 'Text recognized by OCR from the photo';
COMMENT ON COLUMN photos.ai_ocr_date IS 'Date extracted from OCR text, typically from old photos with printed timestamps';

COMMENT ON COLUMN places.name_source IS 'How the name was determined: auto (from Nominatim reverse geocoding) or manual (user renamed)';
COMMENT ON COLUMN places.radius_m IS 'Radius in meters for clustering nearby photos into this place';

COMMENT ON COLUMN persons.name IS 'Person name. Initially auto-generated as "Unknown N", can be changed by user';
COMMENT ON COLUMN persons.cover_face_id IS 'Reference to photo_faces for preview. User-selected or auto-first';

COMMENT ON COLUMN faces.embedding IS '512-dimensional face embedding from ArcFace for matching new faces';

COMMENT ON COLUMN ai_tags.type IS 'Tag type: object (car, dog) or scene (beach, mountain)';

COMMENT ON COLUMN photo_faces.box_x IS 'Relative X coordinate (0.0-1.0) of bounding box left edge';
COMMENT ON COLUMN photo_faces.box_y IS 'Relative Y coordinate (0.0-1.0) of bounding box top edge';
COMMENT ON COLUMN photo_faces.box_w IS 'Relative width (0.0-1.0) of bounding box';
COMMENT ON COLUMN photo_faces.box_h IS 'Relative height (0.0-1.0) of bounding box';
COMMENT ON COLUMN photo_faces.hidden IS 'If TRUE, face is hidden from person photo list but AI data preserved';

COMMENT ON COLUMN processing_state.worker_id IS 'Identifier of the worker processing this file, for debugging concurrent processing issues';
