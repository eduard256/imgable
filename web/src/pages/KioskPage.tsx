// ============================================================
// KioskPage — TV-optimized photo display (/k/{code})
//
// Full-screen kiosk mode that cycles through shared album photos
// using 20 different visual effects with smooth morph transitions.
//
// States: loading -> password? -> collecting -> running
//
// No UI elements visible during running state — pure visual
// experience. Background color customizable via ?bg= parameter.
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { t } from '../lib/i18n'
import { ImagePreloader } from '../kiosk/preloader'
import { KioskEngine } from '../kiosk/engine'
import type { PhotoTransform } from '../kiosk/types'

// ---- Constants ----

/** Maximum number of photo slots in the DOM pool. */
const MAX_SLOTS = 50

/** How many images to preload ahead in the background. */
const PRELOAD_AHEAD = 20

// ---- Types ----

interface SharePhotoItem {
  id: string
  type: 'photo' | 'video'
  width?: number
  height?: number
}

interface ShareResponse {
  type: 'photo' | 'album'
  album?: { name: string; photo_count: number }
  photos?: SharePhotoItem[]
  next_cursor?: string
  has_more?: boolean
}

type KioskState = 'loading' | 'password' | 'collecting' | 'running' | 'error'

// ---- Component ----

export default function KioskPage({ code }: { code: string }) {
  const [state, setState] = useState<KioskState>('loading')
  const [password, setPassword] = useState('')
  const [savedPassword, setSavedPassword] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('password') || ''
  })
  const [bgColor] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const bg = params.get('bg')
    return bg ? `#${bg}` : '#ffffff'
  })
  const [collectProgress, setCollectProgress] = useState({ loaded: 0, total: 0 })

  // Refs
  const preloaderRef = useRef<ImagePreloader | null>(null)
  const engineRef = useRef<KioskEngine | null>(null)
  const slotsRef = useRef<HTMLDivElement[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const cursorTimeoutRef = useRef<number>(0)
  const [cursorVisible, setCursorVisible] = useState(true)

  // ---- Parse bg color for text contrast ----
  const isDarkBg = useRef(false)
  useEffect(() => {
    // Simple luminance check for password form styling
    const hex = bgColor.replace('#', '')
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      isDarkBg.current = luminance < 0.5
    }
  }, [bgColor])

  // ---- Fetch share data ----

  const fetchShare = useCallback(async (pw?: string) => {
    try {
      let url = `/s/${code}`
      const usePw = pw || savedPassword
      if (usePw) url += `?password=${encodeURIComponent(usePw)}`

      const res = await fetch(url)

      if (res.status === 401) {
        setState('password')
        return
      }
      if (!res.ok) {
        setState('error')
        return
      }

      const data: ShareResponse = await res.json()

      if (data.type !== 'album') {
        // Kiosk mode only works for albums
        setState('error')
        return
      }

      if (pw) setSavedPassword(pw)

      // Start collecting all photo IDs
      const allIds: string[] = []
      const totalCount = data.album?.photo_count ?? 0

      if (data.photos) {
        for (const p of data.photos) allIds.push(p.id)
      }

      setCollectProgress({ loaded: allIds.length, total: totalCount })
      setState('collecting')

      // Paginate to get all photo IDs
      let cursor = data.next_cursor
      let hasMore = data.has_more ?? false
      const activePw = pw || savedPassword

      while (hasMore && cursor) {
        let pageUrl = `/s/${code}?cursor=${cursor}`
        if (activePw) pageUrl += `&password=${encodeURIComponent(activePw)}`

        const pageRes = await fetch(pageUrl)
        if (!pageRes.ok) break

        const pageData: ShareResponse = await pageRes.json()
        if (pageData.photos) {
          for (const p of pageData.photos) allIds.push(p.id)
        }

        setCollectProgress({ loaded: allIds.length, total: totalCount })
        cursor = pageData.next_cursor
        hasMore = pageData.has_more ?? false
      }

      // Initialize preloader with all IDs
      const preloader = new ImagePreloader({
        code,
        password: activePw || undefined,
        preloadAhead: PRELOAD_AHEAD,
      })
      preloader.setPhotoIds(allIds)
      preloaderRef.current = preloader

      // Preload first batch
      preloader.preloadNext(PRELOAD_AHEAD)

      setState('running')
    } catch {
      setState('error')
    }
  }, [code, savedPassword])

  // ---- Initial load ----

  useEffect(() => {
    fetchShare()
  }, [fetchShare])

  // ---- Password form submit ----

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setState('loading')
    fetchShare(password.trim())
  }

  // ---- Hide cursor after idle ----

  useEffect(() => {
    if (state !== 'running') return

    function handleMouseMove() {
      setCursorVisible(true)
      clearTimeout(cursorTimeoutRef.current)
      cursorTimeoutRef.current = window.setTimeout(() => {
        setCursorVisible(false)
      }, 3000)
    }

    handleMouseMove() // start timer
    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      clearTimeout(cursorTimeoutRef.current)
    }
  }, [state])

  // ---- Engine setup ----

  useEffect(() => {
    if (state !== 'running' || !preloaderRef.current) return

    const preloader = preloaderRef.current

    const engine = new KioskEngine(
      {
        assignPhoto(slotIndex, size) {
          const id = preloader.next()
          // Trigger preloading of next batch
          preloader.preloadNext(PRELOAD_AHEAD, size)
          return id
        },

        updateSlot(slotIndex, transform) {
          const el = slotsRef.current[slotIndex]
          if (!el) return

          el.style.transform =
            `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale}) rotate(${transform.rotation}deg)`
          el.style.opacity = String(transform.opacity)
          el.style.width = `${transform.width}px`
          el.style.height = `${transform.height}px`
          el.style.zIndex = String(transform.zIndex ?? 0)
        },

        setSlotVisible(slotIndex, visible) {
          const el = slotsRef.current[slotIndex]
          if (!el) return
          el.style.display = visible ? 'block' : 'none'
        },

        setSlotImage(slotIndex, photoId, size) {
          const el = slotsRef.current[slotIndex]
          if (!el) return
          const img = el.querySelector('img') as HTMLImageElement
          if (!img || !photoId) return
          const url = preloader.buildUrl(photoId, size)
          if (img.src !== url) {
            img.src = url
          }
        },
      },
      { maxSlots: MAX_SLOTS },
    )

    engineRef.current = engine
    engine.start()

    return () => {
      engine.stop()
      engineRef.current = null
    }
  }, [state])

  // ---- Render ----

  // Text color based on background
  const textColor = isDarkBg.current ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)'
  const textColorStrong = isDarkBg.current ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)'
  const inputBg = isDarkBg.current ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const inputBorder = isDarkBg.current ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
  const buttonBg = isDarkBg.current ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
  const buttonBgHover = isDarkBg.current ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.14)'

  // Loading
  if (state === 'loading') {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        <div style={{
          width: '32px',
          height: '32px',
          border: `2px solid ${isDarkBg.current ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
          borderTopColor: isDarkBg.current ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)',
          borderRadius: '50%',
          animation: 'uploadSpin 0.8s linear infinite',
        }} />
      </div>
    )
  }

  // Password form
  if (state === 'password') {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        <div style={{
          background: inputBg,
          backdropFilter: 'blur(20px)',
          borderRadius: '24px',
          padding: '40px 36px',
          border: `1px solid ${inputBorder}`,
          width: 'min(90vw, 360px)',
          textAlign: 'center',
        }}>
          {/* Lock icon */}
          <div style={{ marginBottom: '20px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={textColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto', display: 'block' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>

          <div style={{
            color: textColor,
            fontSize: '14px',
            marginBottom: '24px',
            lineHeight: '1.5',
          }}>
            {t('share_protected')}
          </div>

          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('share_enter_password')}
              autoFocus
              style={{
                width: '100%',
                padding: '14px 18px',
                borderRadius: '14px',
                background: inputBg,
                border: `1px solid ${inputBorder}`,
                color: textColorStrong,
                fontSize: '15px',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
                textAlign: 'center',
                letterSpacing: '1px',
              }}
            />
            <button
              type="submit"
              className="transition-all duration-200"
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '14px',
                borderRadius: '14px',
                background: buttonBg,
                border: `1px solid ${inputBorder}`,
                color: textColorStrong,
                fontSize: '15px',
                fontWeight: 400,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                letterSpacing: '1px',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = buttonBgHover
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = buttonBg
              }}
            >
              {t('login')}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Collecting phase — loading all photo IDs
  if (state === 'collecting') {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: `2px solid ${isDarkBg.current ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
            borderTopColor: isDarkBg.current ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)',
            borderRadius: '50%',
            animation: 'uploadSpin 0.8s linear infinite',
            margin: '0 auto 16px',
          }} />
          {collectProgress.total > 0 && (
            <div style={{
              color: textColor,
              fontSize: '14px',
              fontWeight: 300,
            }}>
              {collectProgress.loaded} / {collectProgress.total}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Error
  if (state === 'error') {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        <div style={{ textAlign: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={textColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px', display: 'block' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{
            color: textColor,
            fontSize: '16px',
            fontWeight: 300,
          }}>
            {t('share_not_found')}
          </div>
        </div>
      </div>
    )
  }

  // ---- Running state: the kiosk! ----

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden"
      style={{
        backgroundColor: bgColor,
        cursor: cursorVisible ? 'default' : 'none',
      }}
    >
      {/* Photo slot pool — absolutely positioned, GPU-composited */}
      {Array.from({ length: MAX_SLOTS }, (_, i) => (
        <div
          key={i}
          ref={(el) => { if (el) slotsRef.current[i] = el }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'none',
            willChange: 'transform, opacity',
            overflow: 'hidden',
            borderRadius: '4px',
          }}
        >
          <img
            src=""
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        </div>
      ))}
    </div>
  )
}
