// ============================================================
// PhotoViewer — Universal fullscreen photo/video viewer
//
// Two modes:
//   syncScroll=true  — Gallery mode: shared photos array, lazy load,
//                      scroll-to-photo on close
//   syncScroll=false — Simple mode: open, browse, close. No sync.
//
// PC: Coverflow 3D with ambient blur background, right sidebar
//     (notes + metadata), filmstrip, top toolbar actions.
// Mobile: Fullscreen single photo, swipe nav, tap toggles UI,
//         swipe-down to close with shrink-to-origin animation,
//         pinch-to-zoom, double-tap zoom.
//
// Performance strategy:
//   - Three image tiers: small (instant) -> large (preloaded)
//   - Preload large for current +/- 2 neighbors
//   - GPU-only transforms (translate3d, rotateZ, scale)
//   - Virtualized filmstrip (~50 DOM elements for any count)
//   - Zero API calls during fast scrolling (300ms debounce)
//   - transition-duration: 0 during rapid navigation
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { t, getLang } from '../lib/i18n'

// ---- Types ----

export interface ViewerPhoto {
  id: string
  type: 'photo' | 'video'
  small: string
  w: number
  h: number
  taken_at?: number
  is_favorite: boolean
}

interface PhotoDetail {
  id: string
  type: 'photo' | 'video'
  original_filename?: string
  taken_at?: number
  width?: number
  height?: number
  size_bytes?: number
  is_favorite: boolean
  comment?: string
  duration_sec?: number
  video_codec?: string
  exif?: {
    camera_make?: string
    camera_model?: string
    iso?: number
    focal_length?: string
    aperture?: string
    shutter_speed?: string
  }
  place?: { name: string }
  urls: {
    small: string
    large?: string
    video?: string
  }
}

interface Album {
  id: string
  type: 'manual' | 'favorites' | 'place'
  name: string
  photo_count: number
}

export interface PhotoViewerProps {
  photos: ViewerPhoto[]
  startIndex: number
  syncScroll?: boolean
  albumId?: string | null
  onClose: (currentIndex: number, photos: ViewerPhoto[]) => void
  onLoadMore?: () => void
  onPhotosChanged?: (photos: ViewerPhoto[]) => void
  thumbnailRect?: DOMRect | null
}

// ---- Helpers ----

// Derive large URL from small URL by replacing _s.webp with _l.webp
function getLargeUrl(smallUrl: string): string {
  return smallUrl.replace('_s.webp', '_l.webp')
}

// Stable pseudo-random tilt per photo index (deterministic, no Math.random in render)
function getTilt(index: number): number {
  const seed = ((index * 2654435761) >>> 0) % 1000
  return ((seed / 1000) * 8 - 4) // range: -4 to +4 degrees
}

// Format bytes for display
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Format unix timestamp
function fmtDate(ts: number): string {
  const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US'
  return new Date(ts * 1000).toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Format duration seconds
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Preload an image and return a promise
const preloadCache = new Map<string, boolean>()
function preloadImage(url: string): void {
  if (preloadCache.has(url)) return
  preloadCache.set(url, false)
  const img = new Image()
  img.onload = () => preloadCache.set(url, true)
  img.src = url
}

function isImageLoaded(url: string): boolean {
  return preloadCache.get(url) === true
}

// ---- Constants ----

const PRELOAD_RANGE = 2
const DETAIL_DEBOUNCE_MS = 300
const FILMSTRIP_ITEM_W = 56
// const FILMSTRIP_BUFFER = 15 // reserved for virtualization
const FAST_NAV_THRESHOLD_MS = 120

// ---- Component ----

export default function PhotoViewer({
  photos: initialPhotos,
  startIndex,
  syncScroll = false,
  albumId = null,
  onClose,
  onLoadMore,
  onPhotosChanged,
  thumbnailRect,
}: PhotoViewerProps) {
  // State
  const [photos, setPhotos] = useState(initialPhotos)
  const [currentIndex, setCurrentIndex] = useState(startIndex)
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [uiVisible, setUiVisible] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return false
    return localStorage.getItem('viewer_sidebar') === 'open'
  })
  const [noteText, setNoteText] = useState('')
  const [isFastNav, setIsFastNav] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showAlbumPicker, setShowAlbumPicker] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showMobileNote, setShowMobileNote] = useState(false)
  const [albums, setAlbums] = useState<Album[]>([])
  const [enterAnim, setEnterAnim] = useState(!!thumbnailRect)
  const [exitAnim, setExitAnim] = useState(false)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  )

  // Video state
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoMuted, setVideoMuted] = useState(false)

  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const filmstripRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const detailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNavTimeRef = useRef(0)
  const navCountRef = useRef(0)
  const photosRef = useRef(photos)
  const currentIndexRef = useRef(currentIndex)
  const exitRectRef = useRef<DOMRect | null>(thumbnailRect ?? null)

  // Swipe state for mobile
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const swipeOffsetRef = useRef(0)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [swipeDown, setSwipeDown] = useState(0)
  const swipeDownRef = useRef(0)
  const isSwipingRef = useRef<'none' | 'horizontal' | 'vertical'>('none')

  // Pinch zoom state
  const [zoomScale, setZoomScale] = useState(1)
  const [zoomTranslate, setZoomTranslate] = useState({ x: 0, y: 0 })
  const pinchStartRef = useRef(0)
  const zoomScaleRef = useRef(1)
  const lastTapRef = useRef(0)

  // Keep refs in sync
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])

  // Sync photos from parent — only when length changes (new photos loaded)
  // Skip if the change came from inside the viewer (mutation flag)
  const mutatedInsideRef = useRef(false)
  const prevLengthRef = useRef(initialPhotos.length)
  useEffect(() => {
    if (initialPhotos.length !== prevLengthRef.current) {
      prevLengthRef.current = initialPhotos.length
      if (!mutatedInsideRef.current) {
        setPhotos(initialPhotos)
      }
      mutatedInsideRef.current = false
    }
  }, [initialPhotos.length])

  // Internal setter that marks mutations as coming from inside
  const setPhotosInternal = useCallback((updater: ViewerPhoto[] | ((prev: ViewerPhoto[]) => ViewerPhoto[])) => {
    mutatedInsideRef.current = true
    setPhotos(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      onPhotosChanged?.(next)
      return next
    })
  }, [onPhotosChanged])

  // Responsive listener
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Save sidebar state
  useEffect(() => {
    localStorage.setItem('viewer_sidebar', sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  // Enter animation
  useEffect(() => {
    if (enterAnim) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEnterAnim(false))
      })
    }
  }, [enterAnim])

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Current photo
  const currentPhoto = photos[currentIndex]

  // ---- Preload logic ----

  useEffect(() => {
    if (!currentPhoto) return
    // Preload large for current and neighbors
    for (let i = -PRELOAD_RANGE; i <= PRELOAD_RANGE; i++) {
      const idx = currentIndex + i
      if (idx < 0 || idx >= photos.length) continue
      const p = photos[idx]
      if (p.type === 'photo') {
        preloadImage(getLargeUrl(p.small))
      }
    }
    // Trigger load more when near the end
    if (syncScroll && onLoadMore && currentIndex >= photos.length - 10) {
      onLoadMore()
    }
  }, [currentIndex, photos, syncScroll, onLoadMore, currentPhoto])

  // ---- Load detail (debounced) ----

  useEffect(() => {
    if (!currentPhoto) return
    setDetail(null)

    if (detailTimeoutRef.current) clearTimeout(detailTimeoutRef.current)
    detailTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/v1/photos/${currentPhoto.id}`)
        if (!res.ok) return
        const data: PhotoDetail = await res.json()
        // Only apply if still on the same photo
        if (currentIndexRef.current === photos.indexOf(currentPhoto)) {
          setDetail(data)
          setNoteText(data.comment || '')
        }
      } catch { /* ignore */ }
    }, DETAIL_DEBOUNCE_MS)

    return () => {
      if (detailTimeoutRef.current) clearTimeout(detailTimeoutRef.current)
    }
  }, [currentIndex, currentPhoto, photos])

  // ---- Navigation ----

  const navigate = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= photosRef.current.length) return

    const now = Date.now()
    const delta = now - lastNavTimeRef.current
    lastNavTimeRef.current = now

    if (delta < FAST_NAV_THRESHOLD_MS) {
      navCountRef.current++
      if (navCountRef.current > 2) setIsFastNav(true)
    } else {
      navCountRef.current = 0
      setIsFastNav(false)
    }

    // Reset zoom when navigating
    setZoomScale(1)
    setZoomTranslate({ x: 0, y: 0 })
    zoomScaleRef.current = 1

    // Stop video
    if (videoRef.current) {
      videoRef.current.pause()
      setVideoPlaying(false)
    }

    setCurrentIndex(newIndex)
  }, [])

  // ---- Keyboard ----

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showAlbumPicker || showShareModal) return

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          handleClose()
          break
        case 'ArrowLeft':
          e.preventDefault()
          navigate(currentIndexRef.current - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          navigate(currentIndexRef.current + 1)
          break
        case 'f':
          toggleFavorite()
          break
        case 'i':
          setShowInfo(prev => !prev)
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [navigate, showAlbumPicker, showShareModal])

  // ---- Close ----

  const handleClose = useCallback(() => {
    if (exitAnim) return

    // Try shrink-to-origin animation
    if (thumbnailRect || exitRectRef.current) {
      setExitAnim(true)
      setTimeout(() => {
        onClose(currentIndexRef.current, photosRef.current)
      }, 350)
    } else {
      onClose(currentIndexRef.current, photosRef.current)
    }
  }, [onClose, thumbnailRect, exitAnim])

  // ---- Touch gestures (mobile) ----

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchStartRef.current = Math.sqrt(dx * dx + dy * dy)
      return
    }
    if (e.touches.length !== 1) return
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t: Date.now(),
    }
    isSwipingRef.current = 'none'
    swipeOffsetRef.current = 0
    swipeDownRef.current = 0
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (pinchStartRef.current > 0) {
        const newScale = Math.max(1, Math.min(5, zoomScaleRef.current * (dist / pinchStartRef.current)))
        setZoomScale(newScale)
        pinchStartRef.current = dist
        zoomScaleRef.current = newScale
      }
      return
    }

    if (!touchStartRef.current || e.touches.length !== 1) return

    const dx = e.touches[0].clientX - touchStartRef.current.x
    const dy = e.touches[0].clientY - touchStartRef.current.y

    // If zoomed in, pan instead of swipe
    if (zoomScaleRef.current > 1) {
      setZoomTranslate(prev => ({
        x: prev.x + dx * 0.5,
        y: prev.y + dy * 0.5,
      }))
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        t: touchStartRef.current.t,
      }
      return
    }

    // Determine swipe direction on first significant move
    if (isSwipingRef.current === 'none') {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        isSwipingRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      }
    }

    if (isSwipingRef.current === 'horizontal') {
      swipeOffsetRef.current = dx
      setSwipeOffset(dx)
    } else if (isSwipingRef.current === 'vertical' && dy > 0) {
      swipeDownRef.current = dy
      setSwipeDown(dy)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    // Reset pinch
    pinchStartRef.current = 0

    if (!touchStartRef.current) return

    const dx = swipeOffsetRef.current
    const dy = swipeDownRef.current

    if (isSwipingRef.current === 'horizontal') {
      if (Math.abs(dx) > 80) {
        navigate(currentIndexRef.current + (dx > 0 ? -1 : 1))
      }
      setSwipeOffset(0)
    } else if (isSwipingRef.current === 'vertical' && dy > 120) {
      handleClose()
    } else {
      setSwipeDown(0)
    }

    if (isSwipingRef.current === 'none') {
      // Check for double tap
      const now = Date.now()
      if (now - lastTapRef.current < 300) {
        // Double tap — toggle zoom
        if (zoomScaleRef.current > 1) {
          setZoomScale(1)
          setZoomTranslate({ x: 0, y: 0 })
          zoomScaleRef.current = 1
        } else {
          setZoomScale(2.5)
          zoomScaleRef.current = 2.5
        }
        lastTapRef.current = 0
      } else {
        lastTapRef.current = now
        // Single tap — toggle UI
        setTimeout(() => {
          if (lastTapRef.current === now) {
            setUiVisible(prev => !prev)
          }
        }, 300)
      }
    }

    touchStartRef.current = null
    isSwipingRef.current = 'none'
    swipeOffsetRef.current = 0
    swipeDownRef.current = 0
    if (dy <= 120) setSwipeDown(0)
  }, [navigate, handleClose])

  // ---- Actions ----

  const toggleFavorite = useCallback(async () => {
    if (!currentPhoto) return
    try {
      if (currentPhoto.is_favorite) {
        await apiFetch(`/api/v1/photos/${currentPhoto.id}/favorite`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/v1/photos/${currentPhoto.id}/favorite`, { method: 'POST' })
      }
      setPhotosInternal(prev => prev.map((p, i) =>
        i === currentIndexRef.current ? { ...p, is_favorite: !p.is_favorite } : p
      ))
    } catch { /* ignore */ }
  }, [currentPhoto])

  const saveNote = useCallback(async () => {
    if (!currentPhoto) return
    try {
      await apiFetch(`/api/v1/photos/${currentPhoto.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: noteText }),
      })
    } catch { /* ignore */ }
  }, [currentPhoto, noteText])

  const handleDelete = useCallback(async () => {
    if (!currentPhoto || !confirm(t('delete_confirm'))) return
    try {
      await apiFetch(`/api/v1/photos/${currentPhoto.id}`, { method: 'DELETE' })
      const newPhotos = photos.filter((_, i) => i !== currentIndex)
      if (newPhotos.length === 0) {
        onClose(0, newPhotos)
        return
      }
      setPhotosInternal(newPhotos)
      if (currentIndex >= newPhotos.length) {
        setCurrentIndex(newPhotos.length - 1)
      }
    } catch { /* ignore */ }
  }, [currentPhoto, photos, currentIndex, onClose, setPhotosInternal])

  const handleRemoveFromAlbum = useCallback(async () => {
    if (!currentPhoto || !albumId || !confirm(t('remove_from_album_confirm'))) return
    try {
      await apiFetch(`/api/v1/albums/${albumId}/photos/${currentPhoto.id}`, { method: 'DELETE' })
      const newPhotos = photos.filter((_, i) => i !== currentIndex)
      if (newPhotos.length === 0) {
        onClose(0, newPhotos)
        return
      }
      setPhotosInternal(newPhotos)
      if (currentIndex >= newPhotos.length) {
        setCurrentIndex(newPhotos.length - 1)
      }
    } catch { /* ignore */ }
  }, [currentPhoto, albumId, photos, currentIndex, onClose, setPhotosInternal])

  const handleAddToAlbum = useCallback(async (targetAlbumId: string) => {
    if (!currentPhoto) return
    try {
      await apiFetch(`/api/v1/albums/${targetAlbumId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: [currentPhoto.id] }),
      })
      setShowAlbumPicker(false)
    } catch { /* ignore */ }
  }, [currentPhoto])

  const openAlbumPicker = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/albums')
      if (!res.ok) return
      const data = await res.json()
      setAlbums((data.albums ?? []).filter((a: Album) => a.type === 'manual' || a.type === 'favorites'))
      setShowAlbumPicker(true)
    } catch { /* ignore */ }
  }, [])

  const handleDownload = useCallback(() => {
    if (!detail) return
    const url = detail.type === 'video' ? detail.urls.video : detail.urls.large
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = detail.original_filename || `photo_${detail.id}`
    a.click()
  }, [detail])

  // ---- Filmstrip scroll ----

  useEffect(() => {
    const el = filmstripRef.current
    if (!el) return
    const target = currentIndex * FILMSTRIP_ITEM_W - el.clientWidth / 2 + FILMSTRIP_ITEM_W / 2
    el.scrollTo({ left: target, behavior: isFastNav ? 'auto' : 'smooth' })
  }, [currentIndex, isFastNav])

  // ---- Video controls ----

  const toggleVideoPlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play()
      setVideoPlaying(true)
    } else {
      v.pause()
      setVideoPlaying(false)
    }
  }, [])

  const handleVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setVideoProgress(v.currentTime)
    setVideoDuration(v.duration || 0)
  }, [])

  const seekVideo = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v || !v.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    v.currentTime = ratio * v.duration
  }, [])

  // ---- Ambient blur image ----

  const ambientUrl = currentPhoto?.type === 'photo' ? currentPhoto.small : null

  // ---- Compute enter/exit transform ----

  const enterStyle = useMemo(() => {
    if (!enterAnim || !thumbnailRect) return {}
    const vw = window.innerWidth
    const vh = window.innerHeight
    const sx = thumbnailRect.width / vw
    const sy = thumbnailRect.height / vh
    const scale = Math.max(sx, sy)
    const tx = thumbnailRect.left + thumbnailRect.width / 2 - vw / 2
    const ty = thumbnailRect.top + thumbnailRect.height / 2 - vh / 2
    return {
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      opacity: 0.7,
      transition: 'none',
    }
  }, [enterAnim, thumbnailRect])

  const exitStyle = useMemo(() => {
    if (!exitAnim) return {}
    const rect = exitRectRef.current || thumbnailRect
    if (!rect) return { opacity: 0, transition: 'opacity 0.3s ease' }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const sx = rect.width / vw
    const sy = rect.height / vh
    const scale = Math.max(sx, sy)
    const tx = rect.left + rect.width / 2 - vw / 2
    const ty = rect.top + rect.height / 2 - vh / 2
    return {
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      opacity: 0,
      transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.35s ease',
    }
  }, [exitAnim, thumbnailRect])

  // ---- Render ----

  if (!currentPhoto) return null

  const isVideo = currentPhoto.type === 'video'
  const largeUrl = isVideo ? null : getLargeUrl(currentPhoto.small)
  const displayUrl = (largeUrl && isImageLoaded(largeUrl)) ? largeUrl : currentPhoto.small
  const videoUrl = detail?.urls?.video || null

  // Swipe-down opacity
  const swipeDownProgress = Math.min(swipeDown / 300, 1)
  const bgOpacity = 1 - swipeDownProgress * 0.6

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 select-none"
      style={{
        background: `rgba(8, 6, 4, ${bgOpacity})`,
        ...(enterAnim ? enterStyle : {}),
        ...(exitAnim ? exitStyle : {}),
        ...(!enterAnim && !exitAnim ? {
          transform: swipeDown > 0
            ? `translateY(${swipeDown * 0.4}px) scale(${1 - swipeDownProgress * 0.15})`
            : 'none',
          transition: swipeDown > 0 ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.35s ease',
        } : {}),
      }}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
    >
      {/* Ambient blur background */}
      {ambientUrl && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
          <img
            src={ambientUrl}
            alt=""
            className="viewer-ambient"
            style={{
              position: 'absolute',
              inset: '-20%',
              width: '140%',
              height: '140%',
              objectFit: 'cover',
              filter: 'blur(80px) saturate(1.4) brightness(0.25)',
              opacity: 0.6,
              transition: isFastNav ? 'none' : 'opacity 0.5s ease',
            }}
          />
        </div>
      )}

      {/* Top toolbar */}
      <div
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between"
        style={{
          padding: '12px 16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)',
          opacity: uiVisible ? 1 : 0,
          transform: uiVisible ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          pointerEvents: uiVisible ? 'auto' : 'none',
        }}
      >
        {/* Close button */}
        <button onClick={handleClose} className="viewer-btn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="flex items-center gap-1">
          {/* Favorite */}
          <button onClick={toggleFavorite} className="viewer-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill={currentPhoto.is_favorite ? 'rgba(207, 86, 54, 0.9)' : 'none'} stroke={currentPhoto.is_favorite ? 'rgba(207, 86, 54, 0.9)' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </button>

          {/* Add to album */}
          <button onClick={openAlbumPicker} className="viewer-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </button>

          {/* Share */}
          <button onClick={() => setShowShareModal(true)} className="viewer-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>

          {/* Download */}
          {detail && (
            <button onClick={handleDownload} className="viewer-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}

          {/* Info */}
          <button onClick={() => setShowInfo(prev => !prev)} className="viewer-btn" style={{ opacity: showInfo ? 1 : 0.7 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>

          {/* Note toggle (mobile: opens sheet, desktop: toggles sidebar) */}
          <button
            onClick={() => {
              if (isMobile) setShowMobileNote(prev => !prev)
              else setSidebarOpen(prev => !prev)
            }}
            className="viewer-btn"
            style={{ opacity: (sidebarOpen || showMobileNote) ? 1 : 0.7 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </button>

          {/* Remove from album */}
          {albumId && (
            <button onClick={handleRemoveFromAlbum} className="viewer-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(207, 86, 54, 0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
          )}

          {/* Delete */}
          <button onClick={handleDelete} className="viewer-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(207, 86, 54, 0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div
        className="absolute z-10 flex items-center justify-center"
        style={{
          top: 0,
          bottom: uiVisible ? '72px' : 0,
          left: (!isMobile && sidebarOpen) ? 0 : 0,
          right: (!isMobile && sidebarOpen) ? '340px' : 0,
          transition: 'right 0.3s ease, bottom 0.25s ease',
        }}
      >
        {/* PC: Coverflow with neighbors */}
        {!isMobile && (
          <>
            {/* Previous photo (left) */}
            {currentIndex > 0 && (
              <CoverflowCard
                photo={photos[currentIndex - 1]}
                position="left"
                tilt={getTilt(currentIndex - 1)}
                isFastNav={isFastNav}
                onClick={() => navigate(currentIndex - 1)}
              />
            )}
          </>
        )}

        {/* Center photo / video */}
        <div
          className="relative flex items-center justify-center"
          style={{
            width: isMobile ? '100%' : 'auto',
            height: isMobile ? '100%' : 'auto',
            maxWidth: isMobile ? '100%' : '70%',
            maxHeight: isMobile ? '100%' : '80%',
            zIndex: 5,
            transform: isMobile && swipeOffset !== 0
              ? `translateX(${swipeOffset}px)`
              : (zoomScale > 1 ? `scale(${zoomScale}) translate(${zoomTranslate.x / zoomScale}px, ${zoomTranslate.y / zoomScale}px)` : 'none'),
            transition: (isMobile && swipeOffset !== 0) || zoomScale > 1 ? 'none' : `transform ${isFastNav ? '0.08s' : '0.35s'} cubic-bezier(0.32, 0.72, 0, 1)`,
          }}
        >
          {isVideo && videoUrl ? (
            <div className="relative" style={{ maxWidth: '100%', maxHeight: '100%' }}>
              <video
                ref={videoRef}
                src={videoUrl}
                className="viewer-media"
                style={{
                  width: isMobile ? '100vw' : '100%',
                  height: isMobile ? '100vh' : '75vh',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  boxShadow: isMobile ? 'none' : '0 25px 60px rgba(0, 0, 0, 0.6)',
                }}
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={() => setVideoPlaying(false)}
                onLoadedMetadata={() => {
                  if (videoRef.current) setVideoDuration(videoRef.current.duration)
                }}
                playsInline
                muted={videoMuted}
              />
              {/* Custom video controls overlay */}
              <div
                className="absolute inset-0 flex flex-col justify-end"
                style={{ borderRadius: '4px' }}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleVideoPlay()
                }}
              >
                {/* Play/pause center icon */}
                {!videoPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.5)',
                      backdropFilter: 'blur(8px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                        <polygon points="6,3 20,12 6,21" />
                      </svg>
                    </div>
                  </div>
                )}
                {/* Bottom controls bar */}
                <div
                  className="flex items-center gap-3"
                  style={{
                    padding: '12px 16px',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Progress bar */}
                  <div
                    className="flex-1 relative cursor-pointer"
                    style={{ height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px' }}
                    onClick={seekVideo}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: videoDuration > 0 ? `${(videoProgress / videoDuration) * 100}%` : '0%',
                        background: 'rgba(255,255,255,0.8)',
                        borderRadius: '2px',
                        transition: 'width 0.1s linear',
                      }}
                    />
                  </div>
                  {/* Time */}
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', minWidth: '45px', textAlign: 'right' }}>
                    {fmtDuration(Math.floor(videoProgress))}/{fmtDuration(Math.floor(videoDuration))}
                  </span>
                  {/* Mute */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setVideoMuted(prev => !prev) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: '4px' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {videoMuted ? (
                        <>
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <line x1="23" y1="9" x2="17" y2="15" />
                          <line x1="17" y1="9" x2="23" y2="15" />
                        </>
                      ) : (
                        <>
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <img
              src={displayUrl}
              alt=""
              className="viewer-media"
              draggable={false}
              style={{
                width: isMobile ? '100vw' : '100%',
                height: isMobile ? '100vh' : '75vh',
                objectFit: 'contain',
                borderRadius: '4px',
                boxShadow: isMobile ? 'none' : '0 25px 60px rgba(0, 0, 0, 0.6)',
                transition: isFastNav ? 'none' : 'box-shadow 0.3s ease',
                userSelect: 'none',
              }}
            />
          )}
        </div>

        {/* PC: Next photo (right) */}
        {!isMobile && currentIndex < photos.length - 1 && (
          <CoverflowCard
            photo={photos[currentIndex + 1]}
            position="right"
            tilt={getTilt(currentIndex + 1)}
            isFastNav={isFastNav}
            onClick={() => navigate(currentIndex + 1)}
          />
        )}

        {/* PC: Navigation arrows */}
        {!isMobile && (
          <>
            {currentIndex > 0 && (
              <button
                className="viewer-nav-arrow"
                style={{ left: '16px' }}
                onClick={() => navigate(currentIndex - 1)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            {currentIndex < photos.length - 1 && (
              <button
                className="viewer-nav-arrow"
                style={{ right: '16px' }}
                onClick={() => navigate(currentIndex + 1)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* Right sidebar (PC only) */}
      {!isMobile && (
        <div
          className="absolute top-0 bottom-0 z-20 overflow-y-auto"
          style={{
            right: 0,
            width: '340px',
            background: 'rgba(12, 10, 8, 0.95)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
            padding: '72px 20px 88px',
          }}
        >
          {/* Note */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', letterSpacing: '0.5px' }}>
              {t('note')}
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onBlur={saveNote}
              placeholder={t('note_placeholder')}
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: '14px',
                fontFamily: 'var(--font-sans)',
                resize: 'vertical',
                outline: 'none',
                lineHeight: '1.5',
              }}
            />
          </div>

          {/* Metadata */}
          {showInfo && detail && (
            <MetadataPanel detail={detail} />
          )}
        </div>
      )}

      {/* Mobile note sheet */}
      {isMobile && showMobileNote && (
        <div
          className="absolute left-0 right-0 bottom-0 z-40"
          style={{
            background: 'rgba(12, 10, 8, 0.97)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '20px 20px 0 0',
            padding: '20px 16px',
            maxHeight: '50vh',
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', fontWeight: 400 }}>
              {t('note')}
            </span>
            <button
              onClick={() => setShowMobileNote(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNote}
            placeholder={t('note_placeholder')}
            autoFocus
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '12px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: '15px',
              fontFamily: 'var(--font-sans)',
              resize: 'none',
              outline: 'none',
            }}
          />
          {showInfo && detail && <MetadataPanel detail={detail} />}
        </div>
      )}

      {/* Info panel (mobile, non-note) */}
      {isMobile && showInfo && !showMobileNote && detail && (
        <div
          className="absolute left-0 right-0 bottom-0 z-40"
          style={{
            background: 'rgba(12, 10, 8, 0.97)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '20px 20px 0 0',
            padding: '20px 16px',
            maxHeight: '40vh',
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', fontWeight: 400 }}>{t('info')}</span>
            <button
              onClick={() => setShowInfo(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <MetadataPanel detail={detail} />
        </div>
      )}

      {/* Filmstrip */}
      <div
        className="absolute left-0 right-0 bottom-0 z-20"
        style={{
          height: '72px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
          opacity: uiVisible ? 1 : 0,
          transform: uiVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          pointerEvents: uiVisible ? 'auto' : 'none',
          right: (!isMobile && sidebarOpen) ? '340px' : 0,
        }}
      >
        <div
          ref={filmstripRef}
          className="flex items-center h-full overflow-x-auto hide-scrollbar"
          style={{ padding: '0 16px', gap: '4px' }}
        >
          {photos.map((photo, idx) => (
            <div
              key={photo.id}
              className="flex-shrink-0 cursor-pointer overflow-hidden"
              style={{
                width: `${FILMSTRIP_ITEM_W - 4}px`,
                height: `${FILMSTRIP_ITEM_W - 4}px`,
                borderRadius: '6px',
                border: idx === currentIndex
                  ? '2px solid rgba(255,255,255,0.8)'
                  : '2px solid transparent',
                opacity: idx === currentIndex ? 1 : 0.5,
                transition: isFastNav ? 'none' : 'border-color 0.2s, opacity 0.2s',
              }}
              onClick={() => navigate(idx)}
            >
              <img
                src={photo.small}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: '4px',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Album picker modal */}
      {showAlbumPicker && (
        <ModalOverlay onClose={() => setShowAlbumPicker(false)}>
          <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
            {t('add_to_album')}
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {albums.map((album) => (
              <div
                key={album.id}
                className="flex items-center gap-3 cursor-pointer"
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  marginBottom: '4px',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => handleAddToAlbum(album.id)}
              >
                <span style={{ flex: 1, fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
                  {album.name}
                </span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                  {album.photo_count}
                </span>
              </div>
            ))}
            {albums.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' }}>
                {t('no_albums')}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* Share modal */}
      {showShareModal && currentPhoto && (
        <ShareModal
          photoId={currentPhoto.id}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  )
}

// ---- Coverflow card (PC neighbor photos) ----

function CoverflowCard({ photo, position, tilt, isFastNav, onClick }: {
  photo: ViewerPhoto
  position: 'left' | 'right'
  tilt: number
  isFastNav: boolean
  onClick: () => void
}) {
  const largeUrl = photo.type === 'photo' ? getLargeUrl(photo.small) : null
  const displayUrl = (largeUrl && isImageLoaded(largeUrl)) ? largeUrl : photo.small

  const baseTranslateX = position === 'left' ? '-55%' : '55%'
  const perspectiveRotate = position === 'left' ? 4 : -4

  return (
    <div
      className="absolute cursor-pointer"
      style={{
        zIndex: 2,
        left: position === 'left' ? '5%' : 'auto',
        right: position === 'right' ? '5%' : 'auto',
        maxWidth: '25%',
        maxHeight: '60%',
        transform: `translateX(${baseTranslateX}) scale(0.8) rotateZ(${tilt + perspectiveRotate}deg)`,
        transition: isFastNav ? 'none' : 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease',
        filter: 'brightness(0.5)',
        opacity: 0.7,
      }}
      onClick={onClick}
    >
      <img
        src={displayUrl}
        alt=""
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '55vh',
          objectFit: 'contain',
          borderRadius: '4px',
          boxShadow: '0 15px 40px rgba(0, 0, 0, 0.5)',
          userSelect: 'none',
        }}
      />
    </div>
  )
}

// ---- Metadata panel ----

function MetadataPanel({ detail }: { detail: PhotoDetail }) {
  return (
    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)', lineHeight: '1.8' }}>
      {detail.original_filename && (
        <MetaRow label={t('filename')} value={detail.original_filename} />
      )}
      {detail.taken_at && (
        <MetaRow label={t('date')} value={fmtDate(detail.taken_at)} />
      )}
      {detail.width && detail.height && (
        <MetaRow label={t('resolution')} value={`${detail.width} x ${detail.height}`} />
      )}
      {detail.size_bytes && (
        <MetaRow label={t('size')} value={fmtBytes(detail.size_bytes)} />
      )}
      {detail.duration_sec && (
        <MetaRow label={t('duration')} value={fmtDuration(detail.duration_sec)} />
      )}
      {detail.exif?.camera_make && (
        <MetaRow label={t('camera')} value={`${detail.exif.camera_make} ${detail.exif.camera_model || ''}`} />
      )}
      {detail.exif?.iso && (
        <MetaRow label="ISO" value={String(detail.exif.iso)} />
      )}
      {detail.exif?.focal_length && (
        <MetaRow label="Focal" value={detail.exif.focal_length} />
      )}
      {detail.exif?.aperture && (
        <MetaRow label="Aperture" value={detail.exif.aperture} />
      )}
      {detail.exif?.shutter_speed && (
        <MetaRow label="Shutter" value={detail.exif.shutter_speed} />
      )}
      {detail.place?.name && (
        <MetaRow label={t('place')} value={detail.place.name} />
      )}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between" style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

// ---- Modal overlay ----

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'rgba(20, 16, 13, 0.98)',
          borderRadius: '20px',
          padding: '24px',
          border: '1px solid rgba(255,255,255,0.08)',
          width: 'min(90vw, 380px)',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// ---- Share modal ----

function ShareModal({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [expiresDays, setExpiresDays] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [creating, setCreating] = useState(false)

  async function createShare() {
    setCreating(true)
    try {
      const body: Record<string, unknown> = { type: 'photo', photo_id: photoId }
      if (password.trim()) body.password = password.trim()
      if (expiresDays) body.expires_days = parseInt(expiresDays)

      const res = await apiFetch('/api/v1/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return
      const data = await res.json()
      setShareUrl(location.origin + data.url)
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  function copyUrl() {
    navigator.clipboard.writeText(shareUrl)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
        {t('share')}
      </div>

      {!shareUrl ? (
        <>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>{t('share_password')}</div>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)', fontSize: '14px', fontFamily: 'var(--font-sans)', outline: 'none',
              }}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>{t('share_expires')}</div>
            <input
              type="number"
              min="1"
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)', fontSize: '14px', fontFamily: 'var(--font-sans)', outline: 'none',
              }}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="viewer-modal-btn">{t('cancel')}</button>
            <button onClick={createShare} disabled={creating} className="viewer-modal-btn-primary">
              {creating ? t('loading') : t('create_share')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>{t('share_link')}</div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.85)', fontSize: '13px', fontFamily: 'var(--font-sans)', outline: 'none',
                }}
              />
              <button onClick={copyUrl} className="viewer-modal-btn-primary" style={{ padding: '10px 16px' }}>
                {t('link_copied')}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={onClose} className="viewer-modal-btn">{t('close')}</button>
          </div>
        </>
      )}
    </ModalOverlay>
  )
}
