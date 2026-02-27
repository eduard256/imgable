import { getToken, getPassword, login, logout } from './store'

/* ============================================================================
   API client with automatic token refresh.
   If a request gets 401, silently re-login using stored password
   and retry the original request. User never sees a login screen again.
   ============================================================================ */

const API_BASE = '/api/v1'

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function refreshToken(): Promise<boolean> {
  const password = getPassword()
  if (!password) return false

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) return false
    const data = await res.json()
    login(data.token, password)
    return true
  } catch {
    return false
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  if (res.status === 401 && retry) {
    const refreshed = await refreshToken()
    if (refreshed) {
      return request<T>(path, options, false)
    }
    logout()
    throw new ApiError('Unauthorized', 401)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new ApiError(text, res.status)
  }

  if (res.status === 204) return undefined as T

  return res.json()
}

/* ============================================================================
   Public API methods
   ============================================================================ */

export const api = {
  /* Auth */
  login: (password: string) =>
    request<{ token: string; expires_at: number }>('/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  /* Photos */
  getPhotos: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString()
    return request<{
      photos: Photo[]
      next_cursor?: string
      has_more: boolean
    }>(`/photos?${query}`)
  },

  getPhoto: (id: string) => request<PhotoDetail>(`/photos/${id}`),

  deletePhoto: (id: string) =>
    request(`/photos/${id}`, { method: 'DELETE' }),

  deletePhotos: (ids: string[]) =>
    request('/photos', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),

  updatePhoto: (id: string, data: { comment?: string }) =>
    request(`/photos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  addFavorite: (id: string) =>
    request(`/photos/${id}/favorite`, { method: 'POST' }),

  removeFavorite: (id: string) =>
    request(`/photos/${id}/favorite`, { method: 'DELETE' }),

  /* Albums */
  getAlbums: () => request<{ albums: Album[] }>('/albums'),

  getAlbum: (id: string) =>
    request<{ album: Album; photos: Photo[]; next_cursor?: string; has_more: boolean }>(`/albums/${id}`),

  createAlbum: (name: string) =>
    request<Album>('/albums', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  updateAlbum: (id: string, data: { name?: string; description?: string | null; cover_photo_id?: string }) =>
    request(`/albums/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAlbum: (id: string) =>
    request(`/albums/${id}`, { method: 'DELETE' }),

  addPhotosToAlbum: (albumId: string, photoIds: string[]) =>
    request(`/albums/${albumId}/photos`, {
      method: 'POST',
      body: JSON.stringify({ photo_ids: photoIds }),
    }),

  removePhotoFromAlbum: (albumId: string, photoId: string) =>
    request(`/albums/${albumId}/photos/${photoId}`, { method: 'DELETE' }),

  removePhotosFromAlbum: (albumId: string, photoIds: string[]) =>
    request(`/albums/${albumId}/photos`, {
      method: 'DELETE',
      body: JSON.stringify({ photo_ids: photoIds }),
    }),

  /* People */
  getPeople: (limit: number, offset: number) =>
    request<{ people: Person[]; total: number; has_more: boolean }>(
      `/people?limit=${limit}&offset=${offset}`,
    ),

  getPeopleGroups: (limit: number, offset: number) =>
    request<{ groups: PeopleGroup[]; total: number; has_more: boolean }>(
      `/people/groups?limit=${limit}&offset=${offset}`,
    ),

  getPerson: (id: string) => request<PersonDetail>(`/people/${id}`),

  getPersonPhotos: (id: string, params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString()
    return request<{ photos: Photo[]; next_cursor?: string; has_more: boolean }>(
      `/people/${id}/photos?${query}`,
    )
  },

  getPersonHiddenPhotos: (id: string, params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString()
    return request<{ photos: Photo[]; has_more: boolean }>(
      `/people/${id}/photos/hidden?${query}`,
    )
  },

  getPersonFaces: (id: string) =>
    request<{ faces: Face[] }>(`/people/${id}/faces`),

  updatePerson: (id: string, data: { name: string }) =>
    request(`/people/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  mergePeople: (sourceIds: string[], targetId: string) =>
    request('/people/merge', {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds, target_id: targetId }),
    }),

  deletePerson: (id: string) =>
    request(`/people/${id}`, { method: 'DELETE' }),

  detachFace: (personId: string, faceId: string) =>
    request(`/people/${personId}/faces/${faceId}`, { method: 'DELETE' }),

  getGroupPhotos: (ids: string[], params: Record<string, string>) => {
    const query = new URLSearchParams({ ...params, ids: ids.join(',') }).toString()
    return request<{ photos: Photo[]; next_cursor?: string; has_more: boolean }>(
      `/people/groups/photos?${query}`,
    )
  },

  getGroupHiddenPhotos: (ids: string[], params: Record<string, string>) => {
    const query = new URLSearchParams({ ...params, ids: ids.join(',') }).toString()
    return request<{ photos: Photo[]; has_more: boolean }>(
      `/people/groups/photos/hidden?${query}`,
    )
  },

  /* Map */
  getMapBounds: () =>
    request<{ bounds: MapBounds; total: number }>('/map/bounds'),

  getMapClusters: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString()
    return request<{ clusters: MapCluster[] }>(`/map/clusters?${query}`)
  },

  /* Shares */
  getShares: () => request<{ shares: Share[] }>('/shares'),

  createShare: (data: {
    type: 'photo' | 'album'
    photo_id?: string
    album_id?: string
    password?: string
    expires_days?: number
  }) =>
    request<Share>('/shares', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteShare: (id: string) =>
    request(`/shares/${id}`, { method: 'DELETE' }),

  /* Stats */
  getStats: () => request<Stats>('/stats'),

  /* Sync */
  getScannerStatus: () => request<ScannerStatus>('/sync/scanner/status'),
  getProcessorStatus: () => request<ProcessorStatus>('/sync/processor/status'),
  getPlacesStatus: () => request<PlacesStatus>('/sync/places/api/v1/status'),
  getAiStatus: () => request<AiStatus>('/sync/ai/api/v1/status'),

  triggerRescan: () => request('/sync/scanner/rescan', { method: 'POST' }),
  pauseProcessor: () => request('/sync/processor/pause', { method: 'POST' }),
  resumeProcessor: () => request('/sync/processor/resume', { method: 'POST' }),
  runPlaces: () => request('/sync/places/api/v1/run', { method: 'POST' }),
  runAi: () => request('/sync/ai/api/v1/run', { method: 'POST' }),
  stopAi: () => request('/sync/ai/api/v1/stop', { method: 'POST' }),

  /* Upload */
  upload: (file: File, token: string, onProgress?: (pct: number) => void): { promise: Promise<unknown>; abort: () => void } => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)

    const promise = new Promise((resolve, reject) => {
      xhr.open('POST', `${API_BASE}/upload`)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.onabort = () => reject(new Error('Upload cancelled'))
      xhr.send(formData)
    })

    return { promise, abort: () => xhr.abort() }
  },
}

/* ============================================================================
   Type definitions
   ============================================================================ */

export interface Photo {
  id: string
  type: 'photo' | 'video'
  blurhash?: string
  small: string
  w: number
  h: number
  taken_at?: number
  is_favorite: boolean
  duration?: number
}

export interface PhotoDetail {
  id: string
  type: 'photo' | 'video'
  blurhash?: string
  urls: {
    small: string
    large: string
    video?: string
  }
  width: number
  height: number
  size_bytes: number
  taken_at?: number
  created_at: number
  is_favorite: boolean
  original_filename: string
  comment?: string
  place?: string
  duration?: number
  exif?: {
    camera_make?: string
    camera_model?: string
    iso?: number
    aperture?: number
    shutter_speed?: string
    focal_length?: number
    flash?: boolean
  }
}

export interface Album {
  id: string
  type: 'manual' | 'favorites' | 'place'
  name: string
  photo_count: number
  cover?: string
  description?: string
  created_at: number
  updated_at: number
}

export interface Person {
  id: string
  name: string
  name_source: string
  photo_count: number
  face_url: string
  face_box: { x: number; y: number; w: number; h: number }
}

export interface PersonDetail extends Person {
  faces_count: number
  created_at: number
  updated_at: number
}

export interface PeopleGroup {
  person_ids: string[]
  names: string[]
  photo_count: number
  face_urls: string[]
}

export interface Face {
  id: string
  photo_count: number
  preview_url: string
  preview_box: { x: number; y: number; w: number; h: number }
}

export interface MapBounds {
  n: number
  s: number
  e: number
  w: number
}

export interface MapCluster {
  lat: number
  lon: number
  count: number
  preview: string
  bounds: MapBounds
  photo_id?: string
}

export interface Share {
  id: string
  type: 'photo' | 'album'
  photo_id?: string
  album_id?: string
  code: string
  url: string
  has_password: boolean
  view_count: number
  created_at: number
  expires_at?: number
}

export interface Stats {
  total_photos: number
  total_videos: number
  total_albums: number
  total_places: number
  total_favorites: number
  storage: { bytes: number; human: string }
  dates: { oldest: number; newest: number }
}

export interface ScannerStatus {
  status: string
  uptime_seconds: number
  watcher: {
    running: boolean
    watched_dirs: number
    files_discovered: number
    files_queued: number
    pending_files_count: number
  }
  queue: { name: string; pending: number; active: number }[]
}

export interface ProcessorStatus {
  status: string
  paused: boolean
  workers: { total: number; active: number; idle: number }
  queue: { pending: number; processing: number; completed_total: number; failed_total: number }
  resources: { memory_used_mb: number }
}

export interface PlacesStatus {
  status: string
  pending_count: number
  last_run?: {
    started_at: string
    completed_at: string
    photos_processed: number
    places_created: number
    nominatim_requests: number
    errors: number
  }
}

export interface AiStatus {
  status: string
  current_photo: string | null
  queue: { pending: number; processing: number; done: number; error: number }
  estimated_time_seconds: number
  last_run?: {
    started_at: string
    completed_at: string
    photos_processed: number
    faces_detected: number
    persons_created: number
    tags_assigned: number
    errors: number
  }
}

export { ApiError }
