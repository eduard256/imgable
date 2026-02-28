// ============================================================
// SharePage — Public share viewer (/s/{code})
//
// Renders shared photos/albums without authentication.
// Two modes:
//   type="photo" — single photo centered on terracotta background
//   type="album" — Pinterest masonry grid (same as GalleryPage)
//
// Password-protected shares show a password form first.
// Expired/missing shares show error states.
// Info block below content: album name, photo count, etc.
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { t, getLang } from '../lib/i18n'
import PublicPhotoViewer from '../components/PublicPhotoViewer'
import type { PublicViewerPhoto } from '../components/PublicPhotoViewer'

// ---- API Types ----

interface SharePhotoData {
  id: string
  type: 'photo' | 'video'
  blurhash?: string
  urls: { small: string; large?: string; video?: string }
  width?: number
  height?: number
  taken_at?: number
}

interface ShareAlbumData {
  name: string
  photo_count: number
}

interface SharePhotoItem {
  id: string
  type: 'photo' | 'video'
  small: string
  width?: number
  height?: number
  taken_at?: number
  duration?: number
}

interface ShareResponse {
  type: 'photo' | 'album'
  photo?: SharePhotoData
  album?: ShareAlbumData
  photos?: SharePhotoItem[]
  next_cursor?: string
  has_more?: boolean
}

// ---- Masonry helpers ----

interface MasonryPhoto {
  id: string
  type: 'photo' | 'video'
  small: string
  w: number
  h: number
  taken_at?: number
  _rIdx: number
}

// Distribute photos into columns using shortest-column algorithm
function distributeToColumns(photos: MasonryPhoto[], colCount: number, colWidth: number): MasonryPhoto[][] {
  const columns: MasonryPhoto[][] = Array.from({ length: colCount }, () => [])
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

// ---- Main Component ----

export default function SharePage({ code }: { code: string }) {
  const [state, setState] = useState<'loading' | 'password' | 'error' | 'ready'>('loading')
  const [errorType, setErrorType] = useState<'expired' | 'not_found' | 'unknown'>('unknown')
  const [password, setPassword] = useState('')
  const [savedPassword, setSavedPassword] = useState('')
  const [shareData, setShareData] = useState<ShareResponse | null>(null)

  // Album pagination
  const [allPhotos, setAllPhotos] = useState<SharePhotoItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const loadingRef = useRef(false)

  // Masonry
  const [scaleIndex, setScaleIndex] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 1
    return DEFAULT_SCALE_INDEX
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const masonryRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)
  const [darkOverlay, setDarkOverlay] = useState(0)

  // Viewer
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [viewerRect, setViewerRect] = useState<DOMRect | null>(null)

  // Pinch zoom
  const pinchStartDistance = useRef(0)

  // ---- Fetch share data ----

  const fetchShare = useCallback(async (pw?: string) => {
    try {
      let url = `/s/${code}`
      if (pw) url += `?password=${encodeURIComponent(pw)}`

      const res = await fetch(url)

      if (res.status === 401) {
        setState('password')
        return
      }
      if (res.status === 410) {
        setErrorType('expired')
        setState('error')
        return
      }
      if (res.status === 404) {
        setErrorType('not_found')
        setState('error')
        return
      }
      if (!res.ok) {
        setErrorType('unknown')
        setState('error')
        return
      }

      const data: ShareResponse = await res.json()
      setShareData(data)

      if (data.type === 'album' && data.photos) {
        setAllPhotos(data.photos)
        setHasMore(data.has_more ?? false)
        setNextCursor(data.next_cursor ?? null)
      }

      if (pw) setSavedPassword(pw)
      setState('ready')
    } catch {
      setErrorType('unknown')
      setState('error')
    }
  }, [code])

  // Initial load
  useEffect(() => {
    fetchShare()
  }, [fetchShare])

  // ---- Load more album photos ----

  const loadMorePhotos = useCallback(async () => {
    if (loadingRef.current || !hasMore || !nextCursor) return
    loadingRef.current = true

    try {
      let url = `/s/${code}?cursor=${nextCursor}`
      if (savedPassword) url += `&password=${encodeURIComponent(savedPassword)}`

      const res = await fetch(url)
      if (!res.ok) return

      const data: ShareResponse = await res.json()
      if (data.photos) {
        setAllPhotos(prev => {
          const existingIds = new Set(prev.map(p => p.id))
          const newPhotos = data.photos!.filter(p => !existingIds.has(p.id))
          return [...prev, ...newPhotos]
        })
        setHasMore(data.has_more ?? false)
        setNextCursor(data.next_cursor ?? null)
      }
    } finally {
      loadingRef.current = false
    }
  }, [code, savedPassword, hasMore, nextCursor])

  // ---- Password submit ----

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setState('loading')
    fetchShare(password.trim())
  }

  // ---- Album: scroll to bottom after first load ----

  useEffect(() => {
    if (state !== 'ready' || shareData?.type !== 'album' || allPhotos.length === 0 || initialScrollDone.current) return

    const el = scrollRef.current
    if (!el) return

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

    requestAnimationFrame(() => {
      if (!initialScrollDone.current && el.scrollHeight > el.clientHeight) {
        scrollToBoundary()
        initialScrollDone.current = true
        observer.disconnect()
      }
    })

    return () => observer.disconnect()
  }, [state, shareData?.type, allPhotos.length])

  // ---- Album: scroll handler ----

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    // Near the top = need older photos
    if (el.scrollTop < 1500 && hasMore && !loadingRef.current && nextCursor) {
      const prevScrollHeight = el.scrollHeight
      loadMorePhotos().then(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            const newScrollHeight = scrollRef.current.scrollHeight
            scrollRef.current.scrollTop += (newScrollHeight - prevScrollHeight)
          }
        })
      })
    }

    // Dark overlay
    const masonryHeight = masonryRef.current?.offsetHeight ?? el.scrollHeight
    const boundaryScrollTop = masonryHeight - 0.7 * el.clientHeight
    const distanceFromBoundary = boundaryScrollTop - el.scrollTop
    const progress = Math.round(Math.min(Math.max(distanceFromBoundary, 0) / 1000, 1) * 100) / 100
    setDarkOverlay(prev => prev === progress ? prev : progress)
  }, [hasMore, nextCursor, loadMorePhotos])

  const rafRef = useRef(0)
  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(handleScroll)
  }, [handleScroll])

  // ---- Zoom controls ----

  function zoomIn() {
    setScaleIndex(prev => Math.min(prev + 1, SCALE_PRESETS.length - 1))
  }
  function zoomOut() {
    setScaleIndex(prev => Math.max(prev - 1, 0))
  }

  // Pinch-to-zoom for columns
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

  // ---- Build public URL for a photo ----

  function buildSmallUrl(photoId: string): string {
    let url = `/s/${code}/photo/small?id=${photoId}`
    if (savedPassword) url += `&password=${encodeURIComponent(savedPassword)}`
    return url
  }

  // ---- Open viewer ----

  function openViewer(reversedIdx: number, element: HTMLElement) {
    const originalIdx = allPhotos.length - 1 - reversedIdx
    const rect = element.getBoundingClientRect()
    setViewerRect(rect)
    setViewerIndex(originalIdx)
    setViewerOpen(true)
  }

  function openSinglePhotoViewer() {
    setViewerOpen(true)
    setViewerIndex(0)
  }

  // ---- Convert photos for viewer ----

  function toViewerPhotos(photos: SharePhotoItem[]): PublicViewerPhoto[] {
    return photos.map(p => ({
      id: p.id,
      type: p.type,
      small: buildSmallUrl(p.id),
      w: p.width ?? 1,
      h: p.height ?? 1,
      taken_at: p.taken_at,
    }))
  }

  function singlePhotoToViewer(photo: SharePhotoData): PublicViewerPhoto[] {
    let smallUrl = `/s/${code}/photo/small`
    if (savedPassword) smallUrl += `?password=${encodeURIComponent(savedPassword)}`
    return [{
      id: photo.id,
      type: photo.type,
      small: smallUrl,
      w: photo.width ?? 1,
      h: photo.height ?? 1,
      taken_at: photo.taken_at,
    }]
  }

  // ---- Format date ----

  function fmtDate(ts: number): string {
    const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US'
    return new Date(ts * 1000).toLocaleDateString(locale, {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  }

  // ============================================================
  // RENDER
  // ============================================================

  // Loading state
  if (state === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div style={{
          width: '32px',
          height: '32px',
          border: '2px solid rgba(255,255,255,0.15)',
          borderTopColor: 'rgba(255,255,255,0.6)',
          borderRadius: '50%',
          animation: 'uploadSpin 0.8s linear infinite',
        }} />
      </div>
    )
  }

  // Password form
  if (state === 'password') {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div style={{
          background: 'rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(20px)',
          borderRadius: '24px',
          padding: '40px 36px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          width: 'min(90vw, 360px)',
          textAlign: 'center',
        }}>
          {/* Lock icon */}
          <div style={{ marginBottom: '20px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto', display: 'block' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>

          <div style={{
            color: 'rgba(255, 255, 255, 0.6)',
            fontSize: '14px',
            marginBottom: '24px',
            lineHeight: '1.5',
          }}>
            {t('share_protected')}
          </div>

          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('share_enter_password')}
              autoFocus
              style={{
                width: '100%',
                padding: '14px 18px',
                borderRadius: '14px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '15px',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
                textAlign: 'center',
                letterSpacing: '1px',
              }}
            />
            <button
              type="submit"
              className="transition-all duration-200"
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '14px',
                borderRadius: '14px',
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '15px',
                fontWeight: 400,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                letterSpacing: '1px',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.2)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.12)'
              }}
            >
              {t('login')}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Error states
  if (state === 'error') {
    const messages = {
      expired: t('share_expired'),
      not_found: t('share_not_found'),
      unknown: 'Error',
    }
    const icons = {
      expired: (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      not_found: (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      ),
      unknown: (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
    }

    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
            {icons[errorType]}
          </div>
          <div style={{
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '16px',
            fontWeight: 300,
            letterSpacing: '0.5px',
          }}>
            {messages[errorType]}
          </div>
        </div>
      </div>
    )
  }

  // ---- Ready state ----

  if (!shareData) return null

  // ---- Single photo ----
  if (shareData.type === 'photo' && shareData.photo) {
    const photo = shareData.photo
    let largeUrl = `/s/${code}/photo/large`
    if (savedPassword) largeUrl += `?password=${encodeURIComponent(savedPassword)}`

    return (
      <div className="fixed inset-0 flex flex-col">
        {/* Ambient blur background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
          <img
            src={largeUrl}
            alt=""
            style={{
              position: 'absolute',
              inset: '-20%',
              width: '140%',
              height: '140%',
              objectFit: 'cover',
              filter: 'blur(80px) saturate(1.2) brightness(0.2)',
              opacity: 0.5,
            }}
          />
        </div>

        {/* Photo centered */}
        <div
          className="flex-1 flex items-center justify-center relative z-10 cursor-pointer"
          onClick={openSinglePhotoViewer}
          style={{ padding: '40px 24px 20px' }}
        >
          <img
            src={largeUrl}
            alt=""
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '6px',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.5)',
            }}
          />
        </div>

        {/* Info block */}
        <div className="relative z-10" style={{
          padding: '20px 24px 32px',
          background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.4))',
        }}>
          {photo.taken_at && (
            <div style={{
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '14px',
              fontWeight: 300,
            }}>
              {fmtDate(photo.taken_at)}
            </div>
          )}
          {photo.width && photo.height && (
            <div style={{
              color: 'rgba(255, 255, 255, 0.35)',
              fontSize: '12px',
              marginTop: '4px',
            }}>
              {photo.width} x {photo.height}
            </div>
          )}
        </div>

        {/* Viewer */}
        {viewerOpen && (
          <PublicPhotoViewer
            photos={singlePhotoToViewer(photo)}
            startIndex={0}
            shareCode={code}
            password={savedPassword || undefined}
            onClose={() => setViewerOpen(false)}
          />
        )}
      </div>
    )
  }

  // ---- Album ----
  if (shareData.type === 'album' && shareData.album) {
    const album = shareData.album
    const colCount = SCALE_PRESETS[scaleIndex]
    const gap = colCount >= 6 ? 2 : 3
    const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
    const colWidth = (containerWidth - gap * (colCount + 1)) / colCount

    // Build masonry photos (reversed: oldest at top, newest at bottom)
    const reversed: MasonryPhoto[] = [...allPhotos].reverse().map((p, i) => ({
      id: p.id,
      type: p.type,
      small: buildSmallUrl(p.id),
      w: p.width ?? 1,
      h: p.height ?? 1,
      taken_at: p.taken_at,
      _rIdx: i,
    }))
    const columns = distributeToColumns(reversed, colCount, colWidth)

    return (
      <div className="fixed inset-0">
        {/* Dark overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            background: '#2C1F14',
            opacity: darkOverlay * 0.85,
          }}
        />

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
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
                    data-viewer-idx={photo._rIdx}
                    className="relative overflow-hidden cursor-pointer"
                    onClick={(e) => openViewer(photo._rIdx, e.currentTarget as HTMLElement)}
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

          {/* Bottom info section */}
          <div
            style={{
              minHeight: '100vh',
              scrollSnapAlign: 'start',
              borderTop: '1px solid rgba(61, 43, 31, 0.1)',
              padding: '32px 24px',
            }}
          >
            <div style={{
              maxWidth: '480px',
              margin: '0 auto',
            }}>
              {/* Album name */}
              <div style={{
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '22px',
                fontWeight: 300,
                letterSpacing: '0.5px',
                marginBottom: '8px',
              }}>
                {album.name}
              </div>

              {/* Photo count */}
              <div style={{
                color: 'rgba(255, 255, 255, 0.35)',
                fontSize: '14px',
                fontWeight: 300,
              }}>
                {album.photo_count} {t('share_photos_count')}
              </div>
            </div>
          </div>
        </div>

        {/* Zoom controls */}
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

        {/* Viewer */}
        {viewerOpen && (
          <PublicPhotoViewer
            photos={toViewerPhotos(allPhotos)}
            startIndex={viewerIndex}
            shareCode={code}
            password={savedPassword || undefined}
            onClose={() => setViewerOpen(false)}
            thumbnailRect={viewerRect}
          />
        )}
      </div>
    )
  }

  // Fallback
  return null
}
