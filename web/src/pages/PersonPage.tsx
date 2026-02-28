import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'
import PhotoViewer from '../components/PhotoViewer'
import type { ViewerPhoto } from '../components/PhotoViewer'

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
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '3px',
              padding: '3px',
            }}
          >
            {photos.map((photo, idx) => (
              <div
                key={photo.id}
                className="relative overflow-hidden cursor-pointer"
                style={{
                  aspectRatio: '1',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: '4px',
                }}
                onClick={(e) => {
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
                  className="w-full h-full object-cover transition-transform duration-200"
                  style={{ display: 'block' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
                  }}
                />
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
