import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'
import { SelectBarBtn } from '../components/SelectionBar'
import { useDragSelect } from '../hooks/useDragSelect'

// ============================================================
// Trash Page — View and manage soft-deleted photos
//
// Full-screen overlay with photo grid, drag-select, and
// selection bar for restore / delete forever operations.
// Also provides "Empty trash" to clear everything at once.
// ============================================================

interface Photo {
  id: string
  type: 'photo' | 'video'
  small: string
  w: number
  h: number
  taken_at?: number
  is_favorite: boolean
  duration?: number
  deleted_at?: number
}

export default function TrashPage({ onBack }: { onBack: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const cursorRef = useRef<string | null>(null)
  const loadingMoreRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Drag-select hook
  const {
    selectMode, setSelectMode, selectedIds, liveCount,
    exitSelectMode, pointerHandlers,
  } = useDragSelect({ photos, scrollRef, gridRef })

  // Load trash photos
  const loadTrash = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setPhotos([])
      cursorRef.current = null
      exitSelectMode()
    }

    const cursor = reset ? '' : (cursorRef.current ? `&cursor=${cursorRef.current}` : '')
    const res = await apiFetch(`/api/v1/photos?trash=true&limit=100${cursor}`)
    if (!res.ok) { setLoading(false); return }

    const data = await res.json()
    const newPhotos = data.photos ?? []

    if (reset) {
      setPhotos(newPhotos)
    } else {
      setPhotos(prev => [...prev, ...newPhotos])
    }
    setHasMore(data.has_more ?? false)
    cursorRef.current = data.next_cursor ?? null
    setLoading(false)
  }, [exitSelectMode])

  // Load more for infinite scroll
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !cursorRef.current) return
    loadingMoreRef.current = true
    try {
      await loadTrash(false)
    } finally {
      loadingMoreRef.current = false
    }
  }, [loadTrash])

  // Initial load
  useEffect(() => {
    loadTrash()
  }, [loadTrash])

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600 && hasMore) {
      loadMore()
    }
  }, [hasMore, loadMore])

  // Restore selected photos
  const handleRestore = useCallback(async () => {
    if (selectedIds.size === 0) return
    try {
      const res = await apiFetch('/api/v1/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      if (!res.ok) return
      setPhotos(prev => prev.filter(p => !selectedIds.has(p.id)))
      exitSelectMode()
    } catch { /* ignore */ }
  }, [selectedIds, exitSelectMode])

  // Delete selected photos forever
  const handleDeleteForever = useCallback(async () => {
    if (selectedIds.size === 0) return
    const msg = t('delete_forever_confirm').replace('{n}', String(selectedIds.size))
    if (!confirm(msg)) return
    try {
      const res = await apiFetch('/api/v1/trash', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      if (!res.ok) return
      setPhotos(prev => prev.filter(p => !selectedIds.has(p.id)))
      exitSelectMode()
    } catch { /* ignore */ }
  }, [selectedIds, exitSelectMode])

  // Empty entire trash
  const handleEmptyTrash = useCallback(async () => {
    if (!confirm(t('empty_trash_confirm'))) return
    try {
      const res = await apiFetch('/api/v1/trash', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) return
      setPhotos([])
      setHasMore(false)
      cursorRef.current = null
      exitSelectMode()
    } catch { /* ignore */ }
  }, [exitSelectMode])

  const isEmpty = !loading && photos.length === 0

  return (
    <div className="fixed inset-0 z-30" style={{ background: 'rgba(10, 7, 5, 0.97)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3"
        style={{ padding: '16px 16px 0' }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center justify-center"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.7)',
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Title */}
        <span style={{
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '18px',
          fontWeight: 400,
          letterSpacing: '0.3px',
          flex: 1,
        }}>
          {t('trash')}
        </span>

        {/* Item count */}
        {photos.length > 0 && !selectMode && (
          <span style={{
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '13px',
            fontWeight: 300,
          }}>
            {photos.length.toLocaleString()}
          </span>
        )}

        {/* Select mode toggle */}
        {photos.length > 0 && (
          <button
            onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true) }}
            className="flex items-center justify-center"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '12px',
              background: selectMode ? 'rgba(183, 101, 57, 0.7)' : 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255, 255, 255, 0.7)',
              flexShrink: 0,
              transition: 'background 0.15s ease',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Info bar with 30-day notice and Empty trash button */}
      {!isEmpty && !loading && (
        <div
          className="flex items-center"
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            gap: '12px',
          }}
        >
          <span style={{
            color: 'rgba(255, 255, 255, 0.35)',
            fontSize: '12px',
            fontWeight: 300,
            flex: 1,
            lineHeight: '1.4',
          }}>
            {t('trash_info')}
          </span>
          <button
            onClick={handleEmptyTrash}
            style={{
              background: 'rgba(220, 60, 60, 0.15)',
              border: '1px solid rgba(220, 60, 60, 0.25)',
              borderRadius: '10px',
              color: 'rgba(220, 100, 100, 0.9)',
              fontSize: '12px',
              fontWeight: 400,
              padding: '6px 14px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-sans)',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(220, 60, 60, 0.25)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(220, 60, 60, 0.15)' }}
          >
            {t('empty_trash')}
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: isEmpty || loading ? 'calc(100% - 56px)' : 'calc(100% - 100px)' }}
        onScroll={handleScroll}
      >
        {loading ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{
              width: '20px',
              height: '20px',
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: 'rgba(207, 86, 54, 0.6)',
              borderRadius: '50%',
              animation: 'uploadSpin 0.6s linear infinite',
              margin: '0 auto',
            }} />
          </div>
        ) : isEmpty ? (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.25)',
            fontSize: '14px',
            fontWeight: 300,
          }}>
            {t('trash_empty')}
          </div>
        ) : (
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '3px',
              padding: '3px 3px 24px',
              ...(selectMode ? { touchAction: 'none' } : {}),
            }}
            {...pointerHandlers}
          >
            {photos.map((photo) => {
              const isSelected = selectedIds.has(photo.id)
              return (
                <div
                  key={photo.id}
                  data-photo-id={photo.id}
                  className={`photo-grid-item relative overflow-hidden cursor-pointer${isSelected ? ' photo-selected' : ''}`}
                  style={{
                    aspectRatio: '1',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    borderRadius: '4px',
                  }}
                  onClick={() => { if (!selectMode) setSelectMode(true) }}
                >
                  <img
                    src={photo.small}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    style={{ display: 'block', pointerEvents: 'none', opacity: 0.6 }}
                  />
                  {/* Selection checkmark overlay */}
                  <div className="select-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  {/* Video badge */}
                  {photo.type === 'video' && (
                    <div
                      className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(0, 0, 0, 0.6)', fontSize: '10px' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white" className="inline">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  )}
                  {/* Days remaining badge */}
                  {photo.deleted_at && (
                    <div
                      className="absolute top-1 left-1 px-1.5 py-0.5 rounded"
                      style={{
                        background: 'rgba(0, 0, 0, 0.6)',
                        fontSize: '10px',
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontWeight: 300,
                      }}
                    >
                      {(() => {
                        const days = Math.max(0, 30 - Math.floor((Date.now() / 1000 - photo.deleted_at!) / 86400))
                        return `${days}d`
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Selection bottom bar */}
      {selectMode && (
        <div
          className="fixed z-[40] flex items-center"
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
          {/* Restore */}
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={handleRestore}
            title={t('restore')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
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

          {/* Delete forever */}
          <SelectBarBtn
            disabled={liveCount === 0}
            onClick={handleDeleteForever}
            title={t('delete_forever')}
            variant="danger"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </SelectBarBtn>

          {/* Close select mode */}
          <SelectBarBtn onClick={exitSelectMode} title={t('close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </SelectBarBtn>
        </div>
      )}
    </div>
  )
}
