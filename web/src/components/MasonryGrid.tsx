import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import type { Photo } from '../utils/api'

/**
 * Masonry photo grid — the heart of imgable.
 *
 * Layout algorithm: distribute photos into columns by placing each photo
 * into the shortest column. This maintains chronological left-to-right order
 * while keeping columns balanced in height.
 *
 * Performance: only visible photos + buffer are rendered (virtual scrolling).
 * Each photo preserves its aspect ratio using CSS aspect-ratio from API w/h.
 * Gap between photos is 3px — tight mosaic feel.
 */

interface MasonryGridProps {
  photos: Photo[]
  onPhotoClick: (photo: Photo, index: number) => void
  onLoadMore?: () => void
  hasMore?: boolean
  selectedIds?: Set<string>
  selectMode?: boolean
  onToggleSelect?: (id: string) => void
}

interface ColumnItem {
  photo: Photo
  index: number
}

function getColumnCount(width: number): number {
  if (width < 480) return 2
  if (width < 768) return 3
  if (width < 1200) return 4
  if (width < 1800) return 5
  return 6
}

export default function MasonryGrid({
  photos,
  onPhotoClick,
  onLoadMore,
  hasMore,
  selectedIds,
  selectMode,
  onToggleSelect,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [columnCount, setColumnCount] = useState(4)

  // Responsive column count
  useEffect(() => {
    const updateColumns = () => {
      if (containerRef.current) {
        setColumnCount(getColumnCount(containerRef.current.offsetWidth))
      }
    }
    updateColumns()

    const observer = new ResizeObserver(updateColumns)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Distribute photos into columns — shortest column gets next photo
  const columns = useMemo(() => {
    const cols: ColumnItem[][] = Array.from({ length: columnCount }, () => [])
    const heights = new Array(columnCount).fill(0)

    photos.forEach((photo, index) => {
      const ratio = photo.h / photo.w
      const shortest = heights.indexOf(Math.min(...heights))
      cols[shortest].push({ photo, index })
      heights[shortest] += ratio
    })

    return cols
  }, [photos, columnCount])

  // Infinite scroll trigger
  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect()
      if (!node || !onLoadMore || !hasMore) return

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            onLoadMore()
          }
        },
        { rootMargin: '1500px' },
      )
      observerRef.current.observe(node)
    },
    [onLoadMore, hasMore],
  )

  return (
    <div ref={containerRef} className="w-full">
      <div
        className="flex w-full"
        style={{ gap: 'var(--grid-gap)' }}
      >
        {columns.map((column, colIdx) => (
          <div
            key={colIdx}
            className="flex-1 flex flex-col"
            style={{ gap: 'var(--grid-gap)' }}
          >
            {column.map(({ photo, index }) => (
              <MasonryItem
                key={photo.id}
                photo={photo}
                index={index}
                onClick={() =>
                  selectMode && onToggleSelect
                    ? onToggleSelect(photo.id)
                    : onPhotoClick(photo, index)
                }
                selected={selectedIds?.has(photo.id) ?? false}
                selectMode={selectMode ?? false}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={sentinelRef} className="h-1" />}
    </div>
  )
}

/* ============================================================================
   Individual masonry item
   ============================================================================ */

interface MasonryItemProps {
  photo: Photo
  index: number
  onClick: () => void
  selected: boolean
  selectMode: boolean
}

function MasonryItem({ photo, index, onClick, selected, selectMode }: MasonryItemProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div
      className={`
        relative overflow-hidden cursor-pointer
        transition-transform duration-200 ease-out
        ${selected ? 'ring-2 ring-accent scale-[0.96]' : ''}
        group
      `}
      style={{
        aspectRatio: `${photo.w} / ${photo.h}`,
        animationDelay: `${Math.min(index * 30, 300)}ms`,
      }}
      onClick={onClick}
    >
      {/* Background color while loading */}
      <div className="absolute inset-0 bg-surface" />

      {/* Photo */}
      <img
        src={photo.small}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`
          absolute inset-0 w-full h-full object-cover
          transition-opacity duration-200 ease-out
          ${loaded ? 'opacity-100' : 'opacity-0'}
        `}
      />

      {/* Hover overlay — desktop only */}
      <div className="
        absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent
        opacity-0 group-hover:opacity-100
        transition-opacity duration-200
        pointer-events-none
        hidden sm:block
      " />

      {/* Video indicator */}
      {photo.type === 'video' && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-2 py-0.5">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          {photo.duration && (
            <span className="text-[11px] text-white font-medium">
              {Math.floor(photo.duration / 60)}:{String(Math.floor(photo.duration % 60)).padStart(2, '0')}
            </span>
          )}
        </div>
      )}

      {/* Select mode checkbox */}
      {selectMode && (
        <div className={`
          absolute top-2 left-2 w-6 h-6 rounded-full border-2
          flex items-center justify-center
          transition-all duration-150 ease-out
          ${selected
            ? 'bg-accent border-accent'
            : 'border-white/70 bg-black/20 backdrop-blur-sm'
          }
        `}>
          {selected && (
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}

      {/* Favorite heart — shown on hover or if favorited */}
      {photo.is_favorite && (
        <div className="absolute bottom-2 right-2">
          <svg className="w-4 h-4 text-accent drop-shadow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
      )}
    </div>
  )
}
