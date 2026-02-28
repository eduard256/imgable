# =============================================================================
# Imgable API Server Dockerfile
# Multi-stage build: frontend (Node) + backend (Go) in one image
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the React frontend
# -----------------------------------------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /web

# Copy package files first for layer caching
COPY web/package.json web/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code and build
COPY web/ .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Build the Go binary
# -----------------------------------------------------------------------------
FROM golang:1.26-alpine3.22 AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

# Copy go mod files first for layer caching
COPY api/go.mod api/go.sum* ./

# Download dependencies
RUN go mod download

# Copy source code
COPY api/ .

# Build the binary with optimizations
# CGO_ENABLED=0 for static binary
# -ldflags="-s -w" strips debug info for smaller binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w" \
    -o /api \
    ./cmd/main.go

# -----------------------------------------------------------------------------
# Stage 3: Create minimal production image
# -----------------------------------------------------------------------------
FROM alpine:3.22

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    wget

# Create non-root user for security
RUN addgroup -g 1000 imgable && \
    adduser -u 1000 -G imgable -s /bin/sh -D imgable

# Create directories
RUN mkdir -p /data /media /uploads /static /api_data && \
    chown -R imgable:imgable /data /media /uploads /static /api_data

# Copy binary from builder
COPY --from=builder /api /usr/local/bin/api

# Copy database migrations
COPY migrations/ /migrations/

# Copy frontend build from stage 1
COPY --from=frontend /web/dist/ /static/

# Switch to non-root user
USER imgable

# Expose port
EXPOSE 9812

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:9812/health || exit 1

# Run the API server
CMD ["api"]
