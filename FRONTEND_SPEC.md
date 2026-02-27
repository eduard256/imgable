# Imgable Frontend Specification

## General

- SPA application, all routing is client-side
- API server runs on a separate port, base URL is configurable: `API_BASE = http://{hostname}:9812`
- Authentication via JWT token stored in `localStorage`
- All authenticated requests send header: `Authorization: Bearer {token}`
- On 401 response: clear token, redirect to `/login`
- Thumbnails and media files are served by API via URL paths from photo objects

## Authentication

Single-password login (no usernames).

### Login

```
POST /api/v1/login
Body: { "password": "string" }
```

Returns token. Store in localStorage, attach to all subsequent requests.

### Logout

Client-side only: remove token from localStorage, redirect to `/login`.

## Navigation

Header with navigation links. Pages:

- `/` -- Gallery
- `/albums` -- Albums list
- `/albums/:id` -- Album view
- `/people` -- People (face recognition)
- `/people/:id` -- Person view
- `/people/group?ids=id1,id2` -- Group view (photos where these people appear together)
- `/map` -- Photo map
- `/shares` -- Shared links management
- `/stats` -- Statistics
- `/sync` -- Sync status (scanner, processor, places, AI)
- `/upload` -- File upload
- `/s/:code` -- Public share view (no auth required)
- `/login` -- Login page

Header also shows a sync status indicator (green dot linked to `/sync`), and a logout button.

---

## Gallery (`/`)

Main photo grid with infinite scroll.

### Controls

- **Sort**: `date` (by taken date) or `created` (by added date)
- **Filter**: all / photos only / videos only / favorites only
- **Group by month**: toggle, persisted in localStorage. When enabled, month headers are inserted between photo groups
- **Select mode**: toggle button to enter multi-select

### Loading photos

```
GET /api/v1/photos?limit=100&sort={date|created}
GET /api/v1/photos?limit=100&sort=date&type=photo
GET /api/v1/photos?limit=100&sort=date&type=video
GET /api/v1/photos?limit=100&sort=date&favorite=true
```

Cursor-based pagination: response contains `has_more`, `next_cursor`. Next page:

```
GET /api/v1/photos?limit=100&sort=date&cursor={next_cursor}
```

### Infinite scroll

- Trigger loading when user scrolls within 1500px of bottom
- Throttled with `requestAnimationFrame`
- After initial load, check if viewport is tall enough to need immediate second load

### Photo grid items

Each item shows:
- Thumbnail image (from `photo.small` URL path)
- Video indicator overlay if `photo.type === 'video'`
- Duration badge if video has `photo.duration`

Clicking item opens photo modal (or toggles selection in select mode).

### Multi-select mode

When active:
- Selection bar appears: shows count, action buttons
- Photo items get checkbox overlay, clicking toggles selection
- Available bulk actions:

**Bulk add to album:**
```
GET /api/v1/albums
POST /api/v1/albums/{album_id}/photos
Body: { "photo_ids": ["id1", "id2", ...] }
```

**Bulk delete:**
```
DELETE /api/v1/photos
Body: { "ids": ["id1", "id2", ...] }
```

**Bulk share** (creates album + share link):
```
POST /api/v1/albums
Body: { "name": "string" }

POST /api/v1/albums/{album_id}/photos
Body: { "photo_ids": ["id1", "id2", ...] }

POST /api/v1/shares
Body: { "type": "album", "album_id": "id", "password": "optional", "expires_days": optional_int }
```

---

## Photo Modal

Full-screen overlay for viewing a single photo/video.

### Opening

```
GET /api/v1/photos/{photo_id}
```

### Display

- Full-size image (`photo.urls.large`) or video player (`photo.urls.video`) with autoplay
- Previous/next navigation buttons (arrows) and keyboard (ArrowLeft, ArrowRight, Escape)
- Header: filename or photo ID
- Footer with actions and metadata

### Actions

**Toggle favorite:**
```
POST /api/v1/photos/{id}/favorite
DELETE /api/v1/photos/{id}/favorite
```

**Save comment:**
```
PATCH /api/v1/photos/{id}
Body: { "comment": "string" }
```

**Delete photo:**
```
DELETE /api/v1/photos/{id}
```

**Add to album:** shows album selection modal (same as gallery bulk add, but for single photo)

**Remove from album** (only shown when viewing from album context):
```
DELETE /api/v1/albums/{album_id}/photos/{photo_id}
```

**Share:** opens share creation modal (see Shares section)

### Metadata displayed

- Date taken (formatted as Russian locale date)
- Dimensions (width x height)
- File size
- Camera make/model (from EXIF)
- Place name
- Duration (for video)

---

## Albums (`/albums`)

### Albums list

```
GET /api/v1/albums
```

Displays two sections:
1. **User albums** -- type `manual` or `favorites`
2. **Places** -- type `place` (shown only if any exist, with separate header)

Each album card shows: cover image (from `album.cover` URL), name, photo count.

### Create album

```
POST /api/v1/albums
Body: { "name": "string" }
```

### Album view (`/albums/:id`)

```
GET /api/v1/albums/{album_id}
```

Response contains album info + first page of photos with cursor pagination.

Features:
- Photo grid with infinite scroll (same as gallery)
- Select mode with bulk actions: remove from album, delete photos
- Album header shows: name, photo count, description (if any)

**Bulk remove from album:**
```
DELETE /api/v1/albums/{album_id}/photos
Body: { "photo_ids": ["id1", "id2", ...] }
```

Actions (for manual albums):
- **Edit**: rename, change description, select cover photo
- **Share**: create share link
- **Delete album**

### Edit album

```
PATCH /api/v1/albums/{album_id}
Body: { "name": "string", "description": "string|null", "cover_photo_id": "optional_id" }
```

Cover photo selection: shows grid of current album photos, user clicks one to select.

### Delete album

```
DELETE /api/v1/albums/{album_id}
```

---

## Map (`/map`)

Interactive map using MapLibre GL JS with OpenFreeMap tiles (Positron style).

### Initial load

```
GET /api/v1/map/bounds
```

Returns total count and geographic bounds. Map centers on bounds center, starts at zoom 4.

### Cluster loading

On every map move/zoom (debounced 300ms):

```
GET /api/v1/map/clusters?north={n}&south={s}&east={e}&west={w}&zoom={z}
```

Coordinates are normalized to valid ranges (-90/90 lat, -180/180 lon).

### Marker rendering

- **Single photo** (count=1): smaller circle marker with thumbnail, green border
- **Cluster** (count>1): larger circle marker with thumbnail, blue border, count badge

Markers are managed efficiently: only add new ones, remove stale ones, keep existing.

### Interactions

**Click single photo marker:** opens photo modal
```
GET /api/v1/photos/{photo_id}
```

**Click cluster marker:** opens cluster gallery overlay showing photos in that area

### Cluster gallery

Loads photos within cluster bounds:
```
GET /api/v1/photos?north={n}&south={s}&east={e}&west={w}&limit=50
GET /api/v1/photos?north={n}&south={s}&east={e}&west={w}&limit=50&cursor={cursor}
```

- Grid of photos with "Load more" button for pagination
- Click photo opens photo modal
- Close with X button or Escape

### Info bar

Bottom center: shows total count of geotagged photos.

---

## People (`/people`)

### People list

```
GET /api/v1/people?limit=15&offset={offset}
```

Grid of person cards. Each card shows:
- Face thumbnail (with CSS transform to crop/zoom on face using `face_box` coordinates)
- Name (or random placeholder like "Who's This?" for unnamed persons based on `name_source !== 'manual'`)
- Photo count

"Load More" button for pagination.

### Groups ("Together") section

```
GET /api/v1/people/groups?limit=15&offset={offset}
```

Shows groups of people who appear together in photos. Each group card shows:
- Up to 3 face thumbnails overlapping, "+N" badge for more
- Combined name (named people listed, unnamed counted as "N others")
- Photo count

### Person view (`/people/:id`)

```
GET /api/v1/people/{person_id}
```

Header: avatar, name (italic for unnamed), photo count, face count.

**Tabs:**
- **Photos**: person's photos with infinite scroll
  ```
  GET /api/v1/people/{person_id}/photos?limit=100
  GET /api/v1/people/{person_id}/photos?limit=100&cursor={cursor}
  ```
- **Hidden**: hidden photos (faces excluded by user)
  ```
  GET /api/v1/people/{person_id}/photos/hidden?limit=100
  ```
- **Faces**: manage face embeddings (see below)

**Actions:**

Rename:
```
PATCH /api/v1/people/{person_id}
Body: { "name": "string" }
```

Merge with other people:
```
GET /api/v1/people?limit=100&offset=0
```
Shows list of all other people with checkboxes. On confirm:
```
POST /api/v1/people/merge
Body: { "source_ids": ["id1", "id2", "target_id"], "target_id": "target_id" }
```

Manage faces:
```
GET /api/v1/people/{person_id}/faces
```
Shows face embeddings with preview. Can detach a face (creates new person):
```
DELETE /api/v1/people/{person_id}/faces/{face_id}
```

Delete person:
```
DELETE /api/v1/people/{person_id}
```

### Group view (`/people/group?ids=id1,id2`)

Shows photos where all specified people appear together.

```
GET /api/v1/people/groups/photos?ids={id1,id2}&limit=100
GET /api/v1/people/groups/photos?ids={id1,id2}&limit=100&cursor={cursor}
```

Hidden tab:
```
GET /api/v1/people/groups/photos/hidden?ids={id1,id2}&limit=100
```

---

## Shares

### Share creation modal

Used from photo modal, album view, and bulk share. Parameters:
- Password (optional)
- Expiration in days (optional)

```
POST /api/v1/shares
Body: { "type": "photo|album", "photo_id": "id", "album_id": "id", "password": "optional", "expires_days": optional_int }
```

After creation, shows share URL for copying.

### Shares management (`/shares`)

```
GET /api/v1/shares
```

Grid of share cards. Each card shows:
- Type (photo/album)
- Badges: password protected, expired
- Share URL with copy button
- View count
- Expiration date
- Created date
- Actions: open in new tab, delete

Delete share:
```
DELETE /api/v1/shares/{share_id}
```

### Public share view (`/s/:code`)

No authentication required.

```
GET /s/{code}
GET /s/{code}?password={password}
```

If 401: show password form, resubmit with password.

**Photo share:** displays single large image.

**Album share:** displays album name, photo count, photo grid with infinite scroll.

```
GET /s/{code}?cursor={cursor}
GET /s/{code}?cursor={cursor}&password={password}
```

Photo modal in share view uses special URLs:
```
GET /s/{code}/photo/large?id={photo_id}
GET /s/{code}/photo/video?id={photo_id}
```
Password appended as query param if needed.

---

## Statistics (`/stats`)

```
GET /api/v1/stats
```

Displays cards:
- Total photos
- Total videos
- Total albums
- Total places
- Total favorites
- Storage used (human-readable string from API)

Photo timeline section: oldest and newest photo dates.

---

## Sync Status (`/sync`)

Auto-refreshes every 3 seconds while on this page. Stops auto-refresh when navigating away.

### Scanner status

```
GET /api/v1/sync/scanner/status
```

Shows: status, watched dirs, files discovered, files queued, pending files count.

Action - trigger rescan:
```
POST /api/v1/sync/scanner/rescan
```

### Processor status

```
GET /api/v1/sync/processor/status
```

Shows: status (+ paused flag), active/total workers, queue (pending, completed, failed), memory usage.

Action - toggle pause/resume:
```
GET /api/v1/sync/processor/status
POST /api/v1/sync/processor/pause
POST /api/v1/sync/processor/resume
```

### Places status

```
GET /api/v1/sync/places/api/v1/status
```

Shows: status, pending photos, last run info (time, photos processed, places created, nominatim requests, errors).

Action - run now:
```
POST /api/v1/sync/places/api/v1/run
```

### AI status

```
GET /api/v1/sync/ai/api/v1/status
```

Shows: status, queue pending, current photo, estimated time, last run info (time, photos processed, faces found, tags added).

Actions:
```
POST /api/v1/sync/ai/api/v1/run
POST /api/v1/sync/ai/api/v1/stop
```

---

## Upload (`/upload`)

Parallel file upload with individual progress tracking.

### Constraints

- Max file size: 4 GB
- Supported extensions: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.heic`, `.heif`, `.tiff`, `.tif`, `.bmp`, `.raw`, `.cr2`, `.cr3`, `.arw`, `.nef`, `.dng`, `.orf`, `.rw2`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`, `.mts`, `.m2ts`, `.3gp`
- Max parallel uploads: 3
- Hidden files (starting with `.`) are skipped

### File selection

Three methods:
1. **Drag and drop** -- files or folders (recursive traversal of folder contents via `webkitGetAsEntry`)
2. **Select Files button** -- standard file picker with `multiple`
3. **Select Folder button** -- folder picker with `webkitdirectory`

Invalid files (wrong extension) and oversized files are counted and reported.

### Upload process

Each file is uploaded individually via XHR:
```
POST /api/v1/upload
Content-Type: multipart/form-data
Body: FormData with 'file' field
Header: Authorization: Bearer {token}
```

### Per-file tracking

Each file shows:
- Filename (truncated to 40 chars with extension preserved)
- File size
- Progress bar with states: waiting (gray), uploading (blue gradient), done (green), error (red), cancelled (gray)
- Status text: "Waiting...", percentage, "Done", error message, "Cancelled"
- Cancel button (hidden after completion)

### Summary bar

Shown when files are added:
- Total files count
- Total size
- Done count
- Failed count (shown only if > 0)
- Actions: Cancel All, Clear Completed

### Queue behavior

- Files are added to queue and processing starts immediately
- New files can be added while upload is in progress (queue continues)
- Cancel All: cancels pending files and aborts active uploads
- Clear Completed: removes done/cancelled/error items from list

---

## Common Patterns

### Cursor-based pagination

All paginated endpoints return `has_more` (boolean) and `next_cursor` (string). Pass `cursor={next_cursor}` to get next page.

### Infinite scroll

Used in: gallery, album view, person photos, group photos, share view, cluster gallery.
- Trigger: scroll position within 1500px of bottom
- Throttled with requestAnimationFrame
- After initial load, check if viewport needs immediate second load

### Photo thumbnail URLs

Photo objects contain relative URL paths for thumbnails. Prepend `API_BASE` to get full URL:
- `photo.small` -- thumbnail for grid
- `photo.urls.large` -- full size image (in detail response)
- `photo.urls.video` -- video file (in detail response)

### Date formatting

All timestamps are Unix seconds. Displayed in Russian locale format: "27 February 2026, 14:30".

### Duration formatting

Video duration in seconds. Displayed as `M:SS` (e.g., `2:05`).

### File size formatting

Bytes formatted with units: B, KB, MB, GB (1 decimal place).
