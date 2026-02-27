import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from '../hooks/useTranslation'
import { usePhotos } from '../hooks/usePhotos'
import { api, Photo, Album, Person, PeopleGroup } from '../utils/api'
import MasonryGrid from '../components/MasonryGrid'
import PhotoViewer from '../components/PhotoViewer'
import SettingsPanel from '../components/SettingsPanel'
import { formatMonthYear, getMonthKey } from '../utils/format'

/**
 * Gallery — the one and only main page.
 *
 * Architecture: a single vertical scroll with two zones:
 * 1. TOP: masonry photo grid (scrolls up into the past)
 * 2. BOTTOM: discovery zone (people, albums, places, stats)
 *
 * The settings button is the only UI element besides photos.
 */

type Filter = 'all' | 'photo' | 'video' | 'favorite'
type Sort = 'date' | 'created'

export default function Gallery() {
  const { t, locale } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('date')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewerPhoto, setViewerPhoto] = useState<{ photo: Photo; index: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Discovery zone data
  const [people, setPeople] = useState<Person[]>([])
  const [groups, setGroups] = useState<PeopleGroup[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [stats, setStats] = useState<{ total_photos: number; storage: { human: string } } | null>(null)

  // Build query params from filter/sort
  const getParams = useCallback(() => {
    const params: Record<string, string> = { sort }
    if (filter === 'photo') params.type = 'photo'
    if (filter === 'video') params.type = 'video'
    if (filter === 'favorite') params.favorite = 'true'
    return params
  }, [filter, sort])

  const { photos, loading, hasMore, load, reload, removePhoto, updatePhoto } = usePhotos(getParams())

  // Initial load
  useEffect(() => {
    reload(getParams())
  }, [filter, sort])

  // Load discovery zone data
  useEffect(() => {
    api.getPeople(20, 0).then((d) => setPeople(d.people)).catch(() => {})
    api.getPeopleGroups(10, 0).then((d) => setGroups(d.groups)).catch(() => {})
    api.getAlbums().then((d) => setAlbums(d.albums)).catch(() => {})
    api.getStats().then((d) => setStats(d)).catch(() => {})
  }, [])

  const handlePhotoClick = useCallback((photo: Photo, index: number) => {
    setViewerPhoto({ photo, index })
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  // Navigate in viewer
  const handleViewerNav = useCallback(
    (direction: 'prev' | 'next') => {
      if (!viewerPhoto) return
      const newIndex = viewerPhoto.index + (direction === 'next' ? 1 : -1)
      if (newIndex >= 0 && newIndex < photos.length) {
        setViewerPhoto({ photo: photos[newIndex], index: newIndex })
      }
      // Prefetch more when near the end
      if (direction === 'next' && newIndex > photos.length - 10 && hasMore) {
        load()
      }
    },
    [viewerPhoto, photos, hasMore, load],
  )

  // Group photos by month for sticky headers
  const monthGroups = useGroupByMonth(photos, sort === 'date')

  return (
    <div className="min-h-[100dvh] bg-bg">
      {/* Filter bar — minimal, slides in */}
      <div className={`
        fixed top-0 left-0 right-0 z-30
        transition-all duration-300 ease-out
        ${showFilters ? 'translate-y-0' : '-translate-y-full'}
      `}>
        <div className="bg-bg/80 backdrop-blur-xl border-b border-border-light">
          <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
            {/* Filter chips */}
            {([
              ['all', t('all')],
              ['photo', t('photos_only')],
              ['video', t('videos_only')],
              ['favorite', t('favorites')],
            ] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`
                  px-4 py-1.5 rounded-[var(--radius-full)] text-sm font-medium whitespace-nowrap
                  transition-all duration-200 ease-out
                  ${filter === f
                    ? 'bg-accent text-white'
                    : 'bg-surface text-text-secondary hover:bg-surface-hover'
                  }
                `}
              >
                {label}
              </button>
            ))}

            <div className="w-px h-6 bg-border mx-1" />

            {/* Sort */}
            {([
              ['date', t('date_sort')],
              ['created', t('added_sort')],
            ] as [Sort, string][]).map(([s, label]) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`
                  px-4 py-1.5 rounded-[var(--radius-full)] text-sm font-medium whitespace-nowrap
                  transition-all duration-200 ease-out
                  ${sort === s
                    ? 'bg-accent text-white'
                    : 'bg-surface text-text-secondary hover:bg-surface-hover'
                  }
                `}
              >
                {label}
              </button>
            ))}

            <div className="flex-1" />

            {/* Select mode toggle */}
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className={`
                px-4 py-1.5 rounded-[var(--radius-full)] text-sm font-medium
                transition-all duration-200 ease-out
                ${selectMode
                  ? 'bg-accent text-white'
                  : 'bg-surface text-text-secondary hover:bg-surface-hover'
                }
              `}
            >
              {selectMode ? t('cancel') : t('select')}
            </button>
          </div>
        </div>
      </div>

      {/* Settings button — top right corner, always visible */}
      <button
        onClick={() => setSettingsOpen(true)}
        className="
          fixed top-4 right-4 z-40
          w-10 h-10 rounded-[var(--radius-full)]
          bg-bg/60 backdrop-blur-xl border border-border-light
          shadow-md
          flex items-center justify-center
          transition-all duration-200 ease-out
          hover:bg-surface hover:shadow-lg
          active:scale-95
        "
      >
        <svg className="w-5 h-5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>

      {/* Filter toggle — top left */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="
          fixed top-4 left-4 z-40
          w-10 h-10 rounded-[var(--radius-full)]
          bg-bg/60 backdrop-blur-xl border border-border-light
          shadow-md
          flex items-center justify-center
          transition-all duration-200 ease-out
          hover:bg-surface hover:shadow-lg
          active:scale-95
        "
      >
        <svg className="w-5 h-5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="8" x2="20" y2="8" />
          <line x1="6" y1="16" x2="18" y2="16" />
          <line x1="9" y1="12" x2="15" y2="12" />
        </svg>
      </button>

      {/* Select mode action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="
          fixed bottom-6 left-1/2 -translate-x-1/2 z-40
          bg-surface/90 backdrop-blur-xl border border-border
          rounded-[var(--radius-xl)] shadow-xl
          flex items-center gap-3 px-5 py-3
          animate-scale-in
        ">
          <span className="text-sm font-medium text-text-secondary">
            {selectedIds.size} {t('selected')}
          </span>
          <div className="w-px h-5 bg-border" />
          <button className="p-2 rounded-[var(--radius-md)] hover:bg-surface-hover transition-colors" title={t('add_to_album')}>
            <svg className="w-5 h-5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </button>
          <button className="p-2 rounded-[var(--radius-md)] hover:bg-surface-hover transition-colors" title={t('share')}>
            <svg className="w-5 h-5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16,6 12,2 8,6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
          <button className="p-2 rounded-[var(--radius-md)] hover:bg-red-500/10 transition-colors" title={t('delete')}>
            <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,6 5,6 21,6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      )}

      {/* === PHOTO GRID === */}
      <div className="pt-2">
        {monthGroups.map(({ key, label, photos: groupPhotos, startIndex }) => (
          <div key={key}>
            {/* Sticky month header */}
            {label && (
              <div className="sticky top-0 z-20 px-4 py-3 bg-bg/70 backdrop-blur-lg">
                <h2 className="text-lg font-light text-text-secondary tracking-wide capitalize">
                  {label}
                </h2>
              </div>
            )}
            <MasonryGrid
              photos={groupPhotos}
              onPhotoClick={(photo, idx) => handlePhotoClick(photo, startIndex + idx)}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
            />
          </div>
        ))}

        {/* Load more trigger for ungrouped */}
        {!monthGroups.length && (
          <MasonryGrid
            photos={photos}
            onPhotoClick={handlePhotoClick}
            onLoadMore={load}
            hasMore={hasMore}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        )}

        {/* Infinite scroll sentinel for grouped mode */}
        {monthGroups.length > 0 && hasMore && (
          <LoadMoreSentinel onLoadMore={load} />
        )}

        {/* Loading indicator */}
        {loading && photos.length === 0 && (
          <div className="flex items-center justify-center py-32">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && photos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <svg className="w-16 h-16 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <p className="text-text-tertiary text-lg font-light">{t('no_photos')}</p>
          </div>
        )}
      </div>

      {/* === DISCOVERY ZONE — bottom of the scroll === */}
      {photos.length > 0 && !hasMore && (
        <div className="mt-8 border-t border-border-light">
          {/* Stats banner */}
          {stats && (
            <div className="text-center py-12 px-4">
              <p className="text-3xl font-light text-text-secondary">
                {stats.total_photos.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US')}
              </p>
              <p className="text-sm text-text-tertiary mt-1">
                {t('memories')} &middot; {stats.storage.human}
              </p>
            </div>
          )}

          {/* People */}
          {people.length > 0 && (
            <div className="px-4 pb-8">
              <h3 className="text-sm font-medium text-text-tertiary tracking-wider uppercase mb-4">
                {t('people')}
              </h3>
              <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                {people.map((person) => (
                  <PersonBubble key={person.id} person={person} />
                ))}
              </div>
            </div>
          )}

          {/* Albums */}
          {albums.filter((a) => a.type !== 'favorites' || a.photo_count > 0).length > 0 && (
            <div className="px-4 pb-8">
              <h3 className="text-sm font-medium text-text-tertiary tracking-wider uppercase mb-4">
                {t('albums')}
              </h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {albums
                  .filter((a) => a.type !== 'favorites' || a.photo_count > 0)
                  .map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
              </div>
            </div>
          )}

          {/* Spacer at the very bottom */}
          <div className="h-8" />
        </div>
      )}

      {/* Photo viewer overlay */}
      {viewerPhoto && (
        <PhotoViewer
          photo={viewerPhoto.photo}
          allPhotos={photos}
          currentIndex={viewerPhoto.index}
          onClose={() => setViewerPhoto(null)}
          onNavigate={handleViewerNav}
          onFavoriteToggle={(id, fav) => updatePhoto(id, { is_favorite: fav })}
          onDelete={(id) => {
            removePhoto(id)
            setViewerPhoto(null)
          }}
        />
      )}

      {/* Settings panel */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/* ============================================================================
   Helper components
   ============================================================================ */

function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore()
      },
      { rootMargin: '1500px' },
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [onLoadMore])

  return <div ref={ref} className="h-1" />
}

function PersonBubble({ person }: { person: Person }) {
  const isNamed = person.name_source === 'manual'
  const displayName = isNamed ? person.name : '?'

  return (
    <div className="flex flex-col items-center gap-2 min-w-[72px] cursor-pointer group">
      <div className="w-16 h-16 rounded-full overflow-hidden bg-surface border-2 border-border-light group-hover:border-accent transition-colors duration-200">
        <img
          src={person.face_url}
          alt={displayName}
          className="w-full h-full object-cover"
          style={{
            objectPosition: `${(person.face_box.x + person.face_box.w / 2) * 100}% ${(person.face_box.y + person.face_box.h / 2) * 100}%`,
          }}
        />
      </div>
      <span className={`text-xs text-center truncate w-full ${isNamed ? 'text-text' : 'text-text-tertiary italic'}`}>
        {displayName}
      </span>
    </div>
  )
}

function AlbumCard({ album }: { album: Album }) {
  return (
    <div className="min-w-[160px] max-w-[200px] cursor-pointer group">
      <div className="aspect-[4/3] rounded-[var(--radius-md)] overflow-hidden bg-surface mb-2">
        {album.cover ? (
          <img
            src={album.cover}
            alt={album.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>
      <p className="text-sm font-medium text-text truncate">{album.name}</p>
      <p className="text-xs text-text-tertiary">{album.photo_count}</p>
    </div>
  )
}

/* ============================================================================
   Group photos by month for sticky headers
   ============================================================================ */

interface MonthGroup {
  key: string
  label: string | null
  photos: Photo[]
  startIndex: number
}

function useGroupByMonth(photos: Photo[], enabled: boolean): MonthGroup[] {
  if (!enabled || photos.length === 0) return []

  const groups: MonthGroup[] = []
  let currentKey = ''
  let currentGroup: MonthGroup | null = null

  photos.forEach((photo, index) => {
    const ts = photo.taken_at ?? 0
    const key = getMonthKey(ts)

    if (key !== currentKey) {
      currentKey = key
      currentGroup = {
        key: `${key}-${index}`,
        label: formatMonthYear(ts),
        photos: [],
        startIndex: index,
      }
      groups.push(currentGroup)
    }

    currentGroup!.photos.push(photo)
  })

  return groups
}
