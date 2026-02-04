-- ============================================
-- IMGABLE DATABASE SCHEMA
-- Version: 1.0.0
-- Description: Complete database schema for Imgable family photo gallery
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
    taken_at TIMESTAMP,                           -- when shot (from EXIF), may be NULL if no metadata
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
    type TEXT NOT NULL DEFAULT 'manual',          -- 'manual' (user created) / 'favorites' (system) / 'place' (auto by location)

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

-- Places
CREATE INDEX idx_places_gps ON places(gps_lat, gps_lon);                         -- find nearest place
CREATE INDEX idx_places_country_city ON places(country, city);                   -- filter by country/city

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
CREATE OR REPLACE FUNCTION update_place_photo_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.place_id IS NOT NULL THEN
        UPDATE places SET photo_count = photo_count + 1, updated_at = NOW() WHERE id = NEW.place_id;
    ELSIF TG_OP = 'DELETE' AND OLD.place_id IS NOT NULL THEN
        UPDATE places SET photo_count = photo_count - 1, updated_at = NOW() WHERE id = OLD.place_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.place_id IS DISTINCT FROM NEW.place_id THEN
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

-- Function to handle favorites album sync
CREATE OR REPLACE FUNCTION sync_favorites_album()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.is_favorite = FALSE AND NEW.is_favorite = TRUE THEN
            -- Add to favorites album
            INSERT INTO album_photos (album_id, photo_id, added_at)
            VALUES ('favorites', NEW.id, NOW())
            ON CONFLICT (album_id, photo_id) DO NOTHING;
        ELSIF OLD.is_favorite = TRUE AND NEW.is_favorite = FALSE THEN
            -- Remove from favorites album
            DELETE FROM album_photos WHERE album_id = 'favorites' AND photo_id = NEW.id;
        END IF;
    ELSIF TG_OP = 'INSERT' AND NEW.is_favorite = TRUE THEN
        INSERT INTO album_photos (album_id, photo_id, added_at)
        VALUES ('favorites', NEW.id, NOW())
        ON CONFLICT (album_id, photo_id) DO NOTHING;
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

-- Auto-sync favorites album
CREATE TRIGGER photos_favorites_sync
    AFTER INSERT OR UPDATE OF is_favorite ON photos
    FOR EACH ROW
    EXECUTE FUNCTION sync_favorites_album();

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
    ('preview_large_px', '2500', NOW());                                    -- large preview target

-- ============================================
-- COMMENTS ON TABLES AND COLUMNS
-- ============================================

COMMENT ON TABLE photos IS 'Main table storing all photo and video metadata. Files are stored on disk in /media/{id[0:2]}/{id[2:4]}/{id}_{size}.webp';
COMMENT ON TABLE places IS 'Geographic locations for grouping photos. Created automatically during GPS processing or manually by user';
COMMENT ON TABLE albums IS 'User-created photo collections. Includes system album "favorites" and auto-generated place albums';
COMMENT ON TABLE album_photos IS 'Many-to-many relationship between albums and photos with ordering support';
COMMENT ON TABLE shares IS 'Public sharing links for photos and albums with optional password protection and expiration';
COMMENT ON TABLE events IS 'Event log for real-time updates via SSE. Clients poll this table for changes';
COMMENT ON TABLE settings IS 'System configuration key-value store';
COMMENT ON TABLE processing_state IS 'Tracks file processing state for crash recovery and progress monitoring';

COMMENT ON COLUMN photos.id IS 'SHA256 hash first 12 characters. Used to construct file path: /media/{id[0:2]}/{id[2:4]}/{id}_{size}.webp';
COMMENT ON COLUMN photos.blurhash IS 'BlurHash string for instant low-quality placeholder while full image loads';
COMMENT ON COLUMN photos.status IS 'Processing status: processing (being processed), ready (available for viewing), error (processing failed)';

COMMENT ON COLUMN places.name_source IS 'How the name was determined: auto (from Nominatim reverse geocoding) or manual (user renamed)';
COMMENT ON COLUMN places.radius_m IS 'Radius in meters for clustering nearby photos into this place';

COMMENT ON COLUMN processing_state.worker_id IS 'Identifier of the worker processing this file, for debugging concurrent processing issues';
