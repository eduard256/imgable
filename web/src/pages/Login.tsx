import { useState, useRef, useEffect } from 'react'
import { useTranslation } from '../hooks/useTranslation'
import { api } from '../utils/api'
import { login } from '../utils/store'

/**
 * Login page — the first impression.
 *
 * Design philosophy:
 * - Breathing terracotta gradient background that slowly shifts like a desert sunset
 * - Single password field with a minimal arrow button, no labels
 * - Shake animation on wrong password, smooth dissolve on success
 * - Auto-focus, Enter to submit — zero friction
 */
export default function Login() {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || loading) return

    setLoading(true)
    setError(false)

    try {
      const data = await api.login(password)
      login(data.token, password)
      setSuccess(true)
    } catch {
      setError(true)
      setLoading(false)
      // Trigger shake animation
      formRef.current?.classList.remove('animate-shake')
      void formRef.current?.offsetWidth // force reflow
      formRef.current?.classList.add('animate-shake')
      inputRef.current?.focus()
    }
  }

  return (
    <div
      className={`
        fixed inset-0 flex items-center justify-center
        transition-opacity duration-700 ease-out
        ${success ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}
      style={{
        background: 'linear-gradient(-45deg, #B8452A, #C4663A, #D4764A, #96694F, #7A5540, #B8452A)',
        backgroundSize: '400% 400%',
        animation: 'breathe 20s ease infinite',
      }}
    >
      {/* Noise texture overlay for depth */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-12 px-8">
        {/* Logo */}
        <div className="animate-fade-in-up">
          <h1
            className="text-[clamp(2.5rem,8vw,4.5rem)] font-light tracking-[0.2em] text-white/90 select-none"
            style={{ textShadow: '0 2px 40px rgba(0,0,0,0.15)' }}
          >
            imgable
          </h1>
        </div>

        {/* Password form */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="animate-fade-in-up"
          style={{ animationDelay: '100ms' }}
        >
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(false)
              }}
              placeholder={t('login_placeholder')}
              autoComplete="current-password"
              className={`
                w-[280px] sm:w-[320px] h-[52px] px-5 pr-14
                bg-white/10 backdrop-blur-md
                border border-white/20 rounded-[var(--radius-lg)]
                text-white placeholder:text-white/40
                text-base tracking-wide
                transition-all duration-250 ease-out
                focus:outline-none focus:border-white/40 focus:bg-white/15
                ${error ? 'border-red-400/60 bg-red-500/10' : ''}
              `}
            />

            {/* Submit arrow button */}
            <button
              type="submit"
              disabled={loading || !password}
              className={`
                absolute right-2 w-9 h-9 flex items-center justify-center
                rounded-[var(--radius-md)]
                transition-all duration-200 ease-out
                ${password ? 'bg-white/20 hover:bg-white/30 text-white' : 'text-white/20'}
                disabled:cursor-not-allowed
              `}
            >
              {loading ? (
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
          </div>

          {/* Error text */}
          <div className={`mt-3 text-center text-sm text-red-300 transition-opacity duration-200 ${error ? 'opacity-100' : 'opacity-0'}`}>
            {t('login_error')}
          </div>
        </form>
      </div>
    </div>
  )
}
