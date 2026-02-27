import { useTranslation } from '../hooks/useTranslation'
import { useAppStore, setTheme, setLocale, logout } from '../utils/store'
import { useEffect } from 'react'

/**
 * Settings panel — slides in from the right.
 * Contains: theme toggle, language switch, sync status link,
 * upload, shares management, and logout.
 *
 * This is the ONLY navigation element in the app besides the photo grid.
 * Everything lives here to keep the main screen clean.
 */

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation()
  const theme = useAppStore((s) => s.theme)
  const locale = useAppStore((s) => s.locale)

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleLogout = () => {
    logout()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-overlay animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="
        fixed top-0 right-0 bottom-0 z-50
        w-full max-w-sm bg-bg border-l border-border
        shadow-xl
        flex flex-col
        animate-slide-in-right
      " style={{
        animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-light">
          <h2 className="text-lg font-medium">{t('settings')}</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] hover:bg-surface transition-colors"
          >
            <svg className="w-5 h-5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Theme */}
          <SettingSection title={t('theme_light').split(' ')[0]}>
            <div className="flex gap-2">
              <ToggleButton
                active={theme === 'light'}
                onClick={() => setTheme('light')}
                label={t('theme_light')}
              />
              <ToggleButton
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
                label={t('theme_dark')}
              />
            </div>
          </SettingSection>

          {/* Language */}
          <SettingSection title={t('language')}>
            <div className="flex gap-2">
              <ToggleButton
                active={locale === 'ru'}
                onClick={() => setLocale('ru')}
                label="Русский"
              />
              <ToggleButton
                active={locale === 'en'}
                onClick={() => setLocale('en')}
                label="English"
              />
            </div>
          </SettingSection>

          {/* Navigation links */}
          <SettingSection title="">
            <div className="space-y-1">
              <NavLink icon={<UploadIcon />} label={t('upload')} href="/upload" onClick={onClose} />
              <NavLink icon={<ShareIcon />} label={t('shares')} href="/shares" onClick={onClose} />
              <NavLink icon={<SyncIcon />} label={t('sync')} href="/sync" onClick={onClose} />
              <NavLink icon={<StatsIcon />} label={t('stats')} href="/stats" onClick={onClose} />
              <NavLink icon={<MapIcon />} label={t('map')} href="/map" onClick={onClose} />
            </div>
          </SettingSection>
        </div>

        {/* Logout */}
        <div className="p-6 border-t border-border-light">
          <button
            onClick={handleLogout}
            className="
              w-full py-3 rounded-[var(--radius-md)]
              text-sm font-medium text-text-secondary
              bg-surface hover:bg-surface-hover
              transition-colors duration-200
            "
          >
            {t('logout')}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      {title && (
        <h3 className="text-xs font-medium text-text-tertiary tracking-wider uppercase mb-3">
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-1 py-2.5 rounded-[var(--radius-md)] text-sm font-medium
        transition-all duration-200 ease-out
        ${active
          ? 'bg-accent text-white'
          : 'bg-surface text-text-secondary hover:bg-surface-hover'
        }
      `}
    >
      {label}
    </button>
  )
}

function NavLink({
  icon,
  label,
  href,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  href: string
  onClick: () => void
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        window.location.hash = href
        onClick()
      }}
      className="
        flex items-center gap-3 px-3 py-2.5
        rounded-[var(--radius-md)]
        text-sm text-text hover:bg-surface
        transition-colors duration-150
      "
    >
      <span className="w-5 h-5 text-text-secondary">{icon}</span>
      {label}
    </a>
  )
}

/* ============================================================================
   SVG Icon components — safe, no dangerouslySetInnerHTML
   ============================================================================ */

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M1 4v6h6" />
      <path d="M23 20v-6h-6" />
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
    </svg>
  )
}

function StatsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
