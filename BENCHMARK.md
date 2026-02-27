# Processing Performance Benchmark

## Test Environment

| Parameter | Value |
|-----------|-------|
| CPU | 8 cores @ ~3.9 GHz |
| RAM | 15.6 GB |
| Storage | SSD (separate data disk) |
| Dataset | ImageNet 2012 (JPEG images, ~100KB avg) |

## Test Results: 2 Workers

| Metric | Value |
|--------|-------|
| Photos processed | 32,505 |
| Time | 23 min 14 sec |
| Speed | ~23.4 photos/sec (~1,400 photos/min) |

### System Load (2 workers)

| Resource | Usage |
|----------|-------|
| CPU | ~31% (load avg ~2.2-2.3) |
| RAM | ~2.8-3.6 GB (20-24%) |
| Disk I/O | ~4.6% utilization (not a bottleneck) |
| Disk read | ~3.1 MB/s |
| Disk write | ~0.9 MB/s |

### Configuration (2 workers)

```env
WORKERS=2
MAX_MEMORY_MB=512
```

## Test Results: 8 Workers

| Metric | Value |
|--------|-------|
| Photos processed | 32,317 |
| Time | 11 min |
| Speed | ~49 photos/sec (~2,950 photos/min) |

### System Load (8 workers)

| Resource | Usage |
|----------|-------|
| CPU | ~76-80% (load avg ~9.5) |
| RAM | ~2.7 GB (20%) |
| Disk I/O | ~11% utilization |

### Configuration (8 workers)

```env
WORKERS=8
MAX_MEMORY_MB=6144
```

## Performance Comparison

| Workers | Photos | Time | Speed | Speedup |
|---------|--------|------|-------|---------|
| 2 | 32,505 | 23 min 14 sec | ~23 photos/sec | 1x |
| 8 | 32,317 | 11 min | ~49 photos/sec | **2.1x** |

Note: Scaling is ~2x instead of theoretical 4x, indicating some overhead or bottleneck beyond pure CPU parallelization.

## Known Issues

### Future dates in photo metadata

Some photos have invalid dates in metadata (e.g., "June 2099", "January 2048").

**TODO:** Add date validation in processor - if photo's metadata date is in the future (after current date), set date to null instead of using the invalid value.

## Storage Analysis

| Folder | Size | Photos |
|--------|------|--------|
| Source (25 classes from ImageNet) | ~3.8 GB | 32,505 |
| Processed media (thumbnails) | 2.8 GB | 32,505 |

- Compression ratio: **~1.4:1** (source to processed)
- Average source image: ~117 KB
- Average processed output: ~86 KB
- Note: ImageNet images are already small, typical photos would show higher compression

## Notes

- Disk I/O is not a bottleneck (only ~5% utilization with 2 workers)
- CPU scales linearly with worker count
- Memory usage is minimal (~200-300 MB per worker)
- Processor service has no CPU limit in docker-compose, only memory limit
