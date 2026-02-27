import { useSyncExternalStore, useCallback } from 'react'

/* ============================================================================
   Minimal global store — no dependencies, ~60 lines.
   Replaces Zustand/Redux for our simple needs.
   ============================================================================ */

interface AppState {
  token: string | null
  password: string | null
  locale: string
  theme: 'light' | 'dark'
}

type Listener = () => void

let state: AppState = {
  token: localStorage.getItem('imgable_token'),
  password: localStorage.getItem('imgable_password'),
  locale: localStorage.getItem('imgable_locale') || 'ru',
  theme: (localStorage.getItem('imgable_theme') as 'light' | 'dark') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
}

const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((l) => l())
}

function setState(partial: Partial<AppState>) {
  state = { ...state, ...partial }
  notify()
}

function getState(): AppState {
  return state
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * React hook to read from the global store.
 * Accepts a selector to pick a slice of state — component only re-renders
 * when that slice changes (referential equality).
 */
export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => selector(getState()), [selector]),
  )
}

/* ============================================================================
   Actions
   ============================================================================ */

export function login(token: string, password: string) {
  localStorage.setItem('imgable_token', token)
  localStorage.setItem('imgable_password', password)
  setState({ token, password })
}

export function logout() {
  localStorage.removeItem('imgable_token')
  localStorage.removeItem('imgable_password')
  setState({ token: null, password: null })
}

export function setLocale(locale: string) {
  localStorage.setItem('imgable_locale', locale)
  setState({ locale })
}

export function setTheme(theme: 'light' | 'dark') {
  localStorage.setItem('imgable_theme', theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  // Update meta theme-color for mobile browser chrome
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#13100D' : '#FBF5EE')
  }
  setState({ theme })
}

export function getToken(): string | null {
  return getState().token
}

export function getPassword(): string | null {
  return getState().password
}

/* Initialize theme on load */
document.documentElement.classList.toggle('dark', state.theme === 'dark')
