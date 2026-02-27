// Authentication and API layer
// Token + password stored in localStorage for persistent session

const TOKEN_KEY = 'imgable_token'
const PASS_KEY = 'imgable_pass'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(PASS_KEY)
}

export function savePassword(password: string): void {
  localStorage.setItem(PASS_KEY, password)
}

export function getSavedPassword(): string | null {
  return localStorage.getItem(PASS_KEY)
}

export async function login(password: string): Promise<{ token: string; expires_at: number }> {
  const res = await fetch('/api/v1/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error('invalid_password')
  return res.json()
}

// Silent token refresh using saved password
async function refreshToken(): Promise<boolean> {
  const pass = getSavedPassword()
  if (!pass) return false
  try {
    const data = await login(pass)
    setToken(data.token)
    return true
  } catch {
    return false
  }
}

// Authenticated fetch with auto-refresh on 401
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res = await fetch(path, { ...options, headers })

  if (res.status === 401) {
    const refreshed = await refreshToken()
    if (refreshed) {
      headers.set('Authorization', `Bearer ${getToken()!}`)
      res = await fetch(path, { ...options, headers })
    }
  }

  return res
}
