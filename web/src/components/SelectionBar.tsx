import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { t, getLang } from '../lib/i18n'

// ============================================================
// Shared selection UI components used by GalleryPage, FoldersPage, etc.
// Extracted from GalleryPage to enable reuse without duplication.
// ============================================================

// Album type shared across pages that use AlbumPickerModal
export interface PickerAlbum {
  id: string
  type: 'manual' | 'favorites' | 'place'
  name: string
  photo_count: number
  cover?: string
}

// ============================================================
// Selection bar button — circular icon button for the bottom bar
// ============================================================

export function SelectBarBtn({ children, onClick, disabled, title, variant }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  variant?: 'danger'
}) {
  const bg = variant === 'danger' ? 'rgba(207, 86, 54, 0.25)' : 'rgba(255, 255, 255, 0.1)'
  const bgHover = variant === 'danger' ? 'rgba(207, 86, 54, 0.4)' : 'rgba(255, 255, 255, 0.2)'
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      style={{
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        background: bg,
        border: 'none',
        color: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = bgHover }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = bg }}
    >
      {children}
    </button>
  )
}

// ============================================================
// Modal overlay for selection actions — dark backdrop with glass panel
// ============================================================

export function SelectModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
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

// ============================================================
// Shared input style for modal fields
// ============================================================

export const modalInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px',
  color: 'rgba(255,255,255,0.9)',
  fontSize: '14px',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
}

// ============================================================
// Album picker modal with "create new" option
// ============================================================

export function AlbumPickerModal({ albums, onSelect, onClose }: {
  albums: PickerAlbum[]
  onSelect: (albumId: string) => void
  onClose: () => void
}) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function createAndSelect() {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/v1/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) return
      const data = await res.json()
      onSelect(data.id)
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  return (
    <SelectModalOverlay onClose={onClose}>
      <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
        {t('add_to_album')}
      </div>

      {/* Create new album row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createAndSelect() }}
          placeholder={t('album_name')}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            color: 'rgba(255,255,255,0.9)',
            fontSize: '14px',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
          }}
          autoFocus
        />
        <button
          className="viewer-modal-btn-primary"
          onClick={createAndSelect}
          disabled={!newName.trim() || creating}
          style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}
        >
          {creating ? '...' : t('create_album')}
        </button>
      </div>

      {/* Existing albums list */}
      {albums.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {albums.map(a => (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.06)',
                border: 'none',
                borderRadius: '10px',
                color: 'rgba(255,255,255,0.85)',
                fontSize: '14px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                textAlign: 'left',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            >
              <span>{a.name}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>{a.photo_count}</span>
            </button>
          ))}
        </div>
      )}
    </SelectModalOverlay>
  )
}

// ============================================================
// Bulk Share Modal — creates album + share link
// ============================================================

export function BulkShareModal({ photoIds, onClose, onDone }: { photoIds: string[]; onClose: () => void; onDone: () => void }) {
  const [albumName, setAlbumName] = useState(() => {
    const d = new Date()
    return `Shared ${d.toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-US')}`
  })
  const [password, setPassword] = useState('')
  const [expiresDays, setExpiresDays] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function createShare() {
    if (!albumName.trim() || creating) return
    setCreating(true)
    try {
      // 1. Create album
      const albumRes = await apiFetch('/api/v1/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: albumName.trim() }),
      })
      if (!albumRes.ok) return
      const albumData = await albumRes.json()

      // 2. Add photos to album
      await apiFetch(`/api/v1/albums/${albumData.id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: photoIds }),
      })

      // 3. Create share link
      const shareBody: Record<string, unknown> = { type: 'album', album_id: albumData.id }
      if (password.trim()) shareBody.password = password.trim()
      if (expiresDays) shareBody.expires_days = parseInt(expiresDays)

      const shareRes = await apiFetch('/api/v1/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shareBody),
      })
      if (!shareRes.ok) return
      const shareData = await shareRes.json()
      setShareUrl(location.origin + shareData.url)
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  function copyUrl() {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SelectModalOverlay onClose={onClose}>
      <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
        {t('share')} ({photoIds.length})
      </div>

      {!shareUrl ? (
        <>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>{t('album_name')}</div>
            <input type="text" value={albumName} onChange={e => setAlbumName(e.target.value)} style={modalInputStyle} />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>{t('share_password')}</div>
            <input type="text" value={password} onChange={e => setPassword(e.target.value)} style={modalInputStyle} placeholder="..." />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>{t('share_expires')}</div>
            <input type="number" value={expiresDays} onChange={e => setExpiresDays(e.target.value)} style={modalInputStyle} min="1" placeholder="..." />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="viewer-modal-btn" onClick={onClose}>{t('cancel')}</button>
            <button className="viewer-modal-btn-primary" onClick={createShare} disabled={creating || !albumName.trim()}>
              {creating ? t('creating') : t('create_share')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: '12px' }}>
            <input type="text" value={shareUrl} readOnly style={modalInputStyle} onClick={e => (e.target as HTMLInputElement).select()} />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="viewer-modal-btn" onClick={onDone}>{t('close')}</button>
            <button className="viewer-modal-btn-primary" onClick={copyUrl}>
              {copied ? t('copied') : t('copy_link')}
            </button>
          </div>
        </>
      )}
    </SelectModalOverlay>
  )
}

// ============================================================
// Bulk Kiosk Modal — creates share without password, shows kiosk URL with color picker
// ============================================================

const KIOSK_PRESETS = [
  { color: '#ffffff', label: 'White' },
  { color: '#000000', label: 'Black' },
  { color: '#1a1a2e', label: 'Navy' },
  { color: '#2C1F14', label: 'Cocoa' },
]

export function BulkKioskModal({ photoIds, onClose, onDone }: { photoIds: string[]; onClose: () => void; onDone: () => void }) {
  const [bgColor, setBgColor] = useState('#000000')
  const [kioskUrl, setKioskUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  const albumName = (() => {
    const d = new Date()
    return `Kiosk ${d.toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-US')}`
  })()

  async function createKiosk() {
    if (creating) return
    setCreating(true)
    try {
      // 1. Create album
      const albumRes = await apiFetch('/api/v1/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: albumName }),
      })
      if (!albumRes.ok) return
      const albumData = await albumRes.json()

      // 2. Add photos
      await apiFetch(`/api/v1/albums/${albumData.id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: photoIds }),
      })

      // 3. Create share (no password)
      const shareRes = await apiFetch('/api/v1/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'album', album_id: albumData.id }),
      })
      if (!shareRes.ok) return
      const shareData = await shareRes.json()

      // 4. Build kiosk URL
      const hex = bgColor.replace('#', '')
      const url = `${location.origin}/k/${shareData.code}${hex !== 'ffffff' ? `?bg=${hex}` : ''}`
      setKioskUrl(url)
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  function copyUrl() {
    navigator.clipboard.writeText(kioskUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Update URL live when color changes (if already created)
  useEffect(() => {
    if (!kioskUrl) return
    // Extract code from existing URL
    const match = kioskUrl.match(/\/k\/([^?]+)/)
    if (!match) return
    const code = match[1]
    const hex = bgColor.replace('#', '')
    setKioskUrl(`${location.origin}/k/${code}${hex !== 'ffffff' ? `?bg=${hex}` : ''}`)
  }, [bgColor])

  return (
    <SelectModalOverlay onClose={onClose}>
      <div style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.9)', fontSize: '16px', fontWeight: 400 }}>
        {t('kiosk')} ({photoIds.length})
      </div>

      {/* Color picker */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>{t('kiosk_bg_color')}</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
          {KIOSK_PRESETS.map(p => (
            <button
              key={p.color}
              onClick={() => setBgColor(p.color)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: p.color,
                border: bgColor === p.color ? '2px solid rgba(183, 101, 57, 0.9)' : '1px solid rgba(255,255,255,0.15)',
                cursor: 'pointer',
                flexShrink: 0,
                boxShadow: bgColor === p.color ? '0 0 0 2px rgba(183, 101, 57, 0.3)' : 'none',
              }}
              title={p.label}
            />
          ))}
          <div style={{ position: 'relative', width: '32px', height: '32px', flexShrink: 0 }}>
            <input
              type="color"
              value={bgColor}
              onChange={e => setBgColor(e.target.value)}
              style={{
                width: '32px',
                height: '32px',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                padding: 0,
                background: 'transparent',
              }}
            />
          </div>
          <input
            type="text"
            value={bgColor}
            onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setBgColor(e.target.value) }}
            style={{ ...modalInputStyle, width: '90px', flexShrink: 0 }}
          />
        </div>
      </div>

      {!kioskUrl ? (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="viewer-modal-btn" onClick={onClose}>{t('cancel')}</button>
          <button className="viewer-modal-btn-primary" onClick={createKiosk} disabled={creating}>
            {creating ? t('creating') : t('create_share')}
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '12px' }}>
            <input type="text" value={kioskUrl} readOnly style={modalInputStyle} onClick={e => (e.target as HTMLInputElement).select()} />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="viewer-modal-btn" onClick={onDone}>{t('close')}</button>
            <button className="viewer-modal-btn-primary" onClick={copyUrl}>
              {copied ? t('copied') : t('copy_link')}
            </button>
          </div>
        </>
      )}
    </SelectModalOverlay>
  )
}
