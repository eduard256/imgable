import { useState, useCallback, useRef } from 'react'
import { api } from '../utils/api'
import type { Photo } from '../utils/api'

/**
 * Hook for loading photos with cursor-based pagination.
 * Manages loading state, deduplication, and prefetching.
 * Used by Gallery, Album view, Person view, etc.
 */
export function usePhotos(initialParams: Record<string, string> = {}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const cursorRef = useRef<string | undefined>()
  const paramsRef = useRef(initialParams)
  const loadingRef = useRef(false)

  const load = useCallback(async (reset = false) => {
    if (loadingRef.current) return
    if (!reset && !hasMore) return

    loadingRef.current = true
    setLoading(true)

    try {
      const params: Record<string, string> = {
        limit: '100',
        ...paramsRef.current,
      }

      if (!reset && cursorRef.current) {
        params.cursor = cursorRef.current
      }

      const data = await api.getPhotos(params)

      setPhotos((prev) => {
        if (reset) return data.photos
        // Deduplicate by ID in case of race conditions
        const existingIds = new Set(prev.map((p) => p.id))
        const newPhotos = data.photos.filter((p) => !existingIds.has(p.id))
        return [...prev, ...newPhotos]
      })

      cursorRef.current = data.next_cursor
      setHasMore(data.has_more)
    } catch (err) {
      console.error('Failed to load photos:', err)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [hasMore])

  const reload = useCallback((newParams?: Record<string, string>) => {
    if (newParams) {
      paramsRef.current = newParams
    }
    cursorRef.current = undefined
    setHasMore(true)
    setPhotos([])
    // Need to call load after state resets
    setTimeout(() => load(true), 0)
  }, [load])

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const updatePhoto = useCallback((id: string, updates: Partial<Photo>) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    )
  }, [])

  return { photos, loading, hasMore, load, reload, removePhoto, updatePhoto }
}
