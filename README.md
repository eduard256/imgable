# Imgable

A self-hosted family photo gallery with automatic photo processing, organization, and beautiful viewing experience.

## Features

- **Automatic Processing**: Drop photos anywhere in the uploads folder - they're automatically processed
- **Format Support**: JPEG, PNG, HEIC (iPhone), RAW formats, and video files
- **Smart Organization**: Automatic grouping by date and GPS location
- **Fast Loading**: Three preview sizes + blurhash placeholders for instant display
- **Crash Recovery**: Processing state persists across restarts
- **Failed File Handling**: Problematic files moved to `/failed` with error details

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Scanner   │────▶│  Processor  │     │     API     │
│   :8001     │     │   :8002     │     │   :9812     │
│             │     │             │     │  (future)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        ┌─────▼─────┐            ┌──────▼──────┐
        │   Redis   │            │  PostgreSQL │
        │   :6379   │            │    :5432    │
        └───────────┘            └─────────────┘
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **Scanner** | 8001 | Watches `/uploads` for new files, queues them for processing |
| **Processor** | 8002 | Processes files: creates previews, extracts metadata, geocoding |
| **PostgreSQL** | 5432 | Stores all metadata, albums, places |
| **Redis** | 6379 | Task queue (Asynq) and pub/sub for events |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- At least 2GB RAM recommended
- Storage for photos

### Installation

1. Clone the repository:
```bash
git clone https://github.com/eduard256/imgable.git
cd imgable
```

2. Create configuration:
```bash
cp .env.example .env
# Edit .env to set your paths and passwords
```

3. Create data directories:
```bash
mkdir -p /data/uploads /data/media /data/failed
```

4. Start the services:
```bash
docker compose up -d
```

5. Check status:
```bash
# Scanner status
curl http://localhost:8001/status

# Processor status
curl http://localhost:8002/status
```

### Usage

1. **Upload photos**: Copy files to `/data/uploads` (or your configured path)
   - Any folder structure is supported
   - Supported formats: JPEG, PNG, HEIC, HEIF, WebP, GIF, TIFF, RAW, CR2, CR3, ARW, NEF, DNG
   - Supported videos: MP4, MOV, AVI, MKV, WebM

2. **Monitor progress**: Check the processor status endpoint
```bash
curl http://localhost:8002/status | jq
```

3. **View failed files**: If any files fail processing
```bash
curl http://localhost:8002/failed | jq
```

4. **Retry failed files**:
```bash
curl -X POST http://localhost:8002/retry/2025-02-03/photo.jpg
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | `imgable` | Database password |
| `UPLOADS_PATH` | `/data/uploads` | Input directory for new files |
| `MEDIA_PATH` | `/data/media` | Output directory for processed files |
| `FAILED_PATH` | `/data/failed` | Directory for failed files |
| `WORKERS` | `4` | Number of concurrent processor workers |
| `MAX_MEMORY_MB` | `1024` | Memory limit for processor |
| `PREVIEW_QUALITY` | `85` | WebP quality (1-100) |
| `PREVIEW_SMALL_PX` | `800` | Small preview size (longest edge) |
| `PREVIEW_MEDIUM_PX` | `1600` | Medium preview size |
| `PREVIEW_LARGE_PX` | `2500` | Large preview size |
| `NOMINATIM_ENABLED` | `true` | Enable reverse geocoding |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Nominatim API URL |
| `PLACE_RADIUS_M` | `500` | Radius for clustering photos into places |
| `SCAN_INTERVAL_SEC` | `60` | Polling interval (fallback for fsnotify) |
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `LOG_FORMAT` | `text` | Log format: text or json |

## API Endpoints

### Scanner Service (:8001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | Scanner status and statistics |
| `/rescan` | POST | Trigger full directory rescan |
| `/metrics` | GET | Prometheus metrics |

### Processor Service (:8002)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | Queue and worker statistics |
| `/pause` | POST | Pause processing |
| `/resume` | POST | Resume processing |
| `/failed` | GET | List failed files |
| `/retry/:path` | POST | Retry a failed file |
| `/failed/:path` | DELETE | Delete a failed file |
| `/metrics` | GET | Prometheus metrics |

## File Processing Flow

```
/data/uploads/photo.jpg
        │
        ▼
   [Scanner] ──────▶ Redis Queue
        │
        ▼
   [Processor]
        │
        ├── Calculate SHA256 hash → ID
        ├── Check for duplicates
        ├── Extract EXIF metadata
        ├── Create previews (libvips)
        │   ├── small:  800px   ~30KB
        │   ├── medium: 1600px  ~70KB
        │   └── large:  2500px  ~150KB
        ├── Generate blurhash
        ├── Geocode GPS (Nominatim)
        ├── Save to database
        └── Delete original
        │
        ▼
   /data/media/ab/c1/abc123def456_s.webp
                    abc123def456_m.webp
                    abc123def456_l.webp
```

## Storage Structure

```
/data/
├── uploads/          # Input (any structure)
│   └── **/*.*
│
├── media/            # Output (organized by hash)
│   └── ab/
│       └── c1/
│           ├── abc123def456_s.webp   # Small preview
│           ├── abc123def456_m.webp   # Medium preview
│           ├── abc123def456_l.webp   # Large preview
│           └── video789abc.mp4       # Video original
│
└── failed/           # Problem files
    └── 2025-02-03/
        ├── photo.jpg           # Original file
        └── photo.jpg.error     # Error details (JSON)
```

## Monitoring

### Prometheus Metrics

Scanner metrics:
- `scanner_files_discovered_total` - Total files found
- `scanner_files_queued_total` - Files added to queue
- `scanner_files_skipped_total` - Duplicates/unsupported skipped
- `scanner_scan_duration_seconds` - Scan duration histogram

Processor metrics:
- `processor_tasks_processed_total` - Tasks completed
- `processor_tasks_failed_total` - Tasks failed
- `processor_processing_duration_seconds` - Processing time histogram
- `processor_queue_size` - Current queue size
- `processor_active_workers` - Active worker count

### Example Status Response

```json
{
  "status": "running",
  "paused": false,
  "uptime_seconds": 3600,
  "workers": {
    "total": 4,
    "active": 2,
    "idle": 2
  },
  "queue": {
    "pending": 150,
    "processing": 2,
    "completed_total": 5000,
    "failed_total": 12
  }
}
```

## Development

### Project Structure

```
imgable/
├── docker-compose.yml
├── .env.example
├── migrations/
│   └── 001_init.sql
├── shared/           # Shared Go packages
│   └── pkg/
│       ├── database/
│       ├── queue/
│       ├── logger/
│       ├── fileutil/
│       └── models/
├── scanner/          # Scanner service
│   ├── Dockerfile
│   └── internal/
│       ├── watcher/
│       ├── queue/
│       └── api/
└── processor/        # Processor service
    ├── Dockerfile
    └── internal/
        ├── worker/
        ├── image/
        ├── video/
        ├── metadata/
        ├── geo/
        └── api/
```

### Running Tests

```bash
# Run all tests
cd shared && go test ./...
cd ../scanner && go test ./...
cd ../processor && go test ./...

# With coverage
go test -cover ./...
```

### Building Locally

```bash
# Build scanner
cd scanner && go build -o ../bin/scanner ./cmd

# Build processor (requires libvips)
cd processor && CGO_ENABLED=1 go build -o ../bin/processor ./cmd
```

## Troubleshooting

### Files not being processed

1. Check scanner logs: `docker compose logs scanner`
2. Verify file permissions on uploads directory
3. Check if file format is supported
4. Trigger manual rescan: `curl -X POST http://localhost:8001/rescan`

### Processing too slow

1. Increase worker count in `.env`: `WORKERS=8`
2. Increase memory limit: `MAX_MEMORY_MB=2048`
3. Check for resource constraints: `docker stats`

### Files going to /failed

1. Check the `.error` file for details
2. Common issues:
   - Corrupted image file
   - Unsupported RAW format
   - File modified during processing

### Database connection issues

1. Check PostgreSQL logs: `docker compose logs postgres`
2. Verify DATABASE_URL in environment
3. Check if migrations ran successfully

## License

MIT License

## Credits

- [libvips](https://libvips.github.io/libvips/) - Fast image processing
- [govips](https://github.com/davidbyttow/govips) - Go bindings for libvips
- [Asynq](https://github.com/hibiken/asynq) - Redis-based task queue
- [Nominatim](https://nominatim.org/) - Reverse geocoding
- [FFmpeg](https://ffmpeg.org/) - Video processing
