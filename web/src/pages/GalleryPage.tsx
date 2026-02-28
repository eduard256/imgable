import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { t, getLang } from '../lib/i18n'
import MapPreview from '../components/MapPreview'
import UploadManager from '../components/UploadManager'
import type { UploadManagerHandle } from '../components/UploadManager'
import PhotoViewer from '../components/PhotoViewer'
import type { ViewerPhoto } from '../components/PhotoViewer'
import { SelectBarBtn, AlbumPickerModal, BulkShareModal, BulkKioskModal, SelectModalOverlay, modalInputStyle } from '../components/SelectionBar'
import type { PickerAlbum } from '../components/SelectionBar'
import { useDragSelect } from '../hooks/useDragSelect'

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

interface Album {
  id: string
  type: 'manual' | 'favorites' | 'place'
  name: string
  photo_count: number
  cover?: string
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

// Photo with tracked reversed-array index for viewer mapping
interface IndexedPhoto extends Photo {
  _rIdx: number
}

// Distribute photos into columns using shortest-column algorithm
function distributeToColumns(photos: IndexedPhoto[], colCount: number, colWidth: number): IndexedPhoto[][] {
  const columns: IndexedPhoto[][] = Array.from({ length: colCount }, () => [])
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

export default function GalleryPage({ onOpenPeople, onOpenPerson, onOpenAlbums, onOpenAlbum, onOpenFolders, onOpenMap, onOpenAdmin }: { onOpenPeople: () => void; onOpenPerson: (id: string) => void; onOpenAlbums: () => void; onOpenAlbum: (id: string) => void; onOpenFolders?: () => void; onOpenMap?: () => void; onOpenAdmin?: () => void }) {
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
  const [albums, setAlbums] = useState<Album[]>([])
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [viewerRect, setViewerRect] = useState<DOMRect | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const masonryRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const initialScrollDone = useRef(false)
  const pinchStartDistance = useRef(0)
  const uploadRef = useRef<UploadManagerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Drag-select hook
  const {
    selectMode, setSelectMode, selectedIds, liveCount,
    exitSelectMode, pointerHandlers, selectBaseSet, selectLiveSet, longPressTriggered,
  } = useDragSelect({ photos, scrollRef, gridRef: masonryRef })

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

    // Load albums for bottom section
    apiFetch('/api/v1/albums').then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      setAlbums(data.albums ?? [])
    }).catch(() => {})
  }, [loadPhotos])

  // After first load, scroll to bottom (newest photos)
  useEffect(() => {
    if (photos.length > 0 && !initialScrollDone.current) {
      // Use MutationObserver to wait for DOM to actually render
      const el = scrollRef.current
      if (!el) return

      // Target: 70% gallery visible + 30% bottom section peeking
      // Boundary = bottom edge of masonry grid (measured via ref)
      // We want that boundary at 70% of viewport height
      // So scrollTop = masonryHeight - 0.7 * clientHeight
      const scrollToBoundary = () => {
        const masonryHeight = masonryRef.current?.offsetHeight ?? el.scrollHeight
        const target = masonryHeight - 0.7 * el.clientHeight
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
    // Boundary = masonry bottom edge, shown at 70% of viewport
    const masonryHeight = masonryRef.current?.offsetHeight ?? el.scrollHeight
    const boundaryScrollTop = masonryHeight - 0.7 * el.clientHeight
    const distanceFromBoundary = boundaryScrollTop - el.scrollTop
    const progress = Math.round(Math.min(Math.max(distanceFromBoundary, 0) / 1000, 1) * 100) / 100
    setDarkOverlay(prev => prev === progress ? prev : progress)

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

  // Open photo viewer — map from reversed display index to original photos array index
  function openViewer(reversedIdx: number, element: HTMLElement) {
    // reversed array: index 0 = oldest (photos[photos.length-1]), last = newest (photos[0])
    // original photos array: index 0 = newest, last = oldest
    const originalIdx = photos.length - 1 - reversedIdx
    const rect = element.getBoundingClientRect()
    setViewerRect(rect)
    setViewerIndex(originalIdx)
    setViewerOpen(true)
  }

  function handleViewerClose(currentIndex: number, viewerPhotos: ViewerPhoto[]) {
    // Update photos array from viewer (may have been modified by favorite/delete)
    setPhotos(viewerPhotos as Photo[])
    setViewerOpen(false)

    // Scroll to the photo in the grid (best effort)
    // currentIndex is in the original (newest-first) array
    // In reversed display, it maps to: reversedIdx = photos.length - 1 - currentIndex
    const reversedIdx = viewerPhotos.length - 1 - currentIndex
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      const photoEl = el.querySelector(`[data-viewer-idx="${reversedIdx}"]`) as HTMLElement | null
      if (photoEl) {
        photoEl.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
    })
  }

  const handlePhotosChanged = useCallback((vp: ViewerPhoto[]) => {
    setPhotos(vp as Photo[])
  }, [])

  function handleViewerLoadMore() {
    if (hasMore && !loadingRef.current && cursor) {
      loadPhotos(cursor)
    }
  }

  // ============================================================
  // Selection action modals and batch operations
  // ============================================================
  const [showAlbumPicker, setShowAlbumPicker] = useState(false)
  const [albumList, setAlbumList] = useState<PickerAlbum[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [showKioskModal, setShowKioskModal] = useState(false)

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    const msg = t('delete_selected_confirm').replace('{n}', String(selectedIds.size))
    if (!confirm(msg)) return
    try {
      await apiFetch('/api/v1/photos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      setPhotos(prev => prev.filter(p => !selectedIds.has(p.id)))
      exitSelectMode()
    } catch { /* ignore */ }
  }, [selectedIds, exitSelectMode])

  const handleBulkFavorite = useCallback(async () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10)
      await Promise.all(batch.map(id =>
        apiFetch(`/api/v1/photos/${id}/favorite`, { method: 'POST' }).catch(() => {})
      ))
    }
    setPhotos(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, is_favorite: true } : p))
    exitSelectMode()
  }, [selectedIds, exitSelectMode])

  const handleOpenAlbumPicker = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/albums')
      if (!res.ok) return
      const data = await res.json()
      setAlbumList((data.albums ?? []).filter((a: PickerAlbum) => a.type === 'manual' || a.type === 'favorites'))
      setShowAlbumPicker(true)
    } catch { /* ignore */ }
  }, [])

  const handleAddToAlbum = useCallback(async (albumId: string) => {
    if (selectedIds.size === 0) return
    try {
      await apiFetch(`/api/v1/albums/${albumId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: Array.from(selectedIds) }),
      })
      setShowAlbumPicker(false)
      exitSelectMode()
    } catch { /* ignore */ }
  }, [selectedIds, exitSelectMode])

  // Build columns — reverse photos so oldest is at top, newest at bottom
  const gap = colCount >= 6 ? 2 : 3
  const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const colWidth = (containerWidth - gap * (colCount + 1)) / colCount

  const reversed: IndexedPhoto[] = [...photos].reverse().map((p, i) => ({ ...p, _rIdx: i }))
  const columns = distributeToColumns(reversed, colCount, colWidth)

  return (
    <div className="fixed inset-0">
      {/* Dark overlay — fades in as user scrolls up into older photos */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: '#2C1F14',
          opacity: darkOverlay * 0.85,
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
          ref={masonryRef}
          className="flex w-full items-end"
          style={{
            gap: `${gap}px`,
            padding: `${gap}px`,
            minHeight: '70vh',
            ...(selectMode ? { touchAction: 'none' } : {}),
          }}
          {...pointerHandlers}
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
                  data-viewer-idx={photo._rIdx}
                  data-photo-id={photo.id}
                  className={`photo-grid-item relative overflow-hidden cursor-pointer${selectedIds.has(photo.id) ? ' photo-selected' : ''}`}
                  onClick={(e) => {
                    // In select mode, pointer handlers manage selection — block viewer open
                    if (selectMode) { e.preventDefault(); return }
                    // After long press triggered select mode, suppress the click
                    if (longPressTriggered.current) { e.preventDefault(); return }
                    openViewer(photo._rIdx, e.currentTarget as HTMLElement)
                  }}
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
                    className="w-full h-full object-cover"
                    style={{
                      display: 'block',
                      transition: 'transform 0.2s ease',
                      pointerEvents: 'none',
                    }}
                  />
                  {/* Selection checkmark overlay */}
                  <div className="select-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
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
            borderTop: '1px solid rgba(61, 43, 31, 0.1)',
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
                onClick={onOpenPeople}
              >
                <span
                  style={{
                    color: '#3D2B1F',
                    fontSize: '17px',
                    fontWeight: 500,
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('people')}
                </span>
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="#5C4033"
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
                    const scale = 1

                    return (
                      <div
                        key={person.id}
                        className="flex flex-col items-center cursor-pointer"
                        style={{ width: '100px' }}
                        onClick={() => onOpenPerson(person.id)}
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
                          {/* Name overlay on photo — only if manually set */}
                          {person.name_source === 'manual' && (
                            <div
                              style={{
                                position: 'absolute',
                                bottom: '0',
                                left: '0',
                                right: '0',
                                padding: '16px 6px 6px',
                                background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '18px',
                                  color: '#fff',
                                  fontWeight: 400,
                                  display: 'block',
                                  textAlign: 'center',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {person.name}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Albums section */}
          {albums.length > 0 && (
            <div style={{ marginTop: '28px' }}>
              {/* Section header: "Albums" + arrow */}
              <div
                className="flex items-center gap-2 cursor-pointer"
                style={{ marginBottom: '16px' }}
                onClick={onOpenAlbums}
              >
                <span
                  style={{
                    color: '#3D2B1F',
                    fontSize: '17px',
                    fontWeight: 500,
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('albums')}
                </span>
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="#5C4033"
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
                    gap: '12px',
                    paddingBottom: '4px',
                  }}
                >
                  {albums.map((album) => (
                    <div
                      key={album.id}
                      className="relative overflow-hidden cursor-pointer"
                      onClick={() => onOpenAlbum(album.id)}
                      style={{
                        width: '160px',
                        height: '100px',
                        borderRadius: '14px',
                        backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      }}
                    >
                      {album.cover && (
                        <img
                          src={album.cover}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      )}
                      {/* Gradient overlay with name */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          padding: '20px 8px 8px',
                          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                        }}
                      >
                        <div style={{
                          fontSize: '13px',
                          color: '#fff',
                          fontWeight: 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {album.name}
                        </div>
                        <div style={{
                          fontSize: '11px',
                          color: 'rgba(255, 255, 255, 0.55)',
                          fontWeight: 300,
                          marginTop: '1px',
                        }}>
                          {album.photo_count}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Map section */}
          <div style={{ marginTop: '28px' }}>
            {/* Section header: "Map" + arrow */}
            <div
              className="flex items-center gap-2 cursor-pointer"
              style={{ marginBottom: '16px' }}
              onClick={onOpenMap}
            >
              <span
                style={{
                  color: '#3D2B1F',
                  fontSize: '17px',
                  fontWeight: 500,
                  letterSpacing: '0.5px',
                }}
              >
                {t('map')}
              </span>
              <svg
                width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="#5C4033"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>

            <MapPreview />
          </div>
        </div>
      </div>

      {/* Date range label — sticky top left */}
      {dateRange && (
        <div
          className="fixed z-20"
          style={{
            top: '12px',
            left: '16px',
            color: '#3D2B1F',
            fontSize: '13px',
            fontWeight: 400,
            letterSpacing: '0.5px',
            background: 'rgba(255, 255, 255, 0.45)',
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

        {/* Select mode button */}
        <button
          onClick={() => {
            if (selectMode) exitSelectMode()
            else { setSelectMode(true); selectBaseSet.current = new Set(); selectLiveSet.current = new Set() }
          }}
          className="rounded-full transition-all duration-200"
          style={{
            width: '36px',
            height: '36px',
            marginTop: '4px',
            background: selectMode ? 'rgba(183, 101, 57, 0.7)' : 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = selectMode ? 'rgba(183, 101, 57, 0.85)' : 'rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = selectMode ? 'rgba(183, 101, 57, 0.7)' : 'rgba(0,0,0,0.25)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>

        {/* Folders button */}
        <button
          onClick={() => onOpenFolders?.()}
          className="rounded-full transition-all duration-200"
          style={{
            width: '36px',
            height: '36px',
            marginTop: '4px',
            background: 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.25)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </button>

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full transition-all duration-200"
          style={{
            width: '36px',
            height: '36px',
            marginTop: '4px',
            background: 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.25)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>

        {/* Admin button */}
        <button
          onClick={onOpenAdmin}
          className="rounded-full transition-all duration-200"
          style={{
            width: '36px',
            height: '36px',
            marginTop: '4px',
            background: 'rgba(0, 0, 0, 0.25)',
            backdropFilter: 'blur(12px)',
            border: 'none',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.25)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

        {/* Hidden file input for upload button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length > 0) {
              uploadRef.current?.addFiles(Array.from(files))
              e.target.value = ''
            }
          }}
        />
      </div>

      {/* Selection bottom bar */}
      {selectMode && (
        <div
          className="fixed z-30 flex items-center"
          style={{
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(44, 31, 20, 0.75)',
            backdropFilter: 'blur(16px)',
            borderRadius: '24px',
            padding: '6px 10px',
            gap: '4px',
            animation: 'selectBarSlideUp 0.25s ease-out',
          }}
        >
          {/* Left group: Add to Album, Favorite */}
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={handleOpenAlbumPicker}
            title={t('add_to_album')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={handleBulkFavorite}
            title={t('favorite')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </SelectBarBtn>

          {/* Counter */}
          <span style={{
            color: 'rgba(255, 255, 255, 0.9)',
            fontSize: '13px',
            fontWeight: 400,
            whiteSpace: 'nowrap',
            padding: '0 8px',
            minWidth: '60px',
            textAlign: 'center',
          }}>
            {liveCount} {t('selected_count')}
          </span>

          {/* Right group: Share, Kiosk, Delete, Close */}
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={() => setShowShareModal(true)}
            title={t('share')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={() => setShowKioskModal(true)}
            title={t('kiosk')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={handleBulkDelete}
            title={t('delete')}
            variant="danger"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </SelectBarBtn>

          {/* Close / exit select mode */}
          <SelectBarBtn onClick={exitSelectMode} title={t('close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </SelectBarBtn>
        </div>
      )}

      {/* Album picker modal */}
      {showAlbumPicker && (
        <AlbumPickerModal
          albums={albumList}
          onSelect={handleAddToAlbum}
          onClose={() => setShowAlbumPicker(false)}
        />
      )}

      {/* Share modal */}
      {showShareModal && (
        <BulkShareModal
          photoIds={Array.from(selectedIds)}
          onClose={() => setShowShareModal(false)}
          onDone={() => { setShowShareModal(false); exitSelectMode() }}
        />
      )}

      {/* Kiosk modal */}
      {showKioskModal && (
        <BulkKioskModal
          photoIds={Array.from(selectedIds)}
          onClose={() => setShowKioskModal(false)}
          onDone={() => { setShowKioskModal(false); exitSelectMode() }}
        />
      )}

      {/* Upload manager — handles drag & drop + toast progress */}
      <UploadManager ref={uploadRef} containerRef={scrollRef} />

      {/* Photo viewer — fullscreen viewer overlay */}
      {viewerOpen && (
        <PhotoViewer
          photos={photos as ViewerPhoto[]}
          startIndex={viewerIndex}
          syncScroll={true}
          onClose={handleViewerClose}
          onLoadMore={handleViewerLoadMore}
          onPhotosChanged={handlePhotosChanged}
          thumbnailRect={viewerRect}
        />
      )}
    </div>
  )
}

// SelectBarBtn, AlbumPickerModal, BulkShareModal, BulkKioskModal, SelectModalOverlay, modalInputStyle
// are imported from '../components/SelectionBar'
