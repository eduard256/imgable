/**
 * Format unix timestamp to human-readable date string.
 * Uses Russian locale by default, English as fallback.
 */
export function formatDate(ts: number, locale = 'ru'): string {
  const date = new Date(ts * 1000)
  return date.toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Format unix timestamp to short month + year for section headers.
 */
export function formatMonthYear(ts: number, locale = 'ru'): string {
  const date = new Date(ts * 1000)
  return date.toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Get month key (YYYY-MM) from unix timestamp for grouping.
 */
export function getMonthKey(ts: number): string {
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Format video duration from seconds to M:SS.
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Format file size in bytes to human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Truncate filename preserving extension.
 */
export function truncateFilename(name: string, maxLen = 40): string {
  if (name.length <= maxLen) return name
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx === -1) return name.slice(0, maxLen - 3) + '...'
  const ext = name.slice(dotIdx)
  const base = name.slice(0, maxLen - ext.length - 3)
  return base + '...' + ext
}
