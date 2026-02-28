import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'
import PhotoViewer from '../components/PhotoViewer'
import type { ViewerPhoto } from '../components/PhotoViewer'
import { SelectBarBtn, AlbumPickerModal, BulkShareModal, BulkKioskModal } from '../components/SelectionBar'
import type { PickerAlbum } from '../components/SelectionBar'
import { useDragSelect } from '../hooks/useDragSelect'

// ============================================================
// Albums Page — User albums + place albums grid
//
// Two sections: user/favorites albums on top, place albums below.
// Each album is a card with cover image, name, photo count.
// Create album button. Tap album -> AlbumDetailPage.
// ============================================================

interface Album {
  id: string
  type: 'manual' | 'favorites' | 'place'
  name: string
  photo_count: number
  cover?: string
  description?: string
}

interface AlbumDetail {
  album: Album
  photos: Photo[]
  has_more: boolean
  next_cursor?: string
}

interface Photo {
  id: string
  type: 'photo' | 'video'
  small: string
  w: number
  h: number
  taken_at: number
  is_favorite: boolean
  duration?: number
}

export default function AlbumsPage({ onBack }: { onBack: () => void }) {
  const [albums, setAlbums] = useState<Album[]>([])
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null)
  const [createModal, setCreateModal] = useState(false)

  const loadAlbums = useCallback(async () => {
    const res = await apiFetch('/api/v1/albums')
    if (!res.ok) return
    const data = await res.json()
    setAlbums(data.albums ?? [])
  }, [])

  useEffect(() => {
    loadAlbums()
  }, [loadAlbums])

  const userAlbums = albums.filter(a => a.type === 'manual' || a.type === 'favorites')
  const placeAlbums = albums.filter(a => a.type === 'place')

  if (selectedAlbum) {
    return (
      <AlbumDetailView
        albumId={selectedAlbum}
        onBack={() => { setSelectedAlbum(null); loadAlbums() }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-30" style={{ background: 'rgba(10, 7, 5, 0.97)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3"
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
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
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '18px',
          fontWeight: 400,
          letterSpacing: '0.3px',
          flex: 1,
        }}>
          {t('albums')}
        </span>
        {/* Create album button */}
        <button
          onClick={() => setCreateModal(true)}
          className="flex items-center justify-center"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.7)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="overflow-y-auto" style={{ height: 'calc(100% - 65px)' }}>
        {albums.length === 0 ? (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '14px',
          }}>
            {t('no_albums')}
          </div>
        ) : (
          <>
            {/* User albums */}
            {userAlbums.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '12px',
                  padding: '16px',
                }}
              >
                {userAlbums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onClick={() => setSelectedAlbum(album.id)}
                  />
                ))}
              </div>
            )}

            {/* Place albums */}
            {placeAlbums.length > 0 && (
              <div style={{ marginTop: userAlbums.length > 0 ? '8px' : '0' }}>
                <div
                  className="flex items-center gap-2"
                  style={{
                    padding: '12px 16px 8px',
                    borderTop: userAlbums.length > 0 ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
                  }}
                >
                  <span style={{
                    color: 'rgba(255, 255, 255, 0.85)',
                    fontSize: '17px',
                    fontWeight: 400,
                    letterSpacing: '0.5px',
                  }}>
                    {t('places')}
                  </span>
                  <span style={{
                    color: 'rgba(255, 255, 255, 0.35)',
                    fontSize: '14px',
                    fontWeight: 300,
                  }}>
                    {placeAlbums.length}
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: '12px',
                    padding: '8px 16px 24px',
                  }}
                >
                  {placeAlbums.map((album) => (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      onClick={() => setSelectedAlbum(album.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create album modal */}
      {createModal && (
        <CreateAlbumModal
          onClose={() => setCreateModal(false)}
          onCreated={() => { setCreateModal(false); loadAlbums() }}
        />
      )}
    </div>
  )
}

// Album card with cover image
function AlbumCard({ album, onClick }: { album: Album; onClick: () => void }) {
  return (
    <div
      className="cursor-pointer overflow-hidden"
      onClick={onClick}
      style={{
        borderRadius: '16px',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Cover */}
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: '16 / 10',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
        }}
      >
        {album.cover ? (
          <img
            src={album.cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-200"
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {album.type === 'favorites' ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ) : album.type === 'place' ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{
          fontSize: '13px',
          color: 'rgba(255, 255, 255, 0.85)',
          fontWeight: 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {album.name}
        </div>
        <div style={{
          fontSize: '11px',
          color: 'rgba(255, 255, 255, 0.35)',
          fontWeight: 300,
          marginTop: '3px',
        }}>
          {album.photo_count} {t('photos').toLowerCase()}
        </div>
      </div>
    </div>
  )
}

// Album detail view — shows photos inside an album
export function AlbumDetailView({ albumId, onBack }: { albumId: string; onBack: () => void }) {
  const [album, setAlbum] = useState<Album | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [viewerRect, setViewerRect] = useState<DOMRect | null>(null)

  const cursorRef = useRef<string | null>(null)
  const loadingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Drag-select hook
  const {
    selectMode, setSelectMode, selectedIds, liveCount,
    exitSelectMode, pointerHandlers,
  } = useDragSelect({ photos, scrollRef, gridRef })

  // Selection modal state
  const [showAlbumPicker, setShowAlbumPicker] = useState(false)
  const [albumList, setAlbumList] = useState<PickerAlbum[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [showKioskModal, setShowKioskModal] = useState(false)

  const loadAlbum = useCallback(async () => {
    const res = await apiFetch(`/api/v1/albums/${albumId}`)
    if (!res.ok) return
    const data: AlbumDetail = await res.json()
    setAlbum(data.album)
    setPhotos(data.photos)
    setHasMore(data.has_more)
    cursorRef.current = data.next_cursor || null
  }, [albumId])

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !cursorRef.current) return
    loadingRef.current = true
    try {
      const res = await apiFetch(`/api/v1/albums/${albumId}/photos?limit=100&cursor=${cursorRef.current}`)
      if (!res.ok) return
      const data = await res.json()
      setPhotos(prev => [...prev, ...data.photos])
      setHasMore(data.has_more)
      cursorRef.current = data.next_cursor || null
    } finally {
      loadingRef.current = false
    }
  }, [albumId])

  useEffect(() => { loadAlbum() }, [loadAlbum])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 800 && hasMore) {
      loadMore()
    }
  }, [hasMore, loadMore])

  async function handleDelete() {
    await apiFetch(`/api/v1/albums/${albumId}`, { method: 'DELETE' })
    onBack()
  }

  // Batch operations
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

  const handleAddToAlbum = useCallback(async (aId: string) => {
    if (selectedIds.size === 0) return
    try {
      await apiFetch(`/api/v1/albums/${aId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: Array.from(selectedIds) }),
      })
      setShowAlbumPicker(false)
      exitSelectMode()
    } catch { /* ignore */ }
  }, [selectedIds, exitSelectMode])

  return (
    <div className="fixed inset-0 z-30" style={{ background: 'rgba(10, 7, 5, 0.97)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
        <div className="flex items-center gap-3" style={{ padding: '16px' }}>
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
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div style={{
              color: 'rgba(255, 255, 255, 0.9)',
              fontSize: '18px',
              fontWeight: 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {album?.name ?? ''}
            </div>
            {album?.description && (
              <div style={{
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: '12px',
                fontWeight: 300,
                marginTop: '2px',
              }}>
                {album.description}
              </div>
            )}
          </div>
          {/* Photo count — hidden in select mode */}
          {!selectMode && (
            <span style={{
              color: 'rgba(255, 255, 255, 0.35)',
              fontSize: '14px',
              fontWeight: 300,
            }}>
              {album?.photo_count ?? 0}
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

        {/* Actions — only for manual albums */}
        {album && album.type === 'manual' && !selectMode && (
          <div className="flex gap-2" style={{ padding: '0 16px 12px' }}>
            <ActionBtn label={t('edit')} onClick={() => setEditModal(true)} />
            <ActionBtn label={t('delete')} danger onClick={handleDelete} />
          </div>
        )}
      </div>

      {/* Photo grid */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: album?.type === 'manual' && !selectMode ? 'calc(100% - 120px)' : 'calc(100% - 75px)' }}
        onScroll={handleScroll}
      >
        {photos.length === 0 ? (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '14px',
          }}>
            {t('no_photos')}
          </div>
        ) : (
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '3px',
              padding: '3px',
              ...(selectMode ? { touchAction: 'none' } : {}),
            }}
            {...pointerHandlers}
          >
            {photos.map((photo, idx) => (
              <div
                key={photo.id}
                data-photo-id={photo.id}
                className={`photo-grid-item relative overflow-hidden cursor-pointer${selectedIds.has(photo.id) ? ' photo-selected' : ''}`}
                style={{
                  aspectRatio: '1',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: '4px',
                }}
                onClick={(e) => {
                  if (selectMode) { e.preventDefault(); return }
                  setViewerRect(e.currentTarget.getBoundingClientRect())
                  setViewerIndex(idx)
                  setViewerOpen(true)
                }}
              >
                <img
                  src={photo.small}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                  style={{ display: 'block', pointerEvents: 'none' }}
                />
                <div className="select-check">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
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
              </div>
            ))}
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
          <SelectBarBtn disabled={liveCount === 0} onClick={handleOpenAlbumPicker} title={t('add_to_album')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn disabled={liveCount === 0} onClick={handleBulkFavorite} title={t('favorite')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </SelectBarBtn>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '13px', fontWeight: 400, whiteSpace: 'nowrap', padding: '0 8px', minWidth: '60px', textAlign: 'center' }}>
            {liveCount} {t('selected_count')}
          </span>
          <SelectBarBtn disabled={liveCount === 0} onClick={() => setShowShareModal(true)} title={t('share')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn disabled={liveCount === 0} onClick={() => setShowKioskModal(true)} title={t('kiosk')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn disabled={liveCount === 0} onClick={handleBulkDelete} title={t('delete')} variant="danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </SelectBarBtn>
          <SelectBarBtn onClick={exitSelectMode} title={t('close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </SelectBarBtn>
        </div>
      )}

      {/* Album picker modal */}
      {showAlbumPicker && (
        <AlbumPickerModal albums={albumList} onSelect={handleAddToAlbum} onClose={() => setShowAlbumPicker(false)} />
      )}
      {showShareModal && (
        <BulkShareModal photoIds={Array.from(selectedIds)} onClose={() => setShowShareModal(false)} onDone={() => { setShowShareModal(false); exitSelectMode() }} />
      )}
      {showKioskModal && (
        <BulkKioskModal photoIds={Array.from(selectedIds)} onClose={() => setShowKioskModal(false)} onDone={() => { setShowKioskModal(false); exitSelectMode() }} />
      )}

      {/* Photo viewer */}
      {viewerOpen && (
        <PhotoViewer
          photos={photos as ViewerPhoto[]}
          startIndex={viewerIndex}
          syncScroll={false}
          albumId={albumId}
          onClose={(_idx, vp) => {
            setPhotos(vp as Photo[])
            setViewerOpen(false)
          }}
          thumbnailRect={viewerRect}
        />
      )}

      {/* Edit album modal */}
      {editModal && album && (
        <EditAlbumModal
          album={album}
          onClose={() => setEditModal(false)}
          onSaved={() => { setEditModal(false); loadAlbum() }}
        />
      )}
    </div>
  )
}

// Small action button
function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '10px',
        background: danger ? 'rgba(207, 86, 54, 0.12)' : 'rgba(255, 255, 255, 0.06)',
        border: '1px solid ' + (danger ? 'rgba(207, 86, 54, 0.2)' : 'rgba(255, 255, 255, 0.08)'),
        color: danger ? 'rgba(207, 86, 54, 0.9)' : 'rgba(255, 255, 255, 0.65)',
        fontSize: '12px',
        fontWeight: 300,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-sans)',
        letterSpacing: '0.3px',
      }}
    >
      {label}
    </button>
  )
}

// Modal overlay
function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'rgba(25, 20, 16, 0.98)',
          borderRadius: '20px',
          padding: '24px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
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

// Modal button
function ModalBtn({ label, onClick, primary, disabled }: {
  label: string; onClick: () => void; primary?: boolean; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 20px',
        borderRadius: '10px',
        background: primary
          ? disabled ? 'rgba(207, 86, 54, 0.3)' : 'rgba(207, 86, 54, 0.7)'
          : 'rgba(255, 255, 255, 0.06)',
        border: 'none',
        color: primary
          ? disabled ? 'rgba(255,255,255,0.4)' : 'rgba(255, 255, 255, 0.9)'
          : 'rgba(255, 255, 255, 0.6)',
        fontSize: '13px',
        fontWeight: 400,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label}
    </button>
  )
}

// Create album modal
function CreateAlbumModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')

  async function handleCreate() {
    if (!name.trim()) return
    const res = await apiFetch('/api/v1/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (res.ok) onCreated()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
        {t('create_album')}
      </div>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
        placeholder={t('album_name')}
        style={{
          width: '100%',
          padding: '12px 14px',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '15px',
          fontFamily: 'var(--font-sans)',
          outline: 'none',
        }}
      />
      <div className="flex gap-3 justify-end" style={{ marginTop: '16px' }}>
        <ModalBtn label={t('cancel')} onClick={onClose} />
        <ModalBtn label={t('save')} primary onClick={handleCreate} disabled={!name.trim()} />
      </div>
    </ModalOverlay>
  )
}

// Edit album modal — name, description, cover
function EditAlbumModal({ album, onClose, onSaved }: {
  album: Album; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(album.name)
  const [description, setDescription] = useState(album.description ?? '')

  async function handleSave() {
    if (!name.trim()) return
    const body: Record<string, string | null> = { name: name.trim() }
    body.description = description.trim() || null
    await apiFetch(`/api/v1/albums/${album.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    onSaved()
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '12px',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '15px',
    fontFamily: 'var(--font-sans)',
    outline: 'none',
    resize: 'none' as const,
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
        {t('edit')}
      </div>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginBottom: '6px' }}>
          {t('album_name')}
        </div>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: '4px' }}>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginBottom: '6px' }}>
          {t('description')}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={inputStyle}
        />
      </div>
      <div className="flex gap-3 justify-end" style={{ marginTop: '16px' }}>
        <ModalBtn label={t('cancel')} onClick={onClose} />
        <ModalBtn label={t('save')} primary onClick={handleSave} disabled={!name.trim()} />
      </div>
    </ModalOverlay>
  )
}
