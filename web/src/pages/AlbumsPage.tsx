import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'

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

  const cursorRef = useRef<string | null>(null)
  const loadingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
          <span style={{
            color: 'rgba(255, 255, 255, 0.35)',
            fontSize: '14px',
            fontWeight: 300,
          }}>
            {album?.photo_count ?? 0}
          </span>
        </div>

        {/* Actions — only for manual albums */}
        {album && album.type === 'manual' && (
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
        style={{ height: album?.type === 'manual' ? 'calc(100% - 120px)' : 'calc(100% - 75px)' }}
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
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '3px',
              padding: '3px',
            }}
          >
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="relative overflow-hidden cursor-pointer"
                style={{
                  aspectRatio: '1',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: '4px',
                }}
              >
                <img
                  src={photo.small}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-200"
                  style={{ display: 'block' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
                />
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
