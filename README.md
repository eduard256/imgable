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
                         ┌─────────────┐
                         │     API     │
                         │   :9812     │
                         │  (frontend) │
                         └──────┬──────┘
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
│   Scanner   │─────────▶│  Processor  │          │   Places    │
│   :8001     │  queue   │   :8002     │          │   :8003     │
└─────────────┘          └─────────────┘          └─────────────┘
                                │                        │
                                └────────────┬───────────┘
                                             │
                        ┌────────────────────┼────────────────────┐
                        │                    │                    │
                  ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
                  │   Redis   │        │ PostgreSQL│        │ Nominatim │
                  │   :6379   │        │   :5432   │        │ (external)│
                  └───────────┘        └───────────┘        └───────────┘
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **API** | 9812 | Main HTTP API for frontend, authentication, file serving |
| **Scanner** | 8001 | Watches `/uploads` for new files, queues them for processing |
| **Processor** | 8002 | Processes files: creates previews, extracts metadata |
| **Places** | 8003 | Assigns photos to places using reverse geocoding (Nominatim) |
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

3. Create data directory (subdirectories are created automatically):
```bash
mkdir -p /data/imgable
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

1. **Upload photos**: Copy files to `/data/imgable/uploads` (or `$DATA_PATH/uploads`)
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
| `DATA_PATH` | `/data/imgable` | Root directory for all data (uploads, media, failed created automatically) |
| `IMGABLE_PASSWORD` | *required* | Password for web authentication |
| `JWT_EXPIRY_DAYS` | `30` | JWT token expiry in days |
| `API_PORT` | `9812` | External port for API server |
| `WORKERS` | `4` | Number of concurrent processor workers |
| `MAX_MEMORY_MB` | `1024` | Memory limit for processor |
| `PREVIEW_QUALITY` | `85` | WebP quality (1-100) |
| `PREVIEW_SMALL_PX` | `800` | Small preview size (longest edge) |
| `PREVIEW_LARGE_PX` | `2500` | Large preview size |
| `SCAN_INTERVAL_SEC` | `60` | Polling interval (fallback for fsnotify) |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Nominatim API URL for geocoding |
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

### Places Service (:8003)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/status` | GET | Current status and pending photos count |
| `/api/v1/run` | POST | Trigger manual geocoding run |

### API Service (:9812)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/login` | POST | Authentication (returns JWT) |
| `/api/v1/photos` | GET | List photos with pagination |
| `/api/v1/photos/{id}` | GET/PATCH/DELETE | Photo operations |
| `/api/v1/albums` | GET/POST | List/create albums |
| `/api/v1/albums/{id}` | GET/PATCH/DELETE | Album operations |
| `/api/v1/places` | GET | List places |
| `/api/v1/map/clusters` | GET | Get photo clusters for map view |
| `/api/v1/map/bounds` | GET | Get bounds of all photos |
| `/api/v1/shares` | GET/POST | List/create share links |
| `/api/v1/stats` | GET | Gallery statistics |
| `/api/v1/upload` | POST | Upload new photos |
| `/api/v1/events/stream` | GET | SSE events stream |
| `/api/v1/sync/*` | * | Proxy to scanner/processor/places |
| `/s/{code}` | GET | Public share access (no auth) |

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
        │   └── large:  2500px  ~150KB
        ├── Generate blurhash
        ├── Extract GPS coordinates
        ├── Save to database
        └── Delete original
        │
        ▼
   /data/media/ab/c1/abc123def456_s.webp
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
├── processor/        # Processor service
│   ├── Dockerfile
│   └── internal/
│       ├── worker/
│       ├── image/
│       ├── video/
│       ├── metadata/
│       ├── geo/
│       └── api/
├── places/           # Places service (geocoding)
│   ├── Dockerfile
│   └── internal/
│       ├── worker/
│       ├── nominatim/
│       └── api/
└── api/              # Main API server
    ├── Dockerfile
    └── internal/
        ├── server/
        ├── handlers/
        ├── storage/
        ├── auth/
        └── files/
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
- [FFmpeg](https://ffmpeg.org/) - Video processing
