# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-28

First public release.

### Architecture

- **API** (Go + chi) -- main HTTP server, SPA hosting, JWT auth, file serving (port 9812)
- **Scanner** (Go) -- watches /uploads directory, queues tasks via Redis (port 8001)
- **Processor** (Go + libvips + ffmpeg) -- creates previews, extracts EXIF, generates blurhash (port 8002)
- **Places** (Go) -- reverse geocoding via Nominatim, auto-creates place albums (port 8003)
- **AI** (Python + FastAPI + ONNX) -- face detection, CLIP tags, OCR (port 8004)
- **SMB** (Samba, optional) -- network share for file uploads (port 445)

### Frontend

- React 19 + TypeScript + Vite 7 + Tailwind CSS 4
- Terracotta Desert theme with glass-morphism, Outfit font
- i18n support (Russian / English)

### Pages

- **Gallery** -- masonry grid, reverse chronological, infinite scroll, drag-select, multi-select, pinch-to-zoom, date range labels, filters (all/photo/video/favorites), sort by shot date or added date, group by month
- **Albums** -- manual albums + auto place-albums, create/edit/delete/share, cover selection
- **People** -- AI face recognition cards, merge persons, rename, manage faces, "Together" groups
- **Map** -- MapLibre GL, cluster by zoom level, click cluster to open gallery
- **Folders** -- virtual file system browsing by original import paths
- **Trash** -- soft-delete with restore and permanent delete, auto-purge after 30 days
- **Admin** -- dashboard with stats, processing pipeline status, shares, metrics
- **Share** -- public viewing by short code, optional password protection
- **Kiosk** -- fullscreen slideshow mode without navigation
- **Upload** -- parallel file upload (max 3 concurrent), drag & drop, folder upload

### Components

- PhotoViewer -- fullscreen viewer with filmstrip, keyboard navigation
- PublicPhotoViewer -- viewer for shared pages
- UploadManager -- upload queue with progress tracking
- SelectionBar -- multi-select actions (album, favorite, share, kiosk, delete)
- MapPreview -- map preview in gallery
- DesertBackground -- animated background (Terracotta / Ivory themes)

### AI

- Face detection and clustering via ONNX (ArcFace embeddings)
- CLIP-based object and scene tagging
- OCR for dates on scanned photos
- Auto-queue photos for AI processing when ready

### Backend features

- SSE event stream for real-time updates
- Prometheus metrics on scanner/processor
- Sync proxy (API -> scanner/processor/places/AI)
- JWT authentication with rate limiting on login
- Soft-delete (trash) with auto-purge
- Database migrations via golang-migrate (auto-applied on API startup)
- Multi-stage Docker build (frontend + backend in one image)
- SMB file sharing (optional, via docker compose profile)
