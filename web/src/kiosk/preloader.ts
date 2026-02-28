// ============================================================
// Kiosk Mode — Image preloader
//
// Manages a two-tier preload pipeline:
//   Tier 1: Currently visible photos (already loaded)
//   Tier 2: Next batch preloading via `new Image()`
//
// Handles queue cycling: when all photos have been shown,
// reshuffles and starts over.
// ============================================================

/** Shuffle an array in place using Fisher-Yates. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export interface PreloaderOptions {
  /** Share code for building URLs. */
  code: string
  /** Optional password for protected shares. */
  password?: string
  /** How many images to preload ahead. */
  preloadAhead?: number
}

/**
 * ImagePreloader manages photo queue and preloading for the kiosk.
 *
 * Usage:
 *   const preloader = new ImagePreloader(options)
 *   preloader.setPhotoIds([...all IDs...])
 *   const nextId = preloader.next()  // get next photo to display
 *   preloader.preloadNext(20)        // trigger background preloading
 */
export class ImagePreloader {
  private allIds: string[] = []
  private queue: string[] = []
  private queueIndex = 0
  private preloadCache = new Set<string>()
  private code: string
  private password?: string
  private preloadAhead: number

  constructor(opts: PreloaderOptions) {
    this.code = opts.code
    this.password = opts.password
    this.preloadAhead = opts.preloadAhead ?? 20
  }

  /** Set the full list of photo IDs. Shuffles and resets the queue. */
  setPhotoIds(ids: string[]): void {
    this.allIds = [...ids]
    this.resetQueue()
  }

  /** Get the total number of photos available. */
  get totalCount(): number {
    return this.allIds.length
  }

  /** Build a photo URL for a given ID and size. */
  buildUrl(id: string, size: 'small' | 'large'): string {
    let url = `/s/${this.code}/photo/${size}?id=${id}`
    if (this.password) url += `&password=${encodeURIComponent(this.password)}`
    return url
  }

  /** Get the next photo ID from the queue. Reshuffles when exhausted. */
  next(): string {
    if (this.allIds.length === 0) return ''

    if (this.queueIndex >= this.queue.length) {
      this.resetQueue()
    }

    const id = this.queue[this.queueIndex]
    this.queueIndex++
    return id
  }

  /** Peek at the next N photo IDs without consuming them. */
  peek(count: number): string[] {
    const result: string[] = []
    let idx = this.queueIndex

    for (let i = 0; i < count && this.allIds.length > 0; i++) {
      if (idx >= this.queue.length) {
        // Would wrap — just return what we have
        break
      }
      result.push(this.queue[idx])
      idx++
    }

    return result
  }

  /**
   * Preload the next N images in the background using `new Image()`.
   * Skips images that are already cached.
   */
  preloadNext(count?: number, size: 'small' | 'large' = 'small'): void {
    const n = count ?? this.preloadAhead
    const upcoming = this.peek(n)

    for (const id of upcoming) {
      const url = this.buildUrl(id, size)
      if (this.preloadCache.has(url)) continue

      this.preloadCache.add(url)
      const img = new Image()
      img.src = url
    }
  }

  /** Reshuffle the queue and reset the index. */
  private resetQueue(): void {
    this.queue = shuffle([...this.allIds])
    this.queueIndex = 0
  }

  /** Clear preload cache (useful for memory management). */
  clearCache(): void {
    this.preloadCache.clear()
  }
}
