// ============================================================
// MapPreview — Interactive map widget for the gallery bottom section
//
// Features:
//   - Background preload: MapLibre JS + CSS loaded on mount
//   - Lazy init: map instance created when container is visible
//   - Blur reveal animation on first load
//   - Server-side clustering via /api/v1/map/clusters
//   - Click cluster -> overlay photo gallery
//   - Click single photo -> overlay with that photo
//   - Positron (light) tile style from OpenFreeMap
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'
import 'maplibre-gl/dist/maplibre-gl.css'

// MapLibre types — imported dynamically but typed here for refs
import type { Map as MaplibreMap, Marker, NavigationControl as NavControl } from 'maplibre-gl'

// ---- Types ----

interface ClusterItem {
  lat: number
  lon: number
  count: number
  preview: string
  photo_id?: string
  bounds?: { n: number; s: number; e: number; w: number }
}

interface Photo {
  id: string
  type: 'photo' | 'video'
  small: string
  w: number
  h: number
  taken_at: number
  is_favorite: boolean
}

// ---- Singleton preloader ----
// Start loading MapLibre in background as soon as this module is imported.
// The map container does not need to exist yet.

let maplibrePromise: Promise<typeof import('maplibre-gl')> | null = null

function preloadMapLibre() {
  if (!maplibrePromise) {
    maplibrePromise = import('maplibre-gl')
  }
  return maplibrePromise
}

// Start preload immediately when module loads (after login, GalleryPage imports this)
preloadMapLibre()

// ---- Constants ----

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const DEBOUNCE_MS = 300

// ---- Helper: create marker DOM safely (no innerHTML) ----

function createMarkerElement(cluster: ClusterItem): HTMLDivElement {
  const el = document.createElement('div')

  const img = document.createElement('img')
  img.src = cluster.preview
  img.alt = ''

  if (cluster.count === 1) {
    el.className = 'map-marker-single'
    el.appendChild(img)
  } else {
    el.className = 'map-marker-cluster'
    el.appendChild(img)

    const countSpan = document.createElement('span')
    countSpan.className = 'map-marker-count'
    countSpan.textContent = cluster.count > 99 ? '99+' : String(cluster.count)
    el.appendChild(countSpan)
  }

  return el
}

// ---- Component ----

export default function MapPreview() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State
  const [loaded, setLoaded] = useState(false)
  const [totalPhotos, setTotalPhotos] = useState(0)
  const [galleryData, setGalleryData] = useState<{
    photos: Photo[]
    bounds: { n: number; s: number; e: number; w: number }
    count: number
    hasMore: boolean
    cursor: string | null
  } | null>(null)

  // Load clusters for current viewport
  const loadClusters = useCallback(async () => {
    const map = mapRef.current
    if (!map) return

    const bounds = map.getBounds()
    const zoom = Math.floor(map.getZoom())

    // Normalize coordinates
    const north = Math.min(Math.max(bounds.getNorth(), -90), 90)
    const south = Math.min(Math.max(bounds.getSouth(), -90), 90)
    let east = bounds.getEast()
    let west = bounds.getWest()

    // Wrap longitude
    while (east > 180) east -= 360
    while (east < -180) east += 360
    while (west > 180) west -= 360
    while (west < -180) west += 360

    if (bounds.getEast() - bounds.getWest() >= 360) {
      east = 180
      west = -180
    }

    try {
      const res = await apiFetch(
        `/api/v1/map/clusters?north=${north}&south=${south}&east=${east}&west=${west}&zoom=${zoom}`,
      )
      if (!res.ok) return
      const data: { clusters: ClusterItem[]; total: number } = await res.json()

      setTotalPhotos(data.total)

      // Diff-update markers
      const newKeys = new Map<string, ClusterItem>()
      for (const c of data.clusters) {
        const key = `${c.lat.toFixed(6)},${c.lon.toFixed(6)},${c.preview}`
        newKeys.set(key, c)
      }

      // Remove stale markers
      const toRemove: string[] = []
      for (const [key, marker] of markersRef.current) {
        if (!newKeys.has(key)) {
          marker.remove()
          toRemove.push(key)
        }
      }
      toRemove.forEach((k) => markersRef.current.delete(k))

      // Add new markers
      const maplibregl = await preloadMapLibre()
      for (const [key, cluster] of newKeys) {
        if (!markersRef.current.has(key)) {
          const el = createMarkerElement(cluster)

          el.addEventListener('click', (e) => {
            e.stopPropagation()
            handleMarkerClick(cluster)
          })

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([cluster.lon, cluster.lat])
            .addTo(map)

          markersRef.current.set(key, marker)
        }
      }
    } catch (err) {
      console.error('Failed to load map clusters:', err)
    }
  }, [])

  // Handle marker click
  function handleMarkerClick(cluster: ClusterItem) {
    if (cluster.photo_id) {
      // Single photo — open overlay with a tiny bounding box around the point
      openGalleryOverlay(
        {
          n: cluster.lat + 0.001,
          s: cluster.lat - 0.001,
          e: cluster.lon + 0.001,
          w: cluster.lon - 0.001,
        },
        1,
      )
    } else if (cluster.bounds) {
      openGalleryOverlay(cluster.bounds, cluster.count)
    }
  }

  // Open cluster gallery overlay
  async function openGalleryOverlay(
    bounds: { n: number; s: number; e: number; w: number },
    count: number,
  ) {
    try {
      const res = await apiFetch(
        `/api/v1/photos?north=${bounds.n}&south=${bounds.s}&east=${bounds.e}&west=${bounds.w}&limit=50`,
      )
      if (!res.ok) return
      const data = await res.json()

      setGalleryData({
        photos: data.photos,
        bounds,
        count,
        hasMore: data.has_more,
        cursor: data.next_cursor || null,
      })
    } catch (err) {
      console.error('Failed to load cluster photos:', err)
    }
  }

  // Load more photos in gallery overlay
  async function loadMoreGalleryPhotos() {
    if (!galleryData?.cursor) return

    try {
      const res = await apiFetch(
        `/api/v1/photos?north=${galleryData.bounds.n}&south=${galleryData.bounds.s}` +
          `&east=${galleryData.bounds.e}&west=${galleryData.bounds.w}` +
          `&limit=50&cursor=${galleryData.cursor}`,
      )
      if (!res.ok) return
      const data = await res.json()

      setGalleryData((prev) =>
        prev
          ? {
              ...prev,
              photos: [...prev.photos, ...data.photos],
              hasMore: data.has_more,
              cursor: data.next_cursor || null,
            }
          : null,
      )
    } catch (err) {
      console.error('Failed to load more cluster photos:', err)
    }
  }

  // Initialize map when container becomes visible
  const initMap = useCallback(async () => {
    if (mapRef.current || !containerRef.current) return

    const maplibregl = await preloadMapLibre()

    // Get initial bounds from API to center the map
    let center: [number, number] = [30, 50]
    const zoom = 4

    try {
      const boundsRes = await apiFetch('/api/v1/map/bounds')
      if (boundsRes.ok) {
        const boundsData = await boundsRes.json()
        if (boundsData.total > 0 && boundsData.bounds) {
          center = [
            (boundsData.bounds.e + boundsData.bounds.w) / 2,
            (boundsData.bounds.n + boundsData.bounds.s) / 2,
          ]
          setTotalPhotos(boundsData.total)
        }
      }
    } catch {
      /* use default center */
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center,
      zoom,
      maxZoom: 18,
      renderWorldCopies: false,
      attributionControl: false,
    })

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }) as NavControl,
      'top-right',
    )

    mapRef.current = map

    map.on('load', () => {
      setLoaded(true)
      loadClusters()
    })

    map.on('moveend', () => {
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current)
      moveTimeoutRef.current = setTimeout(loadClusters, DEBOUNCE_MS)
    })
  }, [loadClusters])

  // IntersectionObserver: init map when visible
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !mapRef.current) {
          initMap()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [initMap])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markersRef.current.clear()
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current)
    }
  }, [])

  return (
    <>
      {/* Map container with blur reveal */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '85vh',
          borderRadius: '24px',
          overflow: 'hidden',
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
        }}
      >
        {/* Actual MapLibre container */}
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            filter: loaded ? 'blur(0px)' : 'blur(20px)',
            opacity: loaded ? 1 : 0,
            transform: loaded ? 'scale(1)' : 'scale(1.05)',
            transition:
              'filter 0.8s ease-out, opacity 0.8s ease-out, transform 0.8s ease-out',
          }}
        />

        {/* Loading skeleton — visible until map tiles load */}
        {!loaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(135deg, #EDE5D8, #F5F0E8, #E8D5C4, #F5F0E8)',
              backgroundSize: '400% 400%',
              animation: 'mapShimmer 2s ease-in-out infinite',
            }}
          />
        )}

        {/* Photo count pill — bottom center, inside the map */}
        {loaded && totalPhotos > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(12px)',
              padding: '6px 16px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 400,
              color: '#3D2B1F',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            {totalPhotos.toLocaleString()} {t('photos_on_map')}
          </div>
        )}
      </div>

      {/* Cluster gallery overlay */}
      {galleryData && (
        <ClusterGalleryOverlay
          data={galleryData}
          onClose={() => setGalleryData(null)}
          onLoadMore={loadMoreGalleryPhotos}
        />
      )}
    </>
  )
}

// ---- Cluster Gallery Overlay ----

function ClusterGalleryOverlay({
  data,
  onClose,
  onLoadMore,
}: {
  data: {
    photos: Photo[]
    count: number
    hasMore: boolean
  }
  onClose: () => void
  onLoadMore: () => void
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: 'rgba(10, 7, 5, 0.95)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ padding: '16px 20px' }}
      >
        <span
          style={{
            color: 'rgba(255, 255, 255, 0.9)',
            fontSize: '16px',
            fontWeight: 400,
          }}
        >
          {data.count} {t('photos_in_area')}
        </span>
        <button
          onClick={onClose}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Photo grid */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: '0 16px 16px' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: '3px',
          }}
        >
          {data.photos.map((photo) => (
            <div
              key={photo.id}
              className="relative overflow-hidden cursor-pointer"
              style={{
                aspectRatio: '1',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
              }}
            >
              <img
                src={photo.small}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover transition-transform duration-200"
                style={{ display: 'block' }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.transform =
                    'scale(1.03)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
                }}
              />
              {photo.type === 'video' && (
                <div
                  className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded"
                  style={{
                    background: 'rgba(0, 0, 0, 0.6)',
                    fontSize: '10px',
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="white"
                    className="inline"
                  >
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Load more */}
        {data.hasMore && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <button
              onClick={onLoadMore}
              style={{
                padding: '8px 24px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: '13px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {t('load_more')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
