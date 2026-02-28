import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import type { RefObject } from 'react'

// ============================================================
// useDragSelect — reusable drag-select hook for photo grids
//
// Encapsulates all drag-select logic: long-press entry, pointer
// tracking, range computation, auto-scroll near edges, and
// CSS class sync for instant visual feedback without re-renders.
//
// Each photo element in the grid MUST have a `data-photo-id`
// attribute for hit-testing to work.
// ============================================================

interface UseDragSelectOptions {
  /** Array of photo objects — only `id` field is used for range computation */
  photos: { id: string }[]
  /** Scroll container ref — used for auto-scroll near edges */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Grid container ref — used for CSS class sync and hit-testing */
  gridRef: RefObject<HTMLDivElement | null>
}

interface UseDragSelectReturn {
  /** Whether select mode is active */
  selectMode: boolean
  /** Set select mode manually (e.g. from a toggle button) */
  setSelectMode: (mode: boolean) => void
  /** Set of currently selected photo IDs */
  selectedIds: Set<string>
  /** Live count of selected photos (updates during drag without re-render) */
  liveCount: number
  /** Exit select mode — clears all state and CSS classes */
  exitSelectMode: () => void
  /** Toggle a single photo's selection state (for tap behavior) */
  togglePhotoSelection: (id: string) => void
  /** Pointer event handlers to attach to the grid container */
  pointerHandlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: () => void
  }
  /** Refs needed for manual select mode entry from outside the hook */
  selectBaseSet: React.MutableRefObject<Set<string>>
  selectLiveSet: React.MutableRefObject<Set<string>>
  /** Whether a long press just triggered select mode (used to suppress click events) */
  longPressTriggered: React.MutableRefObject<boolean>
}

export function useDragSelect({ photos, scrollRef, gridRef }: UseDragSelectOptions): UseDragSelectReturn {
  // React state — triggers re-renders
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [liveCount, setLiveCount] = useState(0)

  // Refs for drag state — kept outside React state for performance during
  // drag/auto-scroll. Only flushed to selectedIds via flushSelection().
  // Anchor/current stored as photo IDs (stable across array changes).
  const selectDragActive = useRef(false)
  const selectDragPending = useRef(false)
  const selectDragAnchorId = useRef<string | null>(null)
  const selectDragCurrentId = useRef<string | null>(null)
  const selectBaseSet = useRef<Set<string>>(new Set())
  const selectLiveSet = useRef<Set<string>>(new Set())
  const autoScrollRaf = useRef(0)
  const autoScrollSpeed = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)
  const lastPointerPos = useRef({ x: 0, y: 0 })
  const pointerDownPos = useRef({ x: 0, y: 0 })

  // Photo ID to array index lookup (refreshed when photos change)
  const idToIdx = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < photos.length; i++) map.set(photos[i].id, i)
    return map
  }, [photos])

  // Compute the set of IDs in a range between two photo IDs using array indices
  const computeRangeByIds = useCallback((anchorId: string, currentId: string): Set<string> => {
    const a = idToIdx.get(anchorId)
    const b = idToIdx.get(currentId)
    if (a === undefined || b === undefined) return new Set()
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const ids = new Set<string>()
    for (let i = lo; i <= hi; i++) ids.add(photos[i].id)
    return ids
  }, [idToIdx, photos])

  // Flush live selection set into React state for re-render
  const flushSelection = useCallback(() => {
    setSelectedIds(new Set(selectLiveSet.current))
  }, [])

  // Find the photo ID under a screen coordinate via DOM hit-test
  const photoIdAtPoint = useCallback((x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null
    const photoEl = el.closest('[data-photo-id]') as HTMLElement | null
    if (!photoEl) return null
    return photoEl.dataset.photoId ?? null
  }, [])

  // Update drag range: accumulate into live set (drag only adds, never removes)
  const updateDragRange = useCallback((currentId: string) => {
    if (!selectDragAnchorId.current) return
    selectDragCurrentId.current = currentId
    const rangeIds = computeRangeByIds(selectDragAnchorId.current, currentId)
    const prevSize = selectLiveSet.current.size
    for (const id of rangeIds) selectLiveSet.current.add(id)

    // Update live counter only when count actually changed
    if (selectLiveSet.current.size !== prevSize) {
      setLiveCount(selectLiveSet.current.size)
    }

    // Apply CSS classes directly for instant visual feedback without re-render
    const grid = gridRef.current
    if (!grid) return
    const items = grid.querySelectorAll('[data-photo-id]') as NodeListOf<HTMLElement>
    for (const item of items) {
      const id = item.dataset.photoId!
      if (selectLiveSet.current.has(id)) {
        item.classList.add('photo-selected')
      }
    }
  }, [computeRangeByIds, gridRef])

  // Auto-scroll loop: runs via rAF while drag is near screen edge
  const autoScrollLoop = useCallback(() => {
    if (!selectDragActive.current || autoScrollSpeed.current === 0) {
      autoScrollRaf.current = 0
      return
    }
    const el = scrollRef.current
    if (el) {
      el.scrollTop += autoScrollSpeed.current
      // Re-hit-test at last known pointer position after scroll
      const id = photoIdAtPoint(lastPointerPos.current.x, lastPointerPos.current.y)
      if (id) updateDragRange(id)
    }
    autoScrollRaf.current = requestAnimationFrame(autoScrollLoop)
  }, [photoIdAtPoint, updateDragRange, scrollRef])

  // Start auto-scroll in a direction (negative = up, positive = down)
  const startAutoScroll = useCallback((speed: number) => {
    autoScrollSpeed.current = speed
    if (!autoScrollRaf.current && speed !== 0) {
      autoScrollRaf.current = requestAnimationFrame(autoScrollLoop)
    }
  }, [autoScrollLoop])

  const stopAutoScroll = useCallback(() => {
    autoScrollSpeed.current = 0
    if (autoScrollRaf.current) {
      cancelAnimationFrame(autoScrollRaf.current)
      autoScrollRaf.current = 0
    }
  }, [])

  // Compute auto-scroll speed from pointer Y position.
  // Edge zones: top 60px and bottom 60px of the scroll container.
  const computeAutoScrollSpeed = useCallback((clientY: number) => {
    const el = scrollRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const edgeZone = 60
    const topDist = clientY - rect.top
    const bottomDist = rect.bottom - clientY

    if (topDist < edgeZone) {
      const ratio = 1 - topDist / edgeZone
      return -(6 + ratio * 42)
    }
    if (bottomDist < edgeZone) {
      const ratio = 1 - bottomDist / edgeZone
      return 6 + ratio * 42
    }
    return 0
  }, [scrollRef])

  // Cancel long press timer without side effects
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Enter select mode with an initial photo selected
  const enterSelectMode = useCallback((photoId: string) => {
    setSelectMode(true)
    const initial = new Set<string>([photoId])
    selectBaseSet.current = initial
    selectLiveSet.current = initial
    setSelectedIds(initial)

    // Apply CSS immediately
    const grid = gridRef.current
    if (grid) {
      const el = grid.querySelector(`[data-photo-id="${photoId}"]`) as HTMLElement | null
      if (el) el.classList.add('photo-selected')
    }
  }, [gridRef])

  // Exit select mode — clear everything
  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
    selectBaseSet.current = new Set()
    selectLiveSet.current = new Set()
    selectDragActive.current = false
    selectDragAnchorId.current = null
    selectDragCurrentId.current = null
    stopAutoScroll()

    // Remove CSS classes from all items
    const grid = gridRef.current
    if (grid) {
      const items = grid.querySelectorAll('.photo-selected') as NodeListOf<HTMLElement>
      for (const item of items) item.classList.remove('photo-selected')
    }
  }, [stopAutoScroll, gridRef])

  // Toggle single photo in select mode (tap behavior)
  const togglePhotoSelection = useCallback((photoId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      selectBaseSet.current = next
      selectLiveSet.current = next
      return next
    })
  }, [])

  // ============================================================
  // Pointer event handlers
  // ============================================================

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary) return
    if (e.pointerType === 'touch' && e.isPrimary === false) return

    lastPointerPos.current = { x: e.clientX, y: e.clientY }
    longPressTriggered.current = false
    pointerDownPos.current = { x: e.clientX, y: e.clientY }

    const id = photoIdAtPoint(e.clientX, e.clientY)

    if (selectMode) {
      // Already in select mode — wait for movement before starting drag
      if (id) {
        selectDragPending.current = true
        selectDragAnchorId.current = id
        selectDragCurrentId.current = id
        selectBaseSet.current = new Set(selectedIds)
        selectLiveSet.current = new Set(selectedIds)
      }
    } else {
      // Not in select mode — start long press timer
      if (id) {
        const capturedId = id
        longPressTimer.current = setTimeout(() => {
          longPressTriggered.current = true
          enterSelectMode(capturedId)
          selectDragActive.current = true
          selectDragAnchorId.current = capturedId
          selectDragCurrentId.current = capturedId
          if (navigator.vibrate) navigator.vibrate(30)
        }, 400)
      }
    }
  }, [selectMode, selectedIds, photoIdAtPoint, enterSelectMode])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary) return
    const dx = e.clientX - lastPointerPos.current.x
    const dy = e.clientY - lastPointerPos.current.y

    // Cancel long press if finger moved too far (> 10px)
    if (longPressTimer.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      cancelLongPress()
    }

    lastPointerPos.current = { x: e.clientX, y: e.clientY }

    // Promote pending drag to active drag once pointer moves beyond threshold (8px)
    if (selectDragPending.current && !selectDragActive.current) {
      const totalDx = e.clientX - pointerDownPos.current.x
      const totalDy = e.clientY - pointerDownPos.current.y
      if (Math.abs(totalDx) > 8 || Math.abs(totalDy) > 8) {
        selectDragActive.current = true
        selectDragPending.current = false
        if (selectDragAnchorId.current) updateDragRange(selectDragAnchorId.current)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      }
    }

    if (!selectDragActive.current) return

    // Hit-test photo under pointer
    const id = photoIdAtPoint(e.clientX, e.clientY)
    if (id) updateDragRange(id)

    // Auto-scroll near edges
    const speed = computeAutoScrollSpeed(e.clientY)
    if (speed !== 0) {
      startAutoScroll(speed)
    } else {
      stopAutoScroll()
    }
  }, [photoIdAtPoint, updateDragRange, computeAutoScrollSpeed, startAutoScroll, stopAutoScroll, cancelLongPress])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!e.isPrimary) return
    cancelLongPress()
    stopAutoScroll()

    const wasDragActive = selectDragActive.current
    const wasDragPending = selectDragPending.current
    selectDragActive.current = false
    selectDragPending.current = false

    if (wasDragActive) {
      // End drag — commit live set to state
      flushSelection()
      return
    }

    // If long press was triggered, the pointerUp just ends the gesture
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }

    // Simple tap in select mode (pending drag that never moved) — toggle selection
    if (selectMode && wasDragPending) {
      const id = photoIdAtPoint(e.clientX, e.clientY)
      if (id) togglePhotoSelection(id)
    }
  }, [selectMode, photoIdAtPoint, togglePhotoSelection, flushSelection, cancelLongPress, stopAutoScroll])

  const handlePointerCancel = useCallback(() => {
    cancelLongPress()
    stopAutoScroll()
    selectDragPending.current = false
    if (selectDragActive.current) {
      selectDragActive.current = false
      flushSelection()
    }
  }, [cancelLongPress, stopAutoScroll, flushSelection])

  // Keep live counter in sync with selectedIds state changes (tap toggle, flush, exit)
  useEffect(() => {
    setLiveCount(selectedIds.size)
  }, [selectedIds])

  // Sync CSS classes when selectedIds state changes (e.g. after toggle via tap)
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const items = grid.querySelectorAll('[data-photo-id]') as NodeListOf<HTMLElement>
    for (const item of items) {
      const id = item.dataset.photoId!
      if (selectedIds.has(id)) {
        item.classList.add('photo-selected')
      } else {
        item.classList.remove('photo-selected')
      }
    }
  }, [selectedIds, gridRef])

  // Cleanup auto-scroll on unmount
  useEffect(() => {
    return () => {
      stopAutoScroll()
      cancelLongPress()
    }
  }, [stopAutoScroll, cancelLongPress])

  return {
    selectMode,
    setSelectMode,
    selectedIds,
    liveCount,
    exitSelectMode,
    togglePhotoSelection,
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
    selectBaseSet,
    selectLiveSet,
    longPressTriggered,
  }
}
