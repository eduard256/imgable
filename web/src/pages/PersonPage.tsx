import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'
import PhotoViewer from '../components/PhotoViewer'
import type { ViewerPhoto } from '../components/PhotoViewer'
import { SelectBarBtn, AlbumPickerModal, BulkShareModal, BulkKioskModal } from '../components/SelectionBar'
import type { PickerAlbum } from '../components/SelectionBar'
import { useDragSelect } from '../hooks/useDragSelect'

// ============================================================
// Person Detail Page — photos of a specific person
//
// Header: large avatar, name (editable), photo count, action buttons.
// Tabs: Photos / Hidden / Faces.
// Masonry grid of photos with infinite scroll.
// Modals: Rename, Merge, Manage Faces.
// ============================================================

interface PersonDetail {
  id: string
  name: string
  name_source: 'manual' | 'auto'
  photo_count: number
  faces_count: number
  face_url: string
  face_box: { x: number; y: number; w: number; h: number }
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

interface Face {
  id: string
  photo_count: number
  preview_url: string
  preview_box: { x: number; y: number; w: number; h: number }
}

interface PersonListItem {
  id: string
  name: string
  name_source: 'manual' | 'auto'
  photo_count: number
  face_url: string
  face_box: { x: number; y: number; w: number; h: number }
}

// Mode: viewing a single person or a group of people
type ViewMode = { type: 'person'; id: string } | { type: 'group'; ids: string[] }

export default function PersonPage({ mode, onBack }: {
  mode: ViewMode
  onBack: () => void
}) {
  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [activeTab, setActiveTab] = useState<'photos' | 'hidden' | 'faces'>('photos')
  const [hasMore, setHasMore] = useState(false)

  // Modals
  const [renameModal, setRenameModal] = useState(false)
  const [mergeModal, setMergeModal] = useState(false)
  const [facesModal, setFacesModal] = useState(false)
  const [faces, setFaces] = useState<Face[]>([])
  const [mergeCandidates, setMergeCandidates] = useState<PersonListItem[]>([])
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())
  const [renameName, setRenameName] = useState('')

  // Group mode info
  const [groupNames, setGroupNames] = useState('')

  // Viewer
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

  const personId = mode.type === 'person' ? mode.id : null

  // Load person detail
  useEffect(() => {
    if (mode.type === 'person') {
      apiFetch(`/api/v1/people/${mode.id}`).then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setPerson(data)
        setRenameName(data.name_source === 'manual' ? data.name : '')
      })
    } else {
      // Group mode — load names
      Promise.all(
        mode.ids.map(id => apiFetch(`/api/v1/people/${id}`).then(r => r.json()))
      ).then(people => {
        const names = people.map((p: PersonDetail) =>
          p.name_source === 'manual' ? p.name : null
        ).filter(Boolean)
        const unknownCount = people.length - names.length
        if (names.length === 0) {
          setGroupNames(`${unknownCount} people`)
        } else if (unknownCount === 0) {
          setGroupNames(names.join(', '))
        } else {
          setGroupNames(`${names.join(', ')} +${unknownCount}`)
        }
      })
    }
  }, [mode])

  // Load photos for current tab
  const loadPhotos = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true

    try {
      let endpoint: string
      if (mode.type === 'person') {
        endpoint = activeTab === 'hidden'
          ? `/api/v1/people/${mode.id}/photos/hidden`
          : `/api/v1/people/${mode.id}/photos`
      } else {
        const idsParam = mode.ids.join(',')
        endpoint = activeTab === 'hidden'
          ? `/api/v1/people/groups/photos/hidden?ids=${idsParam}`
          : `/api/v1/people/groups/photos?ids=${idsParam}`
      }

      const separator = endpoint.includes('?') ? '&' : '?'
      const cursor = reset ? null : cursorRef.current
      const url = cursor
        ? `${endpoint}${separator}limit=100&cursor=${cursor}`
        : `${endpoint}${separator}limit=100`

      const res = await apiFetch(url)
      if (!res.ok) return
      const data = await res.json()

      if (reset) {
        setPhotos(data.photos)
      } else {
        setPhotos(prev => [...prev, ...data.photos])
      }

      cursorRef.current = data.next_cursor || null
      setHasMore(data.has_more)
    } finally {
      loadingRef.current = false
    }
  }, [mode, activeTab])

  // Load photos on mount and tab change
  useEffect(() => {
    cursorRef.current = null
    loadPhotos(true)
  }, [activeTab, loadPhotos])

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 800 && hasMore && !loadingRef.current) {
      loadPhotos(false)
    }
  }, [hasMore, loadPhotos])

  // Face crop for header avatar
  const avatarScale = person?.face_box
    ? 1
    : 1
  const avatarObjPos = person?.face_box
    ? `${(person.face_box.x + person.face_box.w / 2) * 100}% ${(person.face_box.y + person.face_box.h / 2) * 100}%`
    : '50% 50%'

  // --- Action handlers ---

  async function handleRename() {
    if (!renameName.trim() || !personId) return
    await apiFetch(`/api/v1/people/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameName.trim() }),
    })
    // Reload person
    const res = await apiFetch(`/api/v1/people/${personId}`)
    if (res.ok) setPerson(await res.json())
    setRenameModal(false)
  }

  async function handleDelete() {
    if (!personId) return
    await apiFetch(`/api/v1/people/${personId}`, { method: 'DELETE' })
    onBack()
  }

  async function openMergeModal() {
    const res = await apiFetch('/api/v1/people?limit=100&offset=0')
    if (!res.ok) return
    const data = await res.json()
    setMergeCandidates(data.people.filter((p: PersonListItem) => p.id !== personId))
    setMergeSelected(new Set())
    setMergeModal(true)
  }

  async function handleMerge() {
    if (mergeSelected.size === 0 || !personId) return
    const sourceIds = [...mergeSelected, personId]
    await apiFetch('/api/v1/people/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_ids: sourceIds, target_id: personId }),
    })
    setMergeModal(false)
    // Reload
    const res = await apiFetch(`/api/v1/people/${personId}`)
    if (res.ok) setPerson(await res.json())
    cursorRef.current = null
    loadPhotos(true)
  }

  async function openFacesModal() {
    if (!personId) return
    const res = await apiFetch(`/api/v1/people/${personId}/faces`)
    if (!res.ok) return
    const data = await res.json()
    setFaces(data.faces)
    setFacesModal(true)
  }

  async function handleDetachFace(faceId: string) {
    if (!personId) return
    await apiFetch(`/api/v1/people/${personId}/faces/${faceId}`, { method: 'DELETE' })
    // Reload faces
    const res = await apiFetch(`/api/v1/people/${personId}/faces`)
    if (res.ok) {
      const data = await res.json()
      setFaces(data.faces)
      if (data.faces.length <= 1) setFacesModal(false)
    }
    // Reload person
    const pRes = await apiFetch(`/api/v1/people/${personId}`)
    if (pRes.ok) setPerson(await pRes.json())
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

  const isGroup = mode.type === 'group'
  const tabs: Array<'photos' | 'hidden' | 'faces'> = isGroup
    ? ['photos', 'hidden']
    : ['photos', 'hidden', 'faces']

  const tabLabels: Record<string, string> = {
    photos: t('photos'),
    hidden: t('hidden'),
    faces: t('faces'),
  }

  return (
    <div className="fixed inset-0 z-40" style={{ background: 'rgba(10, 7, 5, 0.98)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
        {/* Top bar with back button */}
        <div className="flex items-center gap-3" style={{ padding: '16px 16px 0' }}>
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
          <div className="flex-1" />
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

        {/* Person info */}
        <div className="flex items-center gap-4" style={{ padding: '16px' }}>
          {/* Avatar */}
          {person && (
            <div
              className="relative overflow-hidden flex-shrink-0"
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '18px',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
              }}
            >
              <img
                src={person.face_url}
                alt=""
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: avatarObjPos,
                  transform: `scale(${avatarScale})`,
                }}
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div style={{
              color: 'rgba(255, 255, 255, 0.9)',
              fontSize: '20px',
              fontWeight: 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {isGroup ? groupNames : (
                person?.name_source === 'manual' ? person.name : ''
              )}
            </div>
            <div style={{
              color: 'rgba(255, 255, 255, 0.4)',
              fontSize: '13px',
              fontWeight: 300,
              marginTop: '4px',
            }}>
              {isGroup
                ? t('photos_together')
                : person
                  ? `${person.photo_count} ${t('photos').toLowerCase()} · ${person.faces_count} ${t('faces').toLowerCase()}`
                  : ''
              }
            </div>
          </div>
        </div>

        {/* Action buttons — only for person mode */}
        {!isGroup && person && (
          <div
            className="flex gap-2 overflow-x-auto hide-scrollbar"
            style={{ padding: '0 16px 12px' }}
          >
            <ActionButton label={t('rename')} onClick={() => { setRenameName(person.name_source === 'manual' ? person.name : ''); setRenameModal(true) }} />
            <ActionButton label={t('merge')} onClick={openMergeModal} />
            {person.faces_count > 1 && (
              <ActionButton label={t('faces')} onClick={openFacesModal} />
            )}
            <ActionButton label={t('delete')} danger onClick={handleDelete} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex" style={{ padding: '0 16px' }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 400,
                color: activeTab === tab ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.4)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid rgba(255, 255, 255, 0.7)' : '2px solid transparent',
                cursor: 'pointer',
                letterSpacing: '0.3px',
                transition: 'all 0.2s',
              }}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Photos grid */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: 'calc(100% - 250px)' }}
        onScroll={handleScroll}
      >
        {photos.length === 0 ? (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '14px',
          }}>
            {activeTab === 'hidden' ? t('no_hidden_photos') : t('no_photos')}
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
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      fontSize: '10px',
                    }}
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
          className="fixed z-[50] flex items-center"
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

      {/* Selection modals */}
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
          onClose={(_idx, vp) => {
            setPhotos(vp as Photo[])
            setViewerOpen(false)
          }}
          thumbnailRect={viewerRect}
        />
      )}

      {/* === Modals === */}

      {/* Rename modal */}
      {renameModal && (
        <ModalOverlay onClose={() => setRenameModal(false)}>
          <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
            {t('rename')}
          </div>
          <input
            autoFocus
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
            placeholder={t('enter_name')}
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
            <ModalButton label={t('cancel')} onClick={() => setRenameModal(false)} />
            <ModalButton label={t('save')} primary onClick={handleRename} />
          </div>
        </ModalOverlay>
      )}

      {/* Merge modal */}
      {mergeModal && (
        <ModalOverlay onClose={() => setMergeModal(false)}>
          <div style={{ marginBottom: '12px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
            {t('merge')}
          </div>
          <div style={{ marginBottom: '12px', color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>
            {t('select_to_merge')}
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {mergeCandidates.map((p) => {
              const selected = mergeSelected.has(p.id)
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 cursor-pointer"
                  style={{
                    padding: '8px 10px',
                    borderRadius: '10px',
                    background: selected ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                    marginBottom: '4px',
                    transition: 'background 0.15s',
                  }}
                  onClick={() => {
                    setMergeSelected(prev => {
                      const next = new Set(prev)
                      if (next.has(p.id)) next.delete(p.id)
                      else next.add(p.id)
                      return next
                    })
                  }}
                >
                  {/* Checkbox indicator */}
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '6px',
                    border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.25)',
                    background: selected ? 'rgba(207, 86, 54, 0.8)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}>
                    {selected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  {/* Mini avatar */}
                  <div className="overflow-hidden flex-shrink-0" style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                  }}>
                    <img src={p.face_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>

                  <span style={{
                    flex: 1, fontSize: '13px', color: 'rgba(255,255,255,0.75)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name_source === 'manual' ? p.name : '—'}
                  </span>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
                    {p.photo_count}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 justify-end" style={{ marginTop: '16px' }}>
            <ModalButton label={t('cancel')} onClick={() => setMergeModal(false)} />
            <ModalButton label={t('merge')} primary onClick={handleMerge} disabled={mergeSelected.size === 0} />
          </div>
        </ModalOverlay>
      )}

      {/* Faces modal */}
      {facesModal && (
        <ModalOverlay onClose={() => setFacesModal(false)}>
          <div style={{ marginBottom: '12px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
            {t('faces')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '12px' }}>
            {faces.map((face) => {
              const fBox = face.preview_box
              const fScale = 1
              return (
                <div key={face.id} className="flex flex-col items-center gap-2">
                  <div className="relative overflow-hidden" style={{
                    width: '80px', height: '80px', borderRadius: '14px',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                  }}>
                    <img
                      src={face.preview_url}
                      alt=""
                      style={{
                        position: 'absolute', top: 0, left: 0,
                        width: '100%', height: '100%', objectFit: 'cover',
                        objectPosition: `${(fBox.x + fBox.w / 2) * 100}% ${(fBox.y + fBox.h / 2) * 100}%`,
                        transform: `scale(${fScale})`,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
                    {face.photo_count} {t('photos').toLowerCase()}
                  </span>
                  <button
                    onClick={() => handleDetachFace(face.id)}
                    style={{
                      fontSize: '11px',
                      color: 'rgba(207, 86, 54, 0.9)',
                      background: 'rgba(207, 86, 54, 0.12)',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {t('detach')}
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end" style={{ marginTop: '16px' }}>
            <ModalButton label={t('close')} onClick={() => setFacesModal(false)} />
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

// Small action button used in person header
function ActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
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

// Modal overlay wrapper
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
function ModalButton({ label, onClick, primary, disabled }: {
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
