import { useState, useEffect, useRef, useCallback } from 'react'
import { login, setToken, savePassword } from '../lib/api'
import { t } from '../lib/i18n'

// ============================================================
// Login Page — "Terracotta Desert"
//
// Single password input rendered as animated dots.
// Last character visible for 1s, then becomes a dot.
// Success: dots scatter like sand, fade to gallery.
// Error: dots fall like sand grains.
// ============================================================

interface DotState {
  char: string
  id: number
  state: 'appearing' | 'visible' | 'dot' | 'falling' | 'exploding'
  revealTimer?: ReturnType<typeof setTimeout>
  // Explosion direction for success animation
  dx?: number
  dy?: number
}

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [dots, setDots] = useState<DotState[]>([])
  const [shaking, setShaking] = useState(false)
  const [showToggle, setShowToggle] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const dotIdRef = useRef(0)
  const passwordRef = useRef('')

  // Focus the hidden input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(async () => {
    const password = passwordRef.current
    if (!password) return

    try {
      const data = await login(password)
      setToken(data.token)
      savePassword(password)

      // Success animation: dots scatter
      setDots(prev => prev.map((dot, i) => {
        const angle = ((i / prev.length) * Math.PI * 2) + (Math.random() * 0.5 - 0.25)
        const distance = 80 + Math.random() * 120
        return {
          ...dot,
          state: 'exploding' as const,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
        }
      }))

      // Redirect after dots scatter
      setTimeout(() => onLogin(), 400)
    } catch {
      // Error animation: dots fall down like sand
      setDots(prev => prev.map(dot => ({ ...dot, state: 'falling' as const })))
      setShaking(true)

      setTimeout(() => {
        setShaking(false)
        setDots([])
        passwordRef.current = ''
        inputRef.current!.value = ''
        inputRef.current?.focus()
      }, 500)
    }
  }, [onLogin])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.FormEvent<HTMLInputElement>) {
    const newValue = (e.target as HTMLInputElement).value
    const oldValue = passwordRef.current
    passwordRef.current = newValue

    if (newValue.length > oldValue.length) {
      const newChar = newValue[newValue.length - 1]
      const newId = ++dotIdRef.current

      setDots(prev => {
        const updated = prev.map(d => {
          if (d.revealTimer) clearTimeout(d.revealTimer)
          return { ...d, state: 'dot' as const, revealTimer: undefined }
        })

        const timer = setTimeout(() => {
          setDots(prev2 => prev2.map(d =>
            d.id === newId ? { ...d, state: 'dot' as const } : d
          ))
        }, 1000)

        return [...updated, {
          char: newChar,
          id: newId,
          state: 'appearing' as const,
          revealTimer: timer,
        }]
      })

      // Transition from appearing to visible after animation
      setTimeout(() => {
        setDots(prev => prev.map(d =>
          d.id === newId && d.state === 'appearing' ? { ...d, state: 'visible' as const } : d
        ))
      }, 120)

      setShowToggle(true)
    } else if (newValue.length < oldValue.length) {
      // Character removed
      setDots(prev => {
        const removed = prev[prev.length - 1]
        if (removed?.revealTimer) clearTimeout(removed.revealTimer)
        const updated = prev.slice(0, -1)
        if (updated.length === 0) setShowToggle(false)
        return updated
      })
    }
  }

  function toggleReveal() {
    setRevealed(prev => !prev)
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-hidden select-none"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Password input area — background is rendered by App.tsx */}
      <div
        className="relative z-10 flex flex-col items-center gap-8"
        style={{
          animation: shaking ? 'shake 0.3s ease' : undefined,
        }}
      >
        {/* Rendered dots — clickable input area */}
        <div
          className="flex items-center gap-3 min-h-[40px] min-w-[200px] justify-center relative cursor-text px-6 py-2 rounded-lg transition-all duration-300"
          style={{
            borderBottom: '1.5px solid rgba(255, 255, 255, 0)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(255, 255, 255, 0.2)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(255, 255, 255, 0)'
          }}
          onClick={() => inputRef.current?.focus()}
        >
          {/* Placeholder "pass" visible when empty */}
          {dots.length === 0 && (
            <span
              style={{
                color: 'rgba(255, 255, 255, 0.2)',
                fontSize: '20px',
                fontWeight: 300,
                letterSpacing: '3px',
              }}
            >
              pass
            </span>
          )}

          {dots.map((dot) => {
            // Determine what to show
            const showChar = revealed || dot.state === 'appearing' || dot.state === 'visible'
            const content = showChar ? dot.char : '\u2022'

            let style: React.CSSProperties = {
              fontFamily: 'var(--font-sans)',
              fontSize: showChar ? '20px' : '24px',
              color: 'rgba(255, 255, 255, 0.9)',
              fontWeight: 300,
              letterSpacing: '2px',
              lineHeight: '40px',
              display: 'inline-block',
              width: '16px',
              textAlign: 'center',
            }

            if (dot.state === 'appearing') {
              style.animation = 'dotAppear 120ms ease-out forwards'
            } else if (dot.state === 'falling') {
              style.animation = 'dotFallDown 0.4s ease-in forwards'
              style.animationDelay = `${Math.random() * 0.15}s`
            } else if (dot.state === 'exploding') {
              style.animation = 'dotExplode 0.5s ease-out forwards'
              style.setProperty?.('--dx', `${dot.dx}px`)
              style.setProperty?.('--dy', `${dot.dy}px`)
              // Use transform directly since CSS custom properties with setProperty
              // won't work on CSSProperties — inline the transform
              style.transform = `translate(${dot.dx}px, ${dot.dy}px) scale(0)`
              style.opacity = 0
              style.transition = 'transform 0.5s ease-out, opacity 0.5s ease-out'
            }

            return (
              <span key={dot.id} style={style}>
                {content}
              </span>
            )
          })}

          {dots.length > 0 && (
            <div
              className="w-[2px] h-[28px] rounded-full ml-1"
              style={{
                background: 'rgba(255, 255, 255, 0.6)',
                animation: 'cursorBlink 1.1s ease-in-out infinite',
              }}
            />
          )}

          {/* Eye toggle button — always visible */}
          {(
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                toggleReveal()
                inputRef.current?.focus()
              }}
              onTouchStart={(e) => {
                e.stopPropagation()
                toggleReveal()
                inputRef.current?.focus()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              className="ml-3 p-2 rounded-full transition-all duration-200"
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(4px)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.2)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.1)'
              }}
              tabIndex={-1}
              type="button"
              aria-label="Toggle password visibility"
            >
              {revealed ? (
                // Eye open — seeing password
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                // Eye closed — hidden password
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Real input — overlays the dot area, transparent but focusable for mobile keyboards */}
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          autoFocus
          spellCheck={false}
          className="absolute inset-0 w-full h-full"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          style={{ opacity: 0, caretColor: 'transparent', fontSize: '16px' }}
        />

        {/* Login button — appears after 3+ characters */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleSubmit()
          }}
          className="rounded-full transition-all duration-300"
          style={{
            marginTop: '8px',
            padding: '12px 40px',
            opacity: dots.length >= 3 ? 1 : 0,
            transform: dots.length >= 3 ? 'translateY(0)' : 'translateY(8px)',
            pointerEvents: dots.length >= 3 ? 'auto' : 'none',
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: '15px',
            fontWeight: 300,
            letterSpacing: '3px',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.18)'
            ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.3)'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.1)'
            ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.15)'
          }}
          tabIndex={-1}
          type="button"
        >
          {t('login')}
        </button>

      </div>
    </div>
  )
}
