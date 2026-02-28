# =============================================================================
# Places Service Dockerfile
# Multi-stage build for minimal image size
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM golang:1.26-alpine3.22 AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /app

# Copy all source code
COPY shared/ ./shared/
COPY places/ ./places/

# Download dependencies and build
RUN cd shared && go mod tidy && \
    cd ../places && go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o /places \
    ./cmd

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM alpine:3.22

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    wget

# Create non-root user
RUN addgroup -g 1000 imgable && \
    adduser -u 1000 -G imgable -s /bin/sh -D imgable

# Copy binary from builder
COPY --from=builder /places /usr/local/bin/places

# Set ownership
RUN chown imgable:imgable /usr/local/bin/places

# Switch to non-root user
USER imgable

# Expose API port
EXPOSE 8003

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8003/health || exit 1

# Run places service
CMD ["places"]
