# =============================================================================
# Processor Service Dockerfile
# Multi-stage build with libvips and ffmpeg
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM golang:1.22-alpine AS builder

# Install build dependencies including vips
RUN apk add --no-cache \
    git \
    ca-certificates \
    tzdata \
    gcc \
    musl-dev \
    vips-dev \
    pkgconfig

# Set working directory
WORKDIR /app

# Copy all source code
COPY shared/ ./shared/
COPY processor/ ./processor/

# Download dependencies and build with CGO enabled (required for govips)
RUN cd shared && go mod tidy && \
    cd ../processor && go mod tidy && \
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o /processor \
    ./cmd

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    wget \
    # libvips and dependencies
    vips \
    vips-heif \
    vips-magick \
    vips-poppler \
    # ffmpeg for video processing
    ffmpeg

# Create non-root user
RUN addgroup -g 1000 imgable && \
    adduser -u 1000 -G imgable -s /bin/sh -D imgable

# Create directories
RUN mkdir -p /media /failed /tmp/imgable && \
    chown -R imgable:imgable /media /failed /tmp/imgable

# Copy binary from builder
COPY --from=builder /processor /usr/local/bin/processor

# Set ownership
RUN chown imgable:imgable /usr/local/bin/processor

# Switch to non-root user
USER imgable

# Expose API port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8002/health || exit 1

# Run processor
CMD ["processor"]
