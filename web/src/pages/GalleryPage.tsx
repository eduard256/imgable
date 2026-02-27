import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { t, getLang } from '../lib/i18n'

// ============================================================
// Gallery Page — Pinterest-style masonry, reverse chronological
//
// Top 70% of screen: photo grid.
// Newest photos at BOTTOM, oldest at TOP.
// User starts at bottom, scrolls UP for older photos.
// Prefetch when approaching top.
// Sticky date range label top-left.
// Pinch-to-zoom on mobile, +/- buttons for scale control.
// ============================================================

interface Photo {
  id: string
  type: 'photo' | 'video'
  small: string
  w: number
  h: number
  taken_at: number
  is_favorite: boolean
}

interface ApiResponse {
  photos: Photo[]
  next_cursor?: string
  has_more: boolean
}

interface Person {
  id: string
  name: string
  name_source: 'manual' | 'auto'
  photo_count: number
  face_url: string
  face_box: { x: number; y: number; w: number; h: number }
}

// Format date range for display
function formatDateRange(newest: number, oldest: number): string {
  const lang = getLang()
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'
  const nDate = new Date(newest * 1000)
  const oDate = new Date(oldest * 1000)

  const fmtShort = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const fmtFull = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  if (nDate.getFullYear() === oDate.getFullYear() && nDate.getMonth() === oDate.getMonth()) {
    return fmtFull.format(nDate)
  }
  if (nDate.getFullYear() === oDate.getFullYear()) {
    return `${fmtShort.format(oDate)} — ${fmtFull.format(nDate)}`
  }
  return `${fmtFull.format(oDate)} — ${fmtFull.format(nDate)}`
}

// Distribute photos into columns using shortest-column algorithm
function distributeToColumns(photos: Photo[], colCount: number, colWidth: number): Photo[][] {
  const columns: Photo[][] = Array.from({ length: colCount }, () => [])
  const heights: number[] = new Array(colCount).fill(0)

  for (const photo of photos) {
    let minIdx = 0
    for (let i = 1; i < colCount; i++) {
      if (heights[i] < heights[minIdx]) minIdx = i
    }
    columns[minIdx].push(photo)
    heights[minIdx] += (photo.h / photo.w) * colWidth
  }

  return columns
}

// Scale presets: column counts
const SCALE_PRESETS = [2, 3, 4, 5, 6, 8]
const DEFAULT_SCALE_INDEX = 2

export default function GalleryPage() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [scaleIndex, setScaleIndex] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 1
    return DEFAULT_SCALE_INDEX
  })
  const [dateRange, setDateRange] = useState('')
  const [darkOverlay, setDarkOverlay] = useState(0)
  const [people, setPeople] = useState<Person[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const initialScrollDone = useRef(false)
  const pinchStartDistance = useRef(0)

  const colCount = SCALE_PRESETS[scaleIndex]

  // Load photos page — API returns newest first
  const loadPhotos = useCallback(async (cursorParam: string | null) => {
    if (loadingRef.current) return
    loadingRef.current = true

    try {
      const url = cursorParam
        ? `/api/v1/photos?limit=100&sort=date&cursor=${cursorParam}`
        : '/api/v1/photos?limit=100&sort=date'

      const res = await apiFetch(url)
      if (!res.ok) return

      const data: ApiResponse = await res.json()

      setPhotos(prev => {
        const existingIds = new Set(prev.map(p => p.id))
        const newPhotos = data.photos.filter(p => !existingIds.has(p.id))
        // New pages are older photos — append to the end
        return [...prev, ...newPhotos]
      })

      setCursor(data.next_cursor ?? null)
      setHasMore(data.has_more)
    } finally {
      loadingRef.current = false
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadPhotos(null)

    // Load people for bottom section — sorted by photo_count desc (API default)
    apiFetch('/api/v1/people?limit=30&offset=0').then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      setPeople(data.people ?? [])
    }).catch(() => {})
  }, [loadPhotos])

  // After first load, scroll to bottom (newest photos)
  useEffect(() => {
    if (photos.length > 0 && !initialScrollDone.current) {
      // Use MutationObserver to wait for DOM to actually render
      const el = scrollRef.current
      if (!el) return

      // Target: 70% gallery visible + 30% bottom section peeking
      // Bottom section is 100vh. Boundary is at scrollHeight - 100vh.
      // We want boundary at 70% of viewport: S + 0.7 * clientHeight = scrollHeight - clientHeight
      // So S = scrollHeight - 1.7 * clientHeight
      const scrollToBoundary = () => {
        const target = el.scrollHeight - 1.7 * el.clientHeight
        el.scrollTop = Math.max(target, 0)
      }

      const observer = new MutationObserver(() => {
        if (el.scrollHeight > el.clientHeight) {
          scrollToBoundary()
          initialScrollDone.current = true
          observer.disconnect()
        }
      })

      observer.observe(el, { childList: true, subtree: true })

      // Also try immediately in case already rendered
      requestAnimationFrame(() => {
        if (!initialScrollDone.current && el.scrollHeight > el.clientHeight) {
          scrollToBoundary()
          initialScrollDone.current = true
          observer.disconnect()
        }
      })

      return () => observer.disconnect()
    }
  }, [photos.length])

  // Prefetch when scrolling near TOP (older photos are prepended visually at top)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    // Near the top = need older photos
    if (el.scrollTop < 1500 && hasMore && !loadingRef.current && cursor) {
      const prevScrollHeight = el.scrollHeight
      loadPhotos(cursor).then(() => {
        // After new photos added at top, maintain scroll position
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            const newScrollHeight = scrollRef.current.scrollHeight
            scrollRef.current.scrollTop += (newScrollHeight - prevScrollHeight)
          }
        })
      })
    }

    // Dark overlay based on scroll distance from the 70/30 boundary
    // Boundary position: scrollHeight - 1.7 * clientHeight
    const boundaryScrollTop = el.scrollHeight - 1.7 * el.clientHeight
    const distanceFromBoundary = boundaryScrollTop - el.scrollTop
    const progress = Math.min(Math.max(distanceFromBoundary, 0) / 1000, 1)
    setDarkOverlay(progress)

    updateDateRange()
  }, [hasMore, cursor, loadPhotos])

  const rafRef = useRef(0)
  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(handleScroll)
  }, [handleScroll])

  // Date range from visible area
  // Display order: top = oldest, bottom = newest
  // Data order (photos array): index 0 = newest, last = oldest
  // We reverse for display, so visual top = photos[last], visual bottom = photos[0]
  function updateDateRange() {
    const el = scrollRef.current
    if (!el || photos.length === 0) return

    const scrollTop = el.scrollTop
    const viewHeight = el.clientHeight
    const totalHeight = el.scrollHeight

    // Visual top ratio → maps to oldest (end of array)
    // Visual bottom ratio → maps to newest (start of array)
    const topRatio = Math.max(scrollTop / totalHeight, 0)
    const bottomRatio = Math.min((scrollTop + viewHeight) / totalHeight, 1)

    // Reversed: visual position maps inversely to array index
    const oldestIdx = Math.min(Math.floor((1 - topRatio) * photos.length), photos.length - 1)
    const newestIdx = Math.floor((1 - bottomRatio) * photos.length)

    const newestPhoto = photos[Math.max(newestIdx, 0)]
    const oldestPhoto = photos[oldestIdx]

    if (newestPhoto && oldestPhoto && newestPhoto.taken_at && oldestPhoto.taken_at) {
      setDateRange(formatDateRange(newestPhoto.taken_at, oldestPhoto.taken_at))
    }
  }

  // Zoom controls
  function zoomIn() {
    setScaleIndex(prev => Math.min(prev + 1, SCALE_PRESETS.length - 1))
  }
  function zoomOut() {
    setScaleIndex(prev => Math.max(prev - 1, 0))
  }

  // Pinch-to-zoom
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchStartDistance.current = Math.sqrt(dx * dx + dy * dy)
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const delta = dist - pinchStartDistance.current

      if (Math.abs(delta) > 50) {
        if (delta > 0) {
          setScaleIndex(prev => Math.min(prev + 1, SCALE_PRESETS.length - 1))
        } else {
          setScaleIndex(prev => Math.max(prev - 1, 0))
        }
        pinchStartDistance.current = dist
      }
    }
  }

  // Build columns — reverse photos so oldest is at top, newest at bottom
  const gap = colCount >= 6 ? 2 : 3
  const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const colWidth = (containerWidth - gap * (colCount + 1)) / colCount

  const reversed = [...photos].reverse()
  const columns = distributeToColumns(reversed, colCount, colWidth)

  return (
    <div className="fixed inset-0">
      {/* Dark terracotta overlay — fades in as user scrolls up */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: '#1A0F0A',
          opacity: darkOverlay * 0.92,
        }}
      />

      {/* Gallery — full screen scroll */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden"
        style={{ scrollSnapType: 'y proximity' }}
        onScroll={onScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {/* Masonry grid */}
        <div
          className="flex w-full items-end"
          style={{
            gap: `${gap}px`,
            padding: `${gap}px`,
            minHeight: '70vh',
          }}
        >
          {columns.map((col, colIdx) => (
            <div
              key={colIdx}
              className="flex flex-col flex-1"
              style={{ gap: `${gap}px` }}
            >
              {col.map((photo) => (
                <div
                  key={photo.id}
                  className="relative overflow-hidden cursor-pointer"
                  style={{
                    borderRadius: '4px',
                    aspectRatio: `${photo.w} / ${photo.h}`,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <img
                    src={photo.small}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-200"
                    style={{ display: 'block' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
                    }}
                  />
                  {photo.type === 'video' && (
                    <div
                      className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-xs"
                      style={{
                        background: 'rgba(0, 0, 0, 0.6)',
                        color: 'rgba(255, 255, 255, 0.9)',
                        fontSize: '10px',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white" className="inline mr-0.5">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Bottom section — scrollable below gallery, snap target */}
        <div
          style={{
            minHeight: '100vh',
            scrollSnapAlign: 'start',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '24px 16px',
          }}
        >
          {/* People section */}
          {people.length > 0 && (
            <div>
              {/* Section header: "People" + arrow */}
              <div
                className="flex items-center gap-2 cursor-pointer"
                style={{ marginBottom: '16px' }}
                onClick={() => {/* TODO: navigate to /people */}}
              >
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.85)',
                    fontSize: '17px',
                    fontWeight: 400,
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('people')}
                </span>
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="rgba(255,255,255,0.5)"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>

              {/* Horizontal scrollable grid: 2 rows */}
              <div className="overflow-x-auto overflow-y-hidden hide-scrollbar">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: 'repeat(2, 1fr)',
                    gridAutoFlow: 'column',
                    gridAutoColumns: 'max-content',
                    gap: '16px 12px',
                    paddingBottom: '4px',
                  }}
                >
                  {people.map((person) => {
                    // Zoom into face region using object-position + scale
                    const box = person.face_box
                    const scale = 1 / Math.max(box.w, box.h) * 0.75

                    return (
                      <div
                        key={person.id}
                        className="flex flex-col items-center"
                        style={{ width: '100px' }}
                      >
                        {/* Square avatar with rounded corners */}
                        <div
                          className="relative overflow-hidden"
                          style={{
                            width: '100px',
                            height: '100px',
                            borderRadius: '16px',
                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          }}
                        >
                          <img
                            src={person.face_url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            style={{
                              position: 'absolute',
                              top: '0',
                              left: '0',
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              objectPosition: `${(box.x + box.w / 2) * 100}% ${(box.y + box.h / 2) * 100}%`,
                              transform: `scale(${scale})`,
                            }}
                          />
                        </div>
                        {/* Name — only if manually set */}
                        {person.name_source === 'manual' && (
                          <span
                            style={{
                              marginTop: '6px',
                              fontSize: '11px',
                              color: 'rgba(255, 255, 255, 0.6)',
                              fontWeight: 300,
                              textAlign: 'center',
                              lineHeight: '1.2',
                              maxWidth: '100px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {person.name}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Date range label — sticky top left */}
      {dateRange && (
        <div
          className="fixed z-20"
          style={{
            top: '12px',
            left: '16px',
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: '13px',
            fontWeight: 300,
            letterSpacing: '0.5px',
            background: 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            padding: '6px 14px',
            borderRadius: '20px',
          }}
        >
          {dateRange}
        </div>
      )}

      {/* Zoom controls — right side */}
      <div
        className="fixed z-20 flex flex-col gap-1"
        style={{ top: '12px', right: '16px' }}
      >
        <button
          onClick={zoomOut}
          disabled={scaleIndex === 0}
          className="rounded-full transition-all duration-200"
          style={{
            width: '36px',
            height: '36px',
            background: 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            border: 'none',
            color: scaleIndex === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
            cursor: scaleIndex === 0 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            if (scaleIndex > 0) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.25)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          onClick={zoomIn}
          disabled={scaleIndex === SCALE_PRESETS.length - 1}
          className="rounded-full transition-all duration-200"
          style={{
            width: '36px',
            height: '36px',
            background: 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            border: 'none',
            color: scaleIndex === SCALE_PRESETS.length - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
            cursor: scaleIndex === SCALE_PRESETS.length - 1 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            if (scaleIndex < SCALE_PRESETS.length - 1) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.25)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
