# Imgable

Self-hosted family photo gallery. Fast, simple, built to last decades.

## Features

- Instant photo loading in browser (preloading + blurhash placeholders)
- Automatic processing: any format → WebP, three preview sizes
- Albums, favorites, auto-albums by location
- Map with photo geolocation
- TV mode: screensavers, slideshows, visual effects
- Link sharing (with or without password)
- Single user, JWT authentication

## Tech Stack

- Python, FastAPI, PostgreSQL
- Docker Compose
- No external dependencies, works locally

## Requirements

- 1+ TB storage
- Docker
- Local network 100+ Mbps for instant loading

## Quick Start

```bash
docker compose up -d
```

## License

MIT
