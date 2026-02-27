import { useState, useEffect, useCallback, useRef } from 'react'
import { api, Photo, PhotoDetail } from '../utils/api'
import { useTranslation } from '../hooks/useTranslation'
import { formatDate, formatFileSize, formatDuration } from '../utils/format'

/**
 * Full-screen photo viewer.
 *
 * Features:
 * - Shows small version instantly, loads large in background
 * - Horizontal thumbnail strip at bottom for fast navigation
 * - Swipe left/right to navigate (touch), arrow keys (keyboard)
 * - Swipe down to close (touch), Escape (keyboard)
 * - Tap/click photo to toggle info overlay
 * - Favorite, share, delete actions
 */

interface PhotoViewerProps {
  photo: Photo
  allPhotos: Photo[]
  currentIndex: number
  onClose: () => void
  onNavigate: (direction: 'prev' | 'next') => void
  onFavoriteToggle: (id: string, isFavorite: boolean) => void
  onDelete: (id: string) => void
}

export default function PhotoViewer({
  photo,
  allPhotos,
  currentIndex,
  onClose,
  onNavigate,
  onFavoriteToggle,
  onDelete,
}: PhotoViewerProps) {
  const { t, locale } = useTranslation()
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [largeLoaded, setLargeLoaded] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [isFavorite, setIsFavorite] = useState(photo.is_favorite)

  // Touch gesture state
  const touchRef = useRef({ startX: 0, startY: 0, deltaX: 0, deltaY: 0, swiping: false })
  const overlayRef = useRef<HTMLDivElement>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragOpacity, setDragOpacity] = useState(1)

  // Load photo detail
  useEffect(() => {
    setDetail(null)
    setLargeLoaded(false)
    setIsFavorite(photo.is_favorite)
    api.getPhoto(photo.id).then(setDetail).catch(() => {})
  }, [photo.id])

  // Prefetch neighbors
  useEffect(() => {
    const prefetch = [currentIndex - 1, currentIndex + 1]
    prefetch.forEach((idx) => {
      if (idx >= 0 && idx < allPhotos.length) {
        api.getPhoto(allPhotos[idx].id).catch(() => {})
      }
    })
  }, [currentIndex, allPhotos])

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onNavigate('prev')
      if (e.key === 'ArrowRight') onNavigate('next')
      if (e.key === 'i') setShowInfo((v) => !v)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, onNavigate])

  // Touch gestures
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, deltaX: 0, deltaY: 0, swiping: true }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current.swiping) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - touchRef.current.startX
    const deltaY = touch.clientY - touchRef.current.startY
    touchRef.current.deltaX = deltaX
    touchRef.current.deltaY = deltaY

    // Vertical swipe down to close
    if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY > 0) {
      setDragOffset({ x: 0, y: deltaY * 0.5 })
      setDragOpacity(Math.max(0.3, 1 - deltaY / 400))
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    const { deltaX, deltaY } = touchRef.current
    touchRef.current.swiping = false

    // Swipe down to close
    if (deltaY > 100 && Math.abs(deltaY) > Math.abs(deltaX)) {
      onClose()
      return
    }

    // Swipe left/right to navigate
    if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) onNavigate('next')
      else onNavigate('prev')
    }

    setDragOffset({ x: 0, y: 0 })
    setDragOpacity(1)
  }, [onClose, onNavigate])

  // Toggle favorite
  const handleFavorite = async () => {
    try {
      if (isFavorite) {
        await api.removeFavorite(photo.id)
      } else {
        await api.addFavorite(photo.id)
      }
      setIsFavorite(!isFavorite)
      onFavoriteToggle(photo.id, !isFavorite)
    } catch {}
  }

  // Delete
  const handleDelete = async () => {
    try {
      await api.deletePhoto(photo.id)
      onDelete(photo.id)
    } catch {}
  }

  const largeUrl = detail?.urls?.large
  const videoUrl = detail?.urls?.video
  const isVideo = photo.type === 'video'

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black"
      style={{ opacity: dragOpacity }}
      onClick={(e) => {
        if (e.target === overlayRef.current) setShowInfo(!showInfo)
      }}
    >
      {/* Main image/video */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: `translateY(${dragOffset.y}px)`,
          transition: dragOffset.y === 0 ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Small version — always visible as base layer */}
        <img
          src={photo.small}
          alt=""
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />

        {/* Large version — loads on top */}
        {largeUrl && !isVideo && (
          <img
            src={largeUrl}
            alt=""
            onLoad={() => setLargeLoaded(true)}
            className={`
              absolute inset-0 w-full h-full object-contain select-none
              transition-opacity duration-300
              ${largeLoaded ? 'opacity-100' : 'opacity-0'}
            `}
            draggable={false}
          />
        )}

        {/* Video player */}
        {isVideo && videoUrl && (
          <video
            src={videoUrl}
            controls
            autoPlay
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}
      </div>

      {/* Top bar — close + actions */}
      <div className={`
        absolute top-0 left-0 right-0 z-10
        flex items-center justify-between px-4 py-3
        bg-gradient-to-b from-black/50 to-transparent
        transition-opacity duration-200
        ${showInfo ? 'opacity-100' : 'sm:opacity-0 sm:hover:opacity-100'}
      `}>
        {/* Close */}
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
        >
          <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="flex items-center gap-1">
          {/* Favorite */}
          <button
            onClick={handleFavorite}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${isFavorite ? 'text-accent fill-accent' : 'text-white'}`}
              viewBox="0 0 24 24"
              fill={isFavorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </button>

          {/* Info toggle */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="8" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,6 5,6 21,6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation arrows — desktop only */}
      {currentIndex > 0 && (
        <button
          onClick={() => onNavigate('prev')}
          className="
            absolute left-4 top-1/2 -translate-y-1/2 z-10
            w-12 h-12 flex items-center justify-center
            rounded-full bg-black/30 hover:bg-black/50
            transition-all duration-200
            hidden sm:flex
          "
        >
          <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      {currentIndex < allPhotos.length - 1 && (
        <button
          onClick={() => onNavigate('next')}
          className="
            absolute right-4 top-1/2 -translate-y-1/2 z-10
            w-12 h-12 flex items-center justify-center
            rounded-full bg-black/30 hover:bg-black/50
            transition-all duration-200
            hidden sm:flex
          "
        >
          <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {/* Thumbnail strip — bottom */}
      <div className="
        absolute bottom-0 left-0 right-0 z-10
        bg-gradient-to-t from-black/60 to-transparent
        pt-8 pb-4 px-2
      ">
        <div className="flex gap-1 overflow-x-auto no-scrollbar items-center justify-center">
          {allPhotos.slice(
            Math.max(0, currentIndex - 20),
            Math.min(allPhotos.length, currentIndex + 21),
          ).map((p, i) => {
            const realIndex = Math.max(0, currentIndex - 20) + i
            const isCurrent = realIndex === currentIndex
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (realIndex < currentIndex) {
                    for (let j = 0; j < currentIndex - realIndex; j++) onNavigate('prev')
                  } else {
                    for (let j = 0; j < realIndex - currentIndex; j++) onNavigate('next')
                  }
                }}
                className={`
                  flex-shrink-0 rounded-[4px] overflow-hidden
                  transition-all duration-200 ease-out
                  ${isCurrent
                    ? 'w-12 h-12 ring-2 ring-accent opacity-100'
                    : 'w-9 h-9 opacity-50 hover:opacity-80'
                  }
                `}
              >
                <img
                  src={p.small}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Info panel — slides up from bottom */}
      {showInfo && detail && (
        <div className="
          absolute bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:bottom-20 sm:w-80
          z-20 bg-black/70 backdrop-blur-xl rounded-[var(--radius-lg)]
          p-4 text-white animate-scale-in
        ">
          <div className="space-y-3 text-sm">
            {detail.original_filename && (
              <p className="font-medium text-white/90">{detail.original_filename}</p>
            )}
            {detail.taken_at && (
              <InfoRow label={t('taken_at')} value={formatDate(detail.taken_at, locale)} />
            )}
            {detail.width && detail.height && (
              <InfoRow label={t('dimensions')} value={`${detail.width} x ${detail.height}`} />
            )}
            {detail.size_bytes && (
              <InfoRow label={t('file_size')} value={formatFileSize(detail.size_bytes)} />
            )}
            {detail.exif?.camera_make && (
              <InfoRow
                label={t('camera')}
                value={`${detail.exif.camera_make} ${detail.exif.camera_model || ''}`}
              />
            )}
            {detail.place && (
              <InfoRow label={t('place')} value={detail.place} />
            )}
            {detail.duration && (
              <InfoRow label={t('duration')} value={formatDuration(detail.duration)} />
            )}
            {detail.exif && (
              <div className="flex gap-3 text-xs text-white/50 pt-1">
                {detail.exif.iso && <span>ISO {detail.exif.iso}</span>}
                {detail.exif.aperture && <span>f/{detail.exif.aperture.toFixed(1)}</span>}
                {detail.exif.shutter_speed && <span>{detail.exif.shutter_speed}s</span>}
                {detail.exif.focal_length && <span>{detail.exif.focal_length}mm</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-white/50">{label}</span>
      <span className="text-white/90 text-right">{value}</span>
    </div>
  )
}
