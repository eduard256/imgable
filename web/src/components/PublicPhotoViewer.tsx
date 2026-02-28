// ============================================================
// PublicPhotoViewer — Read-only fullscreen photo/video viewer
// for public share pages (/s/{code}).
//
// Visually identical to PhotoViewer but without authenticated
// actions (favorite, delete, albums, notes, share).
// Uses public share URLs instead of authenticated photo URLs.
//
// PC: Coverflow 3D with ambient blur background, filmstrip.
// Mobile: Fullscreen swipe nav, tap toggles UI,
//         swipe-down to close, pinch-to-zoom, double-tap zoom.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ---- Types ----

export interface PublicViewerPhoto {
  id: string
  type: 'photo' | 'video'
  small: string   // pre-built URL: /s/{code}/photo/small?id=xxx
  w: number
  h: number
  taken_at?: number
}

export interface PublicPhotoViewerProps {
  photos: PublicViewerPhoto[]
  startIndex: number
  shareCode: string
  password?: string
  onClose: () => void
  thumbnailRect?: DOMRect | null
}

// ---- Helpers ----

// Build public share URL for a specific size
function getPublicUrl(shareCode: string, photoId: string, size: 'small' | 'large' | 'video', password?: string): string {
  let url = `/s/${shareCode}/photo/${size}?id=${photoId}`
  if (password) url += `&password=${encodeURIComponent(password)}`
  return url
}

// Stable pseudo-random tilt per photo index (deterministic)
function getTilt(index: number): number {
  const seed = ((index * 2654435761) >>> 0) % 1000
  return ((seed / 1000) * 8 - 4)
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

// Format duration seconds
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ---- Constants ----

const PRELOAD_RANGE = 2
const FILMSTRIP_ITEM_W = 56
const FAST_NAV_THRESHOLD_MS = 120

// ---- Component ----

export default function PublicPhotoViewer({
  photos,
  startIndex,
  shareCode,
  password,
  onClose,
  thumbnailRect,
}: PublicPhotoViewerProps) {
  // State
  const [currentIndex, setCurrentIndex] = useState(startIndex)
  const [uiVisible, setUiVisible] = useState(true)
  const [isFastNav, setIsFastNav] = useState(false)
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
  const lastNavTimeRef = useRef(0)
  const navCountRef = useRef(0)
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

  // Keep ref in sync
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])

  // Responsive listener
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

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
    for (let i = -PRELOAD_RANGE; i <= PRELOAD_RANGE; i++) {
      const idx = currentIndex + i
      if (idx < 0 || idx >= photos.length) continue
      const p = photos[idx]
      if (p.type === 'photo') {
        preloadImage(getPublicUrl(shareCode, p.id, 'large', password))
      }
    }
  }, [currentIndex, photos, shareCode, password, currentPhoto])

  // ---- Navigation ----

  const navigate = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= photos.length) return

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
  }, [photos.length])

  // ---- Close ----

  const handleClose = useCallback(() => {
    setExitAnim(true)
    setTimeout(() => onClose(), 350)
  }, [onClose])

  // ---- Keyboard ----

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          handleClose()
          break
        case 'ArrowRight':
          e.preventDefault()
          navigate(currentIndexRef.current - 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          navigate(currentIndexRef.current + 1)
          break
        case 'f':
          e.preventDefault()
          if (document.fullscreenElement) {
            document.exitFullscreen()
          } else {
            containerRef.current?.requestFullscreen()
          }
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, handleClose])

  // ---- Touch handling (mobile) ----

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchStartRef.current = Math.sqrt(dx * dx + dy * dy)
      return
    }
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t: Date.now(),
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Pinch zoom
    if (e.touches.length === 2 && pinchStartRef.current > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const delta = dist - pinchStartRef.current

      if (Math.abs(delta) > 30) {
        const newScale = Math.max(1, Math.min(5, zoomScaleRef.current * (delta > 0 ? 1.3 : 0.77)))
        setZoomScale(newScale)
        zoomScaleRef.current = newScale
        pinchStartRef.current = dist
      }
      return
    }

    if (!touchStartRef.current) return
    const dx = e.touches[0].clientX - touchStartRef.current.x
    const dy = e.touches[0].clientY - touchStartRef.current.y

    // Panning when zoomed
    if (zoomScaleRef.current > 1) {
      setZoomTranslate(prev => ({
        x: prev.x + (e.touches[0].clientX - (touchStartRef.current?.x ?? 0)),
        y: prev.y + (e.touches[0].clientY - (touchStartRef.current?.y ?? 0)),
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
        navigate(currentIndexRef.current + (dx > 0 ? 1 : -1))
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

  // ---- Download ----

  const handleDownload = useCallback(() => {
    if (!currentPhoto) return
    const size = currentPhoto.type === 'video' ? 'video' : 'large'
    const url = getPublicUrl(shareCode, currentPhoto.id, size, password)
    const a = document.createElement('a')
    a.href = url
    a.download = `photo_${currentPhoto.id}`
    a.click()
  }, [currentPhoto, shareCode, password])

  // ---- Filmstrip scroll ----

  useEffect(() => {
    const el = filmstripRef.current
    if (!el) return
    const target = -(currentIndex * FILMSTRIP_ITEM_W - el.clientWidth / 2 + FILMSTRIP_ITEM_W / 2)
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

  // ---- Enter/exit transforms ----

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
  const largeUrl = isVideo ? null : getPublicUrl(shareCode, currentPhoto.id, 'large', password)
  const displayUrl = (largeUrl && isImageLoaded(largeUrl)) ? largeUrl : currentPhoto.small
  const videoUrl = isVideo ? getPublicUrl(shareCode, currentPhoto.id, 'video', password) : null

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

      {/* Top toolbar — minimal: close, download */}
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
          {/* Download */}
          <button onClick={handleDownload} className="viewer-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Counter */}
          {photos.length > 1 && (
            <span style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.5)',
              padding: '0 8px',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {currentIndex + 1} / {photos.length}
            </span>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div
        className="absolute z-10 flex items-center justify-center"
        style={{
          top: 0,
          bottom: uiVisible ? '72px' : 0,
          left: 0,
          right: 0,
          transition: 'bottom 0.25s ease',
        }}
      >
        {/* PC: Coverflow with neighbors */}
        {!isMobile && (
          <>
            {/* Next photo (left = older = higher index) */}
            {currentIndex < photos.length - 1 && (
              <CoverflowCard
                photo={photos[currentIndex + 1]}
                position="left"
                tilt={getTilt(currentIndex + 1)}
                isFastNav={isFastNav}
                shareCode={shareCode}
                password={password}
                onClick={() => navigate(currentIndex + 1)}
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

        {/* PC: Previous photo (right = newer = lower index) */}
        {!isMobile && currentIndex > 0 && (
          <CoverflowCard
            photo={photos[currentIndex - 1]}
            position="right"
            tilt={getTilt(currentIndex - 1)}
            isFastNav={isFastNav}
            shareCode={shareCode}
            password={password}
            onClick={() => navigate(currentIndex - 1)}
          />
        )}

        {/* PC: Navigation arrows */}
        {!isMobile && (
          <>
            {currentIndex < photos.length - 1 && (
              <button
                className="viewer-nav-arrow"
                style={{ left: '16px' }}
                onClick={() => navigate(currentIndex + 1)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            {currentIndex > 0 && (
              <button
                className="viewer-nav-arrow"
                style={{ right: '16px' }}
                onClick={() => navigate(currentIndex - 1)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

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
        }}
      >
        <div
          ref={filmstripRef}
          className="flex items-center h-full overflow-x-auto hide-scrollbar"
          style={{ padding: '0 16px', gap: '4px', direction: 'rtl' }}
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
                direction: 'ltr',
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
    </div>
  )
}

// ---- Coverflow card (PC neighbor photos) ----

function CoverflowCard({ photo, position, tilt, isFastNav, shareCode, password, onClick }: {
  photo: PublicViewerPhoto
  position: 'left' | 'right'
  tilt: number
  isFastNav: boolean
  shareCode: string
  password?: string
  onClick: () => void
}) {
  const largeUrl = photo.type === 'photo' ? getPublicUrl(shareCode, photo.id, 'large', password) : null
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
