#!/bin/bash
# Reset script for imgable - cleans DB, media files, rebuilds and restarts everything
# Usage: ./scripts/reset.sh [--no-build] [--with-models]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# Parse arguments
NO_BUILD=false
WITH_MODELS=false
for arg in "$@"; do
    case $arg in
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --with-models)
            WITH_MODELS=true
            shift
            ;;
    esac
done

# Confirmation
echo -e "${RED}WARNING: This will delete ALL data including:${NC}"
echo "  - Database (photos, albums, places, AI tags, settings)"
echo "  - All processed media files"
echo "  - Redis queue data"
if [ "$WITH_MODELS" = true ]; then
    echo "  - AI models cache (--with-models)"
fi
echo ""
read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Stop containers
log "Stopping containers..."
docker compose down

# Remove volumes
log "Removing volumes..."
docker volume rm imgable-postgres-data imgable-redis-data imgable-api-data 2>/dev/null || true
if [ "$WITH_MODELS" = true ]; then
    log "Removing AI models cache..."
    docker volume rm imgable-ai-models 2>/dev/null || true
fi

# Clean media directories
log "Cleaning media directories..."
DATA_DIR="$PROJECT_DIR/data"
if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR/media/"* 2>/dev/null || true
    rm -rf "$DATA_DIR/uploads/"* 2>/dev/null || true
    rm -rf "$DATA_DIR/failed/"* 2>/dev/null || true
    log "Cleaned: $DATA_DIR/{media,uploads,failed}"
fi

# Rebuild if needed
if [ "$NO_BUILD" = false ]; then
    log "Rebuilding images..."
    docker compose build --no-cache
else
    warn "Skipping rebuild (--no-build)"
fi

# Start containers
log "Starting containers..."
docker compose up -d

# Wait for health checks
log "Waiting for containers to be healthy..."
sleep 5

MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    UNHEALTHY=$(docker compose ps --format json | grep -c '"health": "starting"' 2>/dev/null || echo "0")
    if [ "$UNHEALTHY" = "0" ]; then
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done

# Show status
echo ""
log "Final status:"
docker compose ps

# Check if all healthy
HEALTHY_COUNT=$(docker compose ps --format json | grep -c '"healthy"' 2>/dev/null || echo "0")
if [ "$HEALTHY_COUNT" -ge 6 ]; then
    echo ""
    log "Reset complete! All services are healthy."
else
    warn "Some services may not be healthy yet. Check logs with: docker compose logs"
fi
