# imgable

Self-hosted family photo gallery. One password, zero accounts, no nonsense.

> **Beta.** This project is under active development. Keep backups of your originals.
> For a stable, battle-tested solution, check out [Immich](https://immich.app).

![imgable demo](https://github.com/eduard256/imgable/releases/download/v0.1.2/imgable_860.gif)

## Why

Every photo gallery out there ships with accounts, roles, notes, file managers, and a dozen features nobody asked for. Then it chokes on 10k photos.

imgable is the opposite. One password for the whole family. Drag your photos onto an SMB share. Walk away. Come back to a fully indexed, instantly browsable library with AI face recognition, location mapping, and OCR date extraction from old printed photos. No scripts, no CLI uploaders, no setup wizards.

The heavy lifting happens once during import. After that, everything loads instantly.

## Features

- **One password, whole family** -- no accounts, no roles, no forgotten passwords
- **SMB upload** -- mount a network drive, drop 100k photos in any folder structure, duplicates handled automatically
- **AI face recognition** -- detects faces, clusters them, you just name the person
- **Object & scene tagging** -- beach, dog, sunset -- all automatic via CLIP
- **OCR date extraction** -- reads printed dates from old scanned photos and sets the timestamp
- **Interactive map** -- photos plotted by GPS with clustering
- **Instant browsing** -- photos pre-processed into optimized WebP, blurhash placeholders, smooth infinite scroll
- **Photo viewer** -- desktop coverflow with filmstrip, mobile swipe with pinch-to-zoom
- **Albums** -- manual + automatic place-based albums
- **Folders** -- browse by original import directory structure
- **Sharing** -- public links with optional password and expiration
- **Kiosk mode** -- fullscreen TV slideshow with 20 visual effects
- **Trash** -- soft delete with 30-day auto-purge
- **Real-time updates** -- SSE event stream, live processing status
- **Drag-select** -- long-press and drag to select multiple photos
- **Reverse geocoding** -- automatic place names from GPS via Nominatim
- **i18n** -- English and Russian

## Quick Start (any Linux)

### 1. Install Docker

```bash
# Ubuntu/Debian
apt update && apt upgrade -y
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc" > /etc/apt/sources.list.d/docker.sources

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 2. Install imgable

```bash
mkdir -p /opt/imgable && cd /opt/imgable

curl -O https://raw.githubusercontent.com/eduard256/imgable/master/docker-compose.yml
curl -O https://raw.githubusercontent.com/eduard256/imgable/master/.env.example
cp .env.example .env
```

### 3. Configure

Edit `.env`:

```bash
nano .env
```

```env
# Password for web interface (REQUIRED)
IMGABLE_PASSWORD=your-password

# Where to store everything (photos, database, previews)
DATA_PATH=/data/imgable

# Enable SMB network share for uploads (optional)
COMPOSE_PROFILES=smb
```

### 4. Run

```bash
docker compose up -d
```

Wait for all containers to become healthy (AI may take up to 2 minutes on first start):

```bash
docker compose ps
```

### 5. Open

| Service | Address |
|---|---|
| Web interface | `http://<your-ip>:9812` |
| SMB share | `\\<your-ip>\Uploads` (Windows) or `smb://<your-ip>/Uploads` (macOS/Linux) |

SMB login: `imgable` / your `IMGABLE_PASSWORD`.

### 6. Upload photos

Mount the SMB share as a network drive and drag your photos in. Any folder structure works. Duplicates are automatically skipped. Processing starts immediately.

## Proxmox LXC Installation

If you're running Proxmox, imgable works perfectly in an unprivileged LXC container.

### Create the container

In Proxmox UI:

| Setting | Value |
|---|---|
| Template | Ubuntu 22.04 or 24.04 |
| Unprivileged | Yes |
| Features | `nesting=1` (required for Docker) |
| CPU | 4+ cores |
| RAM | 8192 MB+ |
| Disk | 32 GB (system) |

### Mount your photo storage

On the Proxmox **host** (replace `100` with your container ID):

```bash
mkdir -p /DATA/Gallery
pct set 100 --mp0 /DATA/Gallery,mp=/mnt/Gallery
pct stop 100 && pct start 100
```

Inside the container, fix permissions for Docker's UID remapping:

```bash
chmod -R 777 /mnt/Gallery
```

### Install

Follow the [Quick Start](#quick-start-any-linux) above, but set `DATA_PATH` to your mount:

```env
DATA_PATH=/mnt/Gallery/imgable
```

## Updating

```bash
cd /opt/imgable
curl -O https://raw.githubusercontent.com/eduard256/imgable/master/docker-compose.yml
docker compose pull
docker compose up -d
```

## Configuration

All settings via `.env`. Only `IMGABLE_PASSWORD` is required.

| Variable | Default | Description |
|---|---|---|
| `IMGABLE_PASSWORD` | -- | Web interface password **(required)** |
| `DATA_PATH` | `/data/imgable` | Root path for all data |
| `API_PORT` | `9812` | Web interface port |
| `COMPOSE_PROFILES` | -- | Set to `smb` to enable network share |
| `WORKERS` | `4` | Parallel processing threads |
| `PREVIEW_QUALITY` | `85` | WebP preview quality (1-100) |
| `AI_THREADS` | `0` (auto) | CPU threads for AI processing |
| `AI_AUTO_START` | `true` | Start AI processing on boot |
| `LOG_LEVEL` | `info` | Logging verbosity |

## Data Structure

After first run, `DATA_PATH` will contain:

```
/data/imgable/
├── uploads/    # drop photos here (via SMB or manually)
├── media/      # processed previews and originals
├── failed/     # files that failed processing
└── db/
    ├── postgres/
    ├── redis/
    └── api/
```

## Resource Usage

| Service | Limit | Idle |
|---|---|---|
| PostgreSQL | 512 MB | ~50 MB |
| Redis | 300 MB | ~4 MB |
| API | 256 MB | ~4 MB |
| Scanner | 128 MB | ~3 MB |
| Processor | 1 GB | ~13 MB |
| Places | 64 MB | ~4 MB |
| AI | 2 GB | ~70 MB |
| SMB | 128 MB | ~21 MB |
| **Total** | **~4.5 GB** | **~170 MB** |

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, MapLibre GL |
| API | Go, chi, pgx, JWT |
| Processing | Go, libvips, ffmpeg |
| AI | Python, FastAPI, ONNX Runtime, SCRFD, ArcFace, CLIP, RapidOCR |
| Database | PostgreSQL 16, Redis 7 |
| Queue | Asynq (Redis-based) |

## License

MIT
