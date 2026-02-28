import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'
import PhotoViewer from '../components/PhotoViewer'
import type { ViewerPhoto } from '../components/PhotoViewer'
import { SelectBarBtn, AlbumPickerModal, BulkShareModal, BulkKioskModal } from '../components/SelectionBar'
import type { PickerAlbum } from '../components/SelectionBar'
import { useDragSelect } from '../hooks/useDragSelect'

// ============================================================
// Folders Page — File browser for navigating photos by import path
//
// OS-style folder navigation with breadcrumbs.
// Folders always displayed above photos.
// Photos loaded with infinite scroll pagination.
// Folder structure is read-only (no create/rename/move folders).
// Batch operations on photos: album, favorite, share, kiosk, delete.
// ============================================================

interface Folder {
  name: string
  path: string
  photo_count: number
}

interface FoldersResponse {
  path: string
  folders: Folder[]
  photo_count: number
  direct_photo_count: number
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

export default function FoldersPage({ onBack }: { onBack: () => void }) {
  // Current path segments for breadcrumb navigation
  const [currentPath, setCurrentPath] = useState('/')
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderMeta, setFolderMeta] = useState<{ photo_count: number; direct_photo_count: number }>({ photo_count: 0, direct_photo_count: 0 })
  const [photos, setPhotos] = useState<Photo[]>([])
  const [hasMorePhotos, setHasMorePhotos] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingPhotos, setLoadingPhotos] = useState(false)

  const cursorRef = useRef<string | null>(null)
  const loadingMoreRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // PhotoViewer state
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [viewerRect, setViewerRect] = useState<DOMRect | null>(null)

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

  // Load folders for the current path
  const loadFolder = useCallback(async (path: string) => {
    setLoading(true)
    setPhotos([])
    setHasMorePhotos(false)
    cursorRef.current = null
    exitSelectMode()

    const encodedPath = encodeURIComponent(path === '/' ? '/' : path)
    const res = await apiFetch(`/api/v1/folders?path=${encodedPath}`)
    if (!res.ok) { setLoading(false); return }

    const data: FoldersResponse = await res.json()
    setFolders(data.folders ?? [])
    setFolderMeta({ photo_count: data.photo_count, direct_photo_count: data.direct_photo_count })

    // If not root and has direct photos, load them
    if (path !== '/' && data.direct_photo_count > 0) {
      setLoadingPhotos(true)
      const photosRes = await apiFetch(`/api/v1/photos?path=${encodeURIComponent(path)}&recursive=false&limit=100`)
      if (photosRes.ok) {
        const photosData = await photosRes.json()
        setPhotos(photosData.photos ?? [])
        setHasMorePhotos(photosData.has_more ?? false)
        cursorRef.current = photosData.next_cursor ?? null
      }
      setLoadingPhotos(false)
    }

    setLoading(false)
  }, [exitSelectMode])

  // Load more photos for pagination
  const loadMorePhotos = useCallback(async () => {
    if (loadingMoreRef.current || !cursorRef.current || currentPath === '/') return
    loadingMoreRef.current = true
    try {
      const res = await apiFetch(`/api/v1/photos?path=${encodeURIComponent(currentPath)}&recursive=false&limit=100&cursor=${cursorRef.current}`)
      if (!res.ok) return
      const data = await res.json()
      setPhotos(prev => [...prev, ...(data.photos ?? [])])
      setHasMorePhotos(data.has_more ?? false)
      cursorRef.current = data.next_cursor ?? null
    } finally {
      loadingMoreRef.current = false
    }
  }, [currentPath])

  // Initial load and path changes
  useEffect(() => {
    loadFolder(currentPath)
    scrollRef.current?.scrollTo(0, 0)
  }, [currentPath, loadFolder])

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600 && hasMorePhotos) {
      loadMorePhotos()
    }
  }, [hasMorePhotos, loadMorePhotos])

  // Navigate into a subfolder
  function navigateToFolder(folderPath: string) {
    setCurrentPath(folderPath)
  }

  // Build breadcrumb segments from current path
  const breadcrumbs = currentPath === '/'
    ? [{ label: t('folders'), path: '/' }]
    : [
        { label: t('folders'), path: '/' },
        ...currentPath.split('/').map((segment, i, arr) => ({
          label: segment,
          path: arr.slice(0, i + 1).join('/'),
        })),
      ]

  const isEmpty = !loading && folders.length === 0 && photos.length === 0

  // ============================================================
  // Selection logic
  // ============================================================

  function handlePhotoClick(e: React.MouseEvent, idx: number) {
    if (selectMode) {
      e.preventDefault()
      return
    }
    setViewerRect(e.currentTarget.getBoundingClientRect())
    setViewerIndex(idx)
    setViewerOpen(true)
  }

  // Bulk delete
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
  }, [selectedIds])

  // Bulk favorite
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
  }, [selectedIds])

  // Open album picker
  const handleOpenAlbumPicker = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/albums')
      if (!res.ok) return
      const data = await res.json()
      setAlbumList((data.albums ?? []).filter((a: PickerAlbum) => a.type === 'manual' || a.type === 'favorites'))
      setShowAlbumPicker(true)
    } catch { /* ignore */ }
  }, [])

  // Add to album
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
  }, [selectedIds])

  return (
    <div className="fixed inset-0 z-30" style={{ background: 'rgba(10, 7, 5, 0.97)' }}>
      {/* Header with back button and title */}
      <div
        className="flex items-center gap-3"
        style={{
          padding: '16px 16px 0',
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
            flexShrink: 0,
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
          {t('folders')}
        </span>
        {/* Total count badge */}
        {folderMeta.photo_count > 0 && !selectMode && (
          <span style={{
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '13px',
            fontWeight: 300,
          }}>
            {folderMeta.photo_count.toLocaleString()}
          </span>
        )}
        {/* Select mode toggle — only shown when there are photos */}
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

      {/* Breadcrumbs */}
      <div
        className="flex items-center gap-0 overflow-x-auto hide-scrollbar"
        style={{
          padding: '10px 16px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1
          return (
            <div key={crumb.path} className="flex items-center" style={{ flexShrink: 0 }}>
              {i > 0 && (
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round"
                  style={{ margin: '0 4px', flexShrink: 0 }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
              <button
                onClick={() => !isLast && setCurrentPath(crumb.path)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: isLast ? 'default' : 'pointer',
                  color: isLast ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.4)',
                  fontSize: '13px',
                  fontWeight: isLast ? 400 : 300,
                  fontFamily: 'var(--font-sans)',
                  padding: '2px 4px',
                  borderRadius: '6px',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => { if (!isLast) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
                onMouseLeave={(e) => { if (!isLast) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
              >
                {crumb.label}
              </button>
            </div>
          )
        })}
      </div>

      {/* Scrollable content area */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: 'calc(100% - 95px)' }}
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
            {t('folder_empty')}
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {/* Folders list */}
            {folders.length > 0 && (
              <div>
                {folders.map((folder) => (
                  <button
                    key={folder.path}
                    onClick={() => navigateToFolder(folder.path)}
                    className="w-full"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '10px 20px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-sans)',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    {/* Folder icon */}
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(207, 86, 54, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(207, 86, 54, 0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                    </div>
                    {/* Name and count */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: 'rgba(255, 255, 255, 0.85)',
                        fontSize: '14px',
                        fontWeight: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        letterSpacing: '0.2px',
                      }}>
                        {folder.name}
                      </div>
                      <div style={{
                        color: 'rgba(255, 255, 255, 0.3)',
                        fontSize: '12px',
                        fontWeight: 300,
                        marginTop: '1px',
                      }}>
                        {folder.photo_count.toLocaleString()} {t('photos').toLowerCase()}
                      </div>
                    </div>
                    {/* Chevron */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            )}

            {/* Divider between folders and photos */}
            {folders.length > 0 && photos.length > 0 && (
              <div style={{
                height: '1px',
                background: 'rgba(255, 255, 255, 0.06)',
                margin: '6px 20px 10px',
              }} />
            )}

            {/* Photos grid */}
            {photos.length > 0 && (
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
                {photos.map((photo, idx) => {
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
                      onClick={(e) => handlePhotoClick(e, idx)}
                    >
                      <img
                        src={photo.small}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                        style={{ display: 'block', pointerEvents: 'none' }}
                      />
                      {/* Selection checkmark overlay */}
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
                  )
                })}
              </div>
            )}

            {/* Loading more indicator */}
            {loadingPhotos && (
              <div style={{ padding: '24px 20px', textAlign: 'center' }}>
                <div style={{
                  width: '18px',
                  height: '18px',
                  border: '2px solid rgba(255,255,255,0.08)',
                  borderTopColor: 'rgba(207, 86, 54, 0.5)',
                  borderRadius: '50%',
                  animation: 'uploadSpin 0.6s linear infinite',
                  margin: '0 auto',
                }} />
              </div>
            )}
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
          {/* Add to Album */}
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

          {/* Favorite */}
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

          {/* Share */}
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

          {/* Kiosk */}
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

          {/* Delete */}
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

          {/* Close select mode */}
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

      {/* PhotoViewer overlay */}
      {viewerOpen && (
        <PhotoViewer
          photos={photos as ViewerPhoto[]}
          startIndex={viewerIndex}
          syncScroll={false}
          onClose={(_idx, vp) => {
            setPhotos(vp as Photo[])
            setViewerOpen(false)
          }}
          thumbnailRect={viewerRect}
        />
      )}
    </div>
  )
}
