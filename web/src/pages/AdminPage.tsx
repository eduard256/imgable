import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch, getSavedPassword } from '../lib/api'
import { t, getLang } from '../lib/i18n'

// ============================================================
// Admin Dashboard — unified admin panel
//
// Terracotta desert background, glass-morphism cards.
// Sections: Library stats, Pipeline status (auto-refresh),
// Processing metrics, Shared links, Failed files.
// Single scrollable page, fully responsive.
// ============================================================

// ---- Clipboard helper (works over HTTP without Clipboard API) ----

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => copyFallback(text))
  } else {
    copyFallback(text)
  }
}

function copyFallback(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

// ---- Glass card styles (reused throughout) ----

const glassCard: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.07)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '16px',
  padding: '20px',
}

const glassCardCompact: React.CSSProperties = {
  ...glassCard,
  padding: '14px 16px',
}

const sectionTitle: React.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.9)',
  fontSize: '15px',
  fontWeight: 400,
  letterSpacing: '0.5px',
  marginBottom: '16px',
}

const labelStyle: React.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.45)',
  fontSize: '11px',
  fontWeight: 300,
  letterSpacing: '0.8px',
  textTransform: 'uppercase' as const,
}

// ---- Types ----

interface Stats {
  total_photos: number
  total_videos: number
  total_albums: number
  total_places: number
  total_favorites: number
  storage: { bytes: number; human: string }
  dates: { oldest?: number; newest?: number }
}

interface ScannerStatus {
  status: string
  uptime_seconds: number
  watcher: {
    running: boolean
    watched_dirs: number
    files_discovered: number
    files_queued: number
    files_skipped: number
    pending_files_count: number
    last_scan_at?: string
    last_scan_duration_ms?: number
  }
  producer: { enqueued_count: number; skipped_count: number; error_count: number }
  queue?: Array<{ name: string; pending: number; active: number; scheduled: number; retry: number; archived: number }>
}

interface ProcessorStatus {
  status: string
  paused: boolean
  uptime_seconds: number
  workers: { total: number; active: number; idle: number }
  queue: { pending: number; processing: number; completed_total: number; failed_total: number }
  processing: { avg_duration_ms: number; photos_per_minute: number }
  resources: { memory_used_mb: number; memory_limit_mb: number; num_goroutines: number }
}

interface AIStatus {
  status: string
  current_photo?: { id: string } | null
  queue: { pending: number }
  estimated_time_seconds?: number | null
  last_run?: {
    started_at?: string
    completed_at?: string
    photos_processed?: number
    faces_found?: number
    tags_added?: number
  } | null
}

interface PlacesStatus {
  status: string
  pending_count: number
  last_run?: {
    started_at?: string
    completed_at?: string
    photos_processed?: number
    places_created?: number
    nominatim_requests?: number
    errors?: number
  } | null
}

interface Share {
  id: string
  type: string
  code: string
  url: string
  has_password: boolean
  expires_at?: number | null
  view_count: number
  created_at: number
}

interface FailedFile {
  path: string
  original_path: string
  error: string
  stage: string
  attempts: number
  failed_at: string
  file_size: number
}

// ---- Animated counter hook ----

function useAnimatedCounter(target: number, duration = 1500): number {
  const [value, setValue] = useState(0)
  const prevTarget = useRef(0)

  useEffect(() => {
    if (target === prevTarget.current) return
    const start = prevTarget.current
    prevTarget.current = target
    const startTime = performance.now()

    function animate(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(start + (target - start) * eased))
      if (progress < 1) requestAnimationFrame(animate)
    }

    requestAnimationFrame(animate)
  }, [target, duration])

  return value
}

// ---- Ring chart component ----

function RingChart({ value, max, size = 80, strokeWidth = 6, color = '#6B8E5A', bgColor = 'rgba(255,255,255,0.08)', label, centerText }: {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  color?: string
  bgColor?: string
  label: string
  centerText?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = max > 0 ? Math.min(value / max, 1) : 0
  const offset = circumference * (1 - progress)

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={bgColor} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }} />
        {centerText && (
          <text x={size / 2} y={size / 2}
            textAnchor="middle" dominantBaseline="central"
            fill="rgba(255,255,255,0.85)" fontSize="14" fontWeight="400"
            fontFamily="var(--font-sans)"
            style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
            {centerText}
          </text>
        )}
      </svg>
      <span style={labelStyle}>{label}</span>
    </div>
  )
}

// ---- Stat card component ----

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div style={glassCard} className="flex flex-col items-center gap-2 py-5">
      <div style={{ color: 'rgba(255, 255, 255, 0.5)' }}>{icon}</div>
      <div style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '26px', fontWeight: 500, letterSpacing: '-0.5px' }}>
        {value}
      </div>
      <div style={labelStyle}>{label}</div>
    </div>
  )
}

// ---- Pipeline step component ----

function PipelineStep({ name, pending, isActive, isPaused, expanded, onToggleExpand, actionButton, details }: {
  name: string
  pending: number
  isActive: boolean
  isPaused: boolean
  expanded: boolean
  onToggleExpand: () => void
  actionButton: React.ReactNode
  details: React.ReactNode
}) {
  const dotColor = isPaused ? '#E8A847' : isActive ? '#6B8E5A' : 'rgba(255,255,255,0.25)'

  return (
    <div style={{ flex: '1 1 0', minWidth: '140px' }}>
      <div style={glassCardCompact} className="flex flex-col gap-3">
        {/* Header with status dot */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Status dot */}
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: dotColor,
              boxShadow: isActive ? `0 0 8px ${dotColor}` : 'none',
              animation: isActive ? 'adminPulse 2s ease-in-out infinite' : 'none',
            }} />
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '13px', fontWeight: 400 }}>
              {name}
            </span>
          </div>
          {/* Info button */}
          <button
            onClick={onToggleExpand}
            style={{
              width: '22px', height: '22px', borderRadius: '50%',
              background: expanded ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </div>

        {/* Key metric */}
        <div>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: '22px', fontWeight: 500 }}>
            {pending.toLocaleString()}
          </div>
          <div style={{ ...labelStyle, fontSize: '10px' }}>{t('admin_pending')}</div>
        </div>

        {/* Action button */}
        <div>{actionButton}</div>
      </div>

      {/* Expanded details panel */}
      <div style={{
        maxHeight: expanded ? '400px' : '0',
        overflow: 'hidden',
        transition: 'max-height 0.3s ease-out, opacity 0.3s ease-out, margin-top 0.3s ease-out',
        opacity: expanded ? 1 : 0,
        marginTop: expanded ? '8px' : '0',
      }}>
        <div style={{ ...glassCardCompact, background: 'rgba(255,255,255,0.04)', borderRadius: '12px' }}>
          {details}
        </div>
      </div>
    </div>
  )
}

// ---- Action button (glass pill) ----

function ActionButton({ label, onClick, variant = 'default', disabled = false }: {
  label: string; onClick: () => void; variant?: 'default' | 'warning' | 'danger'; disabled?: boolean
}) {
  const colors = {
    default: { bg: 'rgba(255,255,255,0.08)', hoverBg: 'rgba(255,255,255,0.14)', text: 'rgba(255,255,255,0.7)' },
    warning: { bg: 'rgba(232,168,71,0.15)', hoverBg: 'rgba(232,168,71,0.25)', text: 'rgba(232,168,71,0.9)' },
    danger: { bg: 'rgba(207,86,54,0.15)', hoverBg: 'rgba(207,86,54,0.25)', text: 'rgba(207,86,54,0.9)' },
  }
  const c = colors[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 14px', borderRadius: '20px',
        background: c.bg, border: 'none',
        color: c.text, fontSize: '12px', fontWeight: 400,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.15s',
        fontFamily: 'var(--font-sans)',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget.style.background = c.hoverBg) }}
      onMouseLeave={e => { (e.currentTarget.style.background = c.bg) }}
    >
      {label}
    </button>
  )
}

// ---- Detail row ----

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center" style={{ padding: '4px 0' }}>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px' }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', fontWeight: 400 }}>{String(value)}</span>
    </div>
  )
}

// ---- Share card ----

function ShareCard({ share, onDelete }: { share: Share; onDelete: (id: string) => void }) {
  const [copied, setCopied] = useState(false)
  const isExpired = share.expires_at ? share.expires_at * 1000 < Date.now() : false
  const lang = getLang()
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'

  const fullUrl = `${window.location.origin}${share.url}`

  function handleCopy() {
    copyText(fullUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDelete() {
    if (confirm(t('admin_delete_share'))) {
      onDelete(share.id)
    }
  }

  const createdDate = new Date(share.created_at * 1000).toLocaleDateString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  const expiresText = share.expires_at
    ? new Date(share.expires_at * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : t('admin_no_expiry')

  return (
    <div style={{
      ...glassCardCompact,
      opacity: isExpired ? 0.5 : 1,
      transition: 'opacity 0.2s',
    }}>
      {/* Header row: type badge + expired badge */}
      <div className="flex items-center gap-2" style={{ marginBottom: '10px' }}>
        <span style={{
          padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 400,
          background: share.type === 'photo' ? 'rgba(107,142,90,0.2)' : 'rgba(139,111,90,0.2)',
          color: share.type === 'photo' ? 'rgba(107,142,90,0.9)' : 'rgba(139,111,90,0.9)',
        }}>
          {share.type === 'photo' ? t('admin_photo') : t('admin_album')}
        </span>
        {share.has_password && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        )}
        {isExpired && (
          <span style={{
            padding: '2px 8px', borderRadius: '8px', fontSize: '11px',
            background: 'rgba(207,86,54,0.2)', color: 'rgba(207,86,54,0.9)',
          }}>
            {t('admin_expired')}
          </span>
        )}
      </div>

      {/* URL + copy */}
      <div className="flex gap-2" style={{ marginBottom: '10px' }}>
        <input
          readOnly
          value={fullUrl}
          onClick={e => (e.target as HTMLInputElement).select()}
          style={{
            flex: 1, padding: '6px 10px', borderRadius: '8px', fontSize: '12px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-sans)',
          }}
        />
        <button
          onClick={handleCopy}
          style={{
            padding: '6px 12px', borderRadius: '8px', fontSize: '11px',
            background: 'rgba(255,255,255,0.08)', border: 'none',
            color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
          }}
        >
          {copied ? t('admin_copied') : t('admin_copy')}
        </button>
      </div>

      {/* Meta row */}
      <div className="flex justify-between items-center" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
        <span>{t('admin_views')}: {share.view_count}</span>
        <span>{createdDate}</span>
      </div>
      <div className="flex justify-between items-center" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
        <span>{t('admin_expires')}: {expiresText}</span>
        <button onClick={handleDelete} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(207,86,54,0.7)', fontSize: '11px', fontFamily: 'var(--font-sans)',
          padding: '2px 0',
        }}>
          {t('delete')}
        </button>
      </div>
    </div>
  )
}

// ---- Format helpers ----

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `~${Math.floor(seconds / 60)} min`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return mins > 0 ? `~${hours}h ${mins}m` : `~${hours}h`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ---- SVG Icons (stroke-based, 1.5 width) ----

const icons = {
  photos: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  videos: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  ),
  albums: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  ),
  places: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  favorites: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  ),
  storage: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
}

// ---- SMB connection info section ----

function SmbSection() {
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const password = getSavedPassword() ?? ''
  const ip = window.location.hostname

  const paths = [
    { os: 'Windows', value: `\\\\${ip}\\Uploads` },
    { os: 'macOS', value: `smb://${ip}/Uploads` },
    { os: 'Linux', value: `//${ip}/Uploads` },
  ]

  function copyField(text: string, field: string) {
    copyText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Inline styles for the credential row and copy button, matching the existing admin aesthetic
  const credRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px 12px', borderRadius: '10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
  }

  const monoValue: React.CSSProperties = {
    flex: 1, fontSize: '13px', fontWeight: 400,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    userSelect: 'all',
  }

  const copyBtn: React.CSSProperties = {
    padding: '4px 10px', borderRadius: '8px', fontSize: '11px',
    background: 'rgba(255,255,255,0.08)', border: 'none',
    color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
    fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
    transition: 'background 0.15s',
    flexShrink: 0,
  }

  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={sectionTitle}>
        <div className="flex items-center gap-2">
          {/* SMB/network icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <span>{t('admin_smb')}</span>
          <span style={{ fontSize: '11px', fontWeight: 300, color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>
            {t('admin_smb_hint')}
          </span>
        </div>
      </div>

      <div style={glassCard}>
        <div className="flex flex-col gap-3">

          {/* Credentials row: login + password side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Login */}
            <div>
              <div style={{ ...labelStyle, marginBottom: '6px' }}>{t('admin_smb_login')}</div>
              <div style={credRow}>
                <span style={monoValue}>imgable</span>
                <button
                  style={copyBtn}
                  onClick={() => copyField('imgable', 'login')}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                >
                  {copiedField === 'login' ? t('admin_copied') : t('admin_copy')}
                </button>
              </div>
            </div>

            {/* Password */}
            <div>
              <div style={{ ...labelStyle, marginBottom: '6px' }}>{t('admin_smb_password')}</div>
              <div style={credRow}>
                <span style={monoValue}>
                  {passwordVisible ? password : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                </span>
                {/* Show/hide toggle */}
                <button
                  onClick={() => setPasswordVisible(v => !v)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.4)', padding: '2px',
                    display: 'flex', alignItems: 'center', flexShrink: 0,
                  }}
                  title={passwordVisible ? 'Hide' : 'Show'}
                >
                  {passwordVisible ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
                <button
                  style={copyBtn}
                  onClick={() => copyField(password, 'password')}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                >
                  {copiedField === 'password' ? t('admin_copied') : t('admin_copy')}
                </button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

          {/* Connection paths */}
          <div>
            <div style={{ ...labelStyle, marginBottom: '8px' }}>{t('admin_smb_path')}</div>
            <div className="flex flex-col gap-2">
              {paths.map(({ os, value }) => (
                <div key={os} style={credRow}>
                  <span style={{
                    fontSize: '11px', fontWeight: 400,
                    color: 'rgba(255,255,255,0.35)',
                    minWidth: '52px', flexShrink: 0,
                  }}>
                    {os}
                  </span>
                  <span style={monoValue}>{value}</span>
                  <button
                    style={copyBtn}
                    onClick={() => copyField(value, os)}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                  >
                    {copiedField === os ? t('admin_copied') : t('admin_copy')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Main Component
// ============================================================

export default function AdminPage({ onBack }: { onBack: () => void }) {
  // ---- State ----
  const [stats, setStats] = useState<Stats | null>(null)
  const [scanner, setScanner] = useState<ScannerStatus | null>(null)
  const [processor, setProcessor] = useState<ProcessorStatus | null>(null)
  const [ai, setAI] = useState<AIStatus | null>(null)
  const [places, setPlaces] = useState<PlacesStatus | null>(null)
  const [shares, setShares] = useState<Share[]>([])
  const [failedFiles, setFailedFiles] = useState<FailedFile[]>([])
  const [failedTotal, setFailedTotal] = useState(0)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [failedExpanded, setFailedExpanded] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [fadeIn, setFadeIn] = useState(false)

  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---- Animated counters ----
  const animPhotos = useAnimatedCounter(stats?.total_photos ?? 0)
  const animVideos = useAnimatedCounter(stats?.total_videos ?? 0)
  const animAlbums = useAnimatedCounter(stats?.total_albums ?? 0)
  const animPlaces = useAnimatedCounter(stats?.total_places ?? 0)
  const animFavorites = useAnimatedCounter(stats?.total_favorites ?? 0)

  // ---- Data loading ----

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/stats')
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [])

  const loadShares = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/shares')
      if (res.ok) {
        const data = await res.json()
        setShares(data.shares ?? [])
      }
    } catch {}
  }, [])

  const loadSyncStatus = useCallback(async () => {
    try {
      const [scanRes, procRes, aiRes, placesRes] = await Promise.all([
        apiFetch('/api/v1/sync/scanner/status').catch(() => null),
        apiFetch('/api/v1/sync/processor/status').catch(() => null),
        apiFetch('/api/v1/sync/ai/api/v1/status').catch(() => null),
        apiFetch('/api/v1/sync/places/api/v1/status').catch(() => null),
      ])

      if (scanRes?.ok) setScanner(await scanRes.json())
      if (procRes?.ok) {
        const data = await procRes.json()
        setProcessor(data)
        // Load failed files if any
        if (data.queue?.failed_total > 0) {
          try {
            const failedRes = await apiFetch('/api/v1/sync/processor/failed')
            if (failedRes.ok) {
              const fData = await failedRes.json()
              setFailedFiles(fData.files ?? [])
              setFailedTotal(fData.total ?? 0)
            }
          } catch {}
        } else {
          setFailedFiles([])
          setFailedTotal(0)
        }
      }
      if (aiRes?.ok) setAI(await aiRes.json())
      if (placesRes?.ok) setPlaces(await placesRes.json())
    } catch {}
  }, [])

  // ---- Initial load + auto-refresh ----

  useEffect(() => {
    loadStats()
    loadShares()
    loadSyncStatus()

    refreshRef.current = setInterval(loadSyncStatus, 3000)

    // Fade in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFadeIn(true))
    })

    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current)
    }
  }, [loadStats, loadShares, loadSyncStatus])

  // ---- Actions ----

  async function handleRescan() {
    setActionLoading('rescan')
    try {
      await apiFetch('/api/v1/sync/scanner/rescan', { method: 'POST' })
      await loadSyncStatus()
    } catch {}
    setActionLoading(null)
  }

  async function handleToggleProcessor() {
    setActionLoading('processor')
    try {
      const endpoint = processor?.paused ? '/api/v1/sync/processor/resume' : '/api/v1/sync/processor/pause'
      await apiFetch(endpoint, { method: 'POST' })
      await loadSyncStatus()
    } catch {}
    setActionLoading(null)
  }

  async function handleAIToggle() {
    setActionLoading('ai')
    try {
      const endpoint = ai?.status === 'processing'
        ? '/api/v1/sync/ai/api/v1/stop'
        : '/api/v1/sync/ai/api/v1/run'
      await apiFetch(endpoint, { method: 'POST' })
      await loadSyncStatus()
    } catch {}
    setActionLoading(null)
  }

  async function handlePlacesRun() {
    setActionLoading('places')
    try {
      await apiFetch('/api/v1/sync/places/api/v1/run', { method: 'POST' })
      await loadSyncStatus()
    } catch {}
    setActionLoading(null)
  }

  async function handleDeleteShare(id: string) {
    try {
      await apiFetch(`/api/v1/shares/${id}`, { method: 'DELETE' })
      setShares(prev => prev.filter(s => s.id !== id))
    } catch {}
  }

  async function handleRetryFailed(path: string) {
    try {
      await apiFetch(`/api/v1/sync/processor/retry/${encodeURIComponent(path)}`, { method: 'POST' })
      await loadSyncStatus()
    } catch {}
  }

  async function handleDeleteFailed(path: string) {
    try {
      await apiFetch(`/api/v1/sync/processor/failed/${encodeURIComponent(path)}`, { method: 'DELETE' })
      await loadSyncStatus()
    } catch {}
  }

  // ---- Date formatting ----
  const lang = getLang()
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'
  const fmtDate = (ts?: number) => ts ? new Date(ts * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '---'

  // ---- Pipeline helpers ----
  const scannerPending = scanner?.watcher?.pending_files_count ?? 0
  const processorPending = processor?.queue?.pending ?? 0
  const aiPending = ai?.queue?.pending ?? 0
  const placesPending = places?.pending_count ?? 0

  const scannerActive = scanner?.status === 'running' && (scanner?.watcher?.pending_files_count ?? 0) > 0
  const processorActive = processor?.status === 'running' && !processor?.paused && (processor?.queue?.processing ?? 0) > 0
  const aiActive = ai?.status === 'processing'
  const placesActive = places?.status === 'processing'

  const anyActive = scannerActive || processorActive || aiActive || placesActive

  // ---- Max uptime for header ----
  const maxUptime = Math.max(scanner?.uptime_seconds ?? 0, processor?.uptime_seconds ?? 0)

  return (
    <div
      className="fixed inset-0 z-10 overflow-y-auto"
      style={{
        opacity: fadeIn ? 1 : 0,
        transition: 'opacity 0.6s ease-in',
      }}
    >
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes adminPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes adminDash {
          to { stroke-dashoffset: -20; }
        }
      `}</style>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '16px 16px 80px' }}>

        {/* ======== HEADER ======== */}
        <div className="flex items-center justify-between" style={{ marginBottom: '28px', paddingTop: '4px' }}>
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button
              onClick={onBack}
              className="flex items-center justify-center"
              style={{
                width: '36px', height: '36px', borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                border: 'none', cursor: 'pointer',
                color: 'rgba(255, 255, 255, 0.7)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '20px', fontWeight: 400, letterSpacing: '0.3px' }}>
              {t('admin')}
            </span>
          </div>
          {/* Uptime indicator */}
          {maxUptime > 0 && (
            <div className="flex items-center gap-2" style={{ ...labelStyle, fontSize: '11px' }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: '#6B8E5A',
                boxShadow: '0 0 6px rgba(107,142,90,0.5)',
              }} />
              {t('admin_uptime')} {formatUptime(maxUptime)}
            </div>
          )}
        </div>

        {/* ======== LIBRARY OVERVIEW ======== */}
        <div style={{ marginBottom: '28px' }}>
          <div style={sectionTitle}>{t('admin_library')}</div>

          {/* Stats grid: 3 columns desktop, 2 mobile */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '10px',
          }}>
            <StatCard icon={icons.photos} value={animPhotos.toLocaleString()} label={t('photos')} />
            <StatCard icon={icons.videos} value={animVideos.toLocaleString()} label={t('admin_videos')} />
            <StatCard icon={icons.albums} value={animAlbums.toLocaleString()} label={t('albums')} />
            <StatCard icon={icons.places} value={animPlaces.toLocaleString()} label={t('places')} />
            <StatCard icon={icons.favorites} value={animFavorites.toLocaleString()} label={t('favorites')} />
            <StatCard icon={icons.storage} value={stats?.storage?.human ?? '---'} label={t('admin_storage')} />
          </div>

          {/* Timeline bar */}
          {stats?.dates?.oldest && stats?.dates?.newest && (
            <div style={{ ...glassCard, marginTop: '10px', padding: '14px 16px' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                <span style={{ ...labelStyle, fontSize: '10px' }}>{t('admin_timeline')}</span>
              </div>
              <div style={{
                height: '4px', borderRadius: '2px',
                background: 'linear-gradient(90deg, rgba(207,86,54,0.6), rgba(232,168,71,0.6), rgba(107,142,90,0.6))',
                marginBottom: '8px',
              }} />
              <div className="flex justify-between" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                <span>{fmtDate(stats.dates.oldest)}</span>
                <span>{fmtDate(stats.dates.newest)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ======== PIPELINE STATUS ======== */}
        <div style={{ marginBottom: '28px' }}>
          <div style={sectionTitle}>{t('admin_pipeline')}</div>

          {/* Pipeline steps with connectors */}
          <div className="flex gap-2 overflow-x-auto hide-scrollbar" style={{ paddingBottom: '4px' }}>
            {/* Scanner */}
            <PipelineStep
              name={t('admin_scan')}
              pending={scannerPending}
              isActive={scannerActive}
              isPaused={false}
              expanded={expandedStep === 'scanner'}
              onToggleExpand={() => setExpandedStep(prev => prev === 'scanner' ? null : 'scanner')}
              actionButton={
                <ActionButton label={t('admin_rescan')} onClick={handleRescan}
                  disabled={actionLoading === 'rescan'} />
              }
              details={scanner ? (
                <div>
                  <DetailRow label={t('admin_watched_dirs')} value={scanner.watcher.watched_dirs} />
                  <DetailRow label={t('admin_discovered')} value={scanner.watcher.files_discovered} />
                  <DetailRow label={t('admin_queued')} value={scanner.watcher.files_queued} />
                  <DetailRow label={t('admin_skipped')} value={scanner.watcher.files_skipped} />
                  <DetailRow label={t('admin_pending')} value={scanner.watcher.pending_files_count} />
                  {scanner.watcher.last_scan_at && (
                    <DetailRow label={t('admin_last_scan')}
                      value={new Date(scanner.watcher.last_scan_at).toLocaleString(locale)} />
                  )}
                </div>
              ) : null}
            />

            {/* Connector line */}
            <div className="flex items-start" style={{ paddingTop: '28px', minWidth: '20px' }}>
              <svg width="20" height="2" style={{ overflow: 'visible' }}>
                <line x1="0" y1="1" x2="20" y2="1"
                  stroke="rgba(255,255,255,0.15)" strokeWidth="2"
                  strokeDasharray="4 3"
                  style={anyActive ? { animation: 'adminDash 0.8s linear infinite' } : {}} />
              </svg>
            </div>

            {/* Processor */}
            <PipelineStep
              name={t('admin_process')}
              pending={processorPending}
              isActive={processorActive}
              isPaused={processor?.paused ?? false}
              expanded={expandedStep === 'processor'}
              onToggleExpand={() => setExpandedStep(prev => prev === 'processor' ? null : 'processor')}
              actionButton={
                <ActionButton
                  label={processor?.paused ? t('admin_resume') : t('admin_pause')}
                  onClick={handleToggleProcessor}
                  variant={processor?.paused ? 'default' : 'warning'}
                  disabled={actionLoading === 'processor'} />
              }
              details={processor ? (
                <div>
                  <DetailRow label={t('admin_workers')}
                    value={`${processor.workers.active} / ${processor.workers.total}`} />
                  <DetailRow label={t('admin_completed')} value={processor.queue.completed_total.toLocaleString()} />
                  <DetailRow label={t('admin_failed')} value={processor.queue.failed_total} />
                  <DetailRow label={t('admin_memory')} value={`${processor.resources.memory_used_mb} MB`} />
                </div>
              ) : null}
            />

            {/* Connector line */}
            <div className="flex items-start" style={{ paddingTop: '28px', minWidth: '20px' }}>
              <svg width="20" height="2" style={{ overflow: 'visible' }}>
                <line x1="0" y1="1" x2="20" y2="1"
                  stroke="rgba(255,255,255,0.15)" strokeWidth="2"
                  strokeDasharray="4 3"
                  style={anyActive ? { animation: 'adminDash 0.8s linear infinite' } : {}} />
              </svg>
            </div>

            {/* AI */}
            <PipelineStep
              name={t('admin_ai')}
              pending={aiPending}
              isActive={aiActive}
              isPaused={false}
              expanded={expandedStep === 'ai'}
              onToggleExpand={() => setExpandedStep(prev => prev === 'ai' ? null : 'ai')}
              actionButton={
                <ActionButton
                  label={ai?.status === 'processing' ? t('admin_stop') : t('admin_run')}
                  onClick={handleAIToggle}
                  variant={ai?.status === 'processing' ? 'danger' : 'default'}
                  disabled={actionLoading === 'ai'} />
              }
              details={ai ? (
                <div>
                  {ai.estimated_time_seconds && (
                    <DetailRow label={t('admin_estimated_time')} value={formatDuration(ai.estimated_time_seconds)} />
                  )}
                  {ai.current_photo?.id && (
                    <DetailRow label="Current" value={ai.current_photo.id.slice(0, 8) + '...'} />
                  )}
                  {ai.last_run && (
                    <>
                      <DetailRow label={t('admin_photos_processed')} value={ai.last_run.photos_processed ?? 0} />
                      <DetailRow label={t('admin_faces_found')} value={ai.last_run.faces_found ?? 0} />
                      <DetailRow label={t('admin_tags_added')} value={ai.last_run.tags_added ?? 0} />
                    </>
                  )}
                </div>
              ) : null}
            />

            {/* Connector line */}
            <div className="flex items-start" style={{ paddingTop: '28px', minWidth: '20px' }}>
              <svg width="20" height="2" style={{ overflow: 'visible' }}>
                <line x1="0" y1="1" x2="20" y2="1"
                  stroke="rgba(255,255,255,0.15)" strokeWidth="2"
                  strokeDasharray="4 3"
                  style={anyActive ? { animation: 'adminDash 0.8s linear infinite' } : {}} />
              </svg>
            </div>

            {/* Places */}
            <PipelineStep
              name={t('admin_places_step')}
              pending={placesPending}
              isActive={placesActive}
              isPaused={false}
              expanded={expandedStep === 'places'}
              onToggleExpand={() => setExpandedStep(prev => prev === 'places' ? null : 'places')}
              actionButton={
                <ActionButton label={t('admin_run')} onClick={handlePlacesRun}
                  disabled={actionLoading === 'places' || placesActive} />
              }
              details={places?.last_run ? (
                <div>
                  <DetailRow label={t('admin_photos_processed')} value={places.last_run.photos_processed ?? 0} />
                  <DetailRow label={t('admin_places_created')} value={places.last_run.places_created ?? 0} />
                  <DetailRow label={t('admin_nominatim_req')} value={places.last_run.nominatim_requests ?? 0} />
                  <DetailRow label={t('admin_errors')} value={places.last_run.errors ?? 0} />
                </div>
              ) : <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px' }}>---</div>}
            />
          </div>
        </div>

        {/* ======== SMB CONNECTION ======== */}
        <SmbSection />

        {/* ======== PROCESSING METRICS ======== */}
        {processor && (
          <div style={{ marginBottom: '28px' }}>
            <div style={sectionTitle}>{t('admin_metrics')}</div>

            <div style={glassCard}>
              <div className="flex items-center justify-around flex-wrap gap-6">
                {/* Workers ring */}
                <RingChart
                  value={processor.workers.active}
                  max={processor.workers.total}
                  color="#6B8E5A"
                  label={t('admin_workers')}
                  centerText={`${processor.workers.active}/${processor.workers.total}`}
                />

                {/* Completed/Failed ring */}
                <RingChart
                  value={processor.queue.completed_total}
                  max={processor.queue.completed_total + processor.queue.failed_total}
                  color="#6B8E5A"
                  bgColor="rgba(207,86,54,0.3)"
                  label={t('admin_queue')}
                  centerText={(processor.queue.completed_total + processor.queue.failed_total).toLocaleString()}
                />

                {/* Memory bar */}
                <div className="flex flex-col items-center gap-2" style={{ minWidth: '120px' }}>
                  <div style={{ width: '100%' }}>
                    <div className="flex justify-between" style={{ marginBottom: '6px' }}>
                      <span style={{ ...labelStyle, fontSize: '10px' }}>{t('admin_memory')}</span>
                      <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px' }}>
                        {processor.resources.memory_used_mb} MB
                      </span>
                    </div>
                    <div style={{
                      height: '6px', borderRadius: '3px',
                      background: 'rgba(255,255,255,0.08)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: '3px',
                        background: 'linear-gradient(90deg, #6B8E5A, #E8A847)',
                        width: processor.resources.memory_limit_mb > 0
                          ? `${Math.min(processor.resources.memory_used_mb / processor.resources.memory_limit_mb * 100, 100)}%`
                          : '50%',
                        transition: 'width 0.8s ease-out',
                      }} />
                    </div>
                  </div>
                  <span style={labelStyle}>{processor.resources.num_goroutines} goroutines</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======== SHARED LINKS ======== */}
        <div style={{ marginBottom: '28px' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: '16px' }}>
            <span style={{ ...sectionTitle, marginBottom: 0 }}>{t('admin_shared_links')}</span>
            {shares.length > 0 && (
              <span style={{
                padding: '1px 8px', borderRadius: '10px', fontSize: '11px',
                background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)',
              }}>
                {shares.length}
              </span>
            )}
          </div>

          {shares.length === 0 ? (
            <div style={{
              ...glassCard, textAlign: 'center',
              color: 'rgba(255,255,255,0.3)', fontSize: '13px',
              padding: '40px 20px',
            }}>
              {t('admin_no_shares')}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '10px',
            }}>
              {shares.map(share => (
                <ShareCard key={share.id} share={share} onDelete={handleDeleteShare} />
              ))}
            </div>
          )}
        </div>

        {/* ======== FAILED FILES ======== */}
        {failedTotal > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <button
              className="flex items-center gap-2 w-full"
              onClick={() => setFailedExpanded(prev => !prev)}
              style={{
                ...sectionTitle, marginBottom: '12px',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, textAlign: 'left',
              }}
            >
              <span>{t('admin_failed_files')}</span>
              <span style={{
                padding: '1px 8px', borderRadius: '10px', fontSize: '11px',
                background: 'rgba(207,86,54,0.2)', color: 'rgba(207,86,54,0.9)',
              }}>
                {failedTotal}
              </span>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round"
                style={{
                  transform: failedExpanded ? 'rotate(180deg)' : 'rotate(0)',
                  transition: 'transform 0.2s',
                  marginLeft: 'auto',
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div style={{
              maxHeight: failedExpanded ? '600px' : '0',
              overflow: 'hidden',
              transition: 'max-height 0.3s ease-out',
            }}>
              <div className="flex flex-col gap-2">
                {failedFiles.map((file, idx) => (
                  <div key={idx} style={{ ...glassCardCompact, background: 'rgba(207,86,54,0.06)' }}>
                    <div className="flex justify-between items-start gap-3">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '12px', color: 'rgba(255,255,255,0.8)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {file.original_path.split('/').pop()}
                        </div>
                        <div style={{ fontSize: '11px', color: 'rgba(207,86,54,0.8)', marginTop: '2px' }}>
                          {file.error}
                        </div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                          {t('admin_stage')}: {file.stage} | {t('admin_attempts')}: {file.attempts}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <ActionButton label={t('admin_retry')} onClick={() => handleRetryFailed(file.path)} />
                        <ActionButton label={t('delete')} onClick={() => handleDeleteFailed(file.path)} variant="danger" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
