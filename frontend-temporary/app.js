// Imgable Frontend - Vanilla JS
const API_BASE = `http://${location.hostname}:9812`;
let token = localStorage.getItem('token');
let currentPhotos = [];
let currentPhotoIndex = 0;

// Infinite scroll state
let isLoadingMore = false;
let hasMorePhotos = false;
let nextCursor = null;
let currentLoadContext = null; // 'gallery' or 'album:id'

// API Client
const api = {
    async request(method, path, body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(API_BASE + path, opts);
        const data = await res.json();

        if (res.status === 401) {
            localStorage.removeItem('token');
            token = null;
            router.navigate('/login');
            throw new Error('Unauthorized');
        }

        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    },

    get(path) { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    patch(path, body) { return this.request('PATCH', path, body); },
    delete(path, body) { return this.request('DELETE', path, body); },

    async login(password) {
        const data = await this.post('/api/v1/login', { password });
        token = data.token;
        localStorage.setItem('token', token);
        return data;
    },

    logout() {
        token = null;
        localStorage.removeItem('token');
        router.navigate('/login');
    }
};

// Simple Router
const router = {
    routes: {},

    add(path, handler) {
        this.routes[path] = handler;
    },

    navigate(path) {
        history.pushState(null, '', path);
        this.resolve();
    },

    resolve() {
        const path = location.pathname;

        // Check auth for protected routes
        if (!token && !path.startsWith('/s/') && path !== '/login') {
            this.navigate('/login');
            return;
        }

        // Try exact match first
        if (this.routes[path]) {
            this.routes[path]();
            return;
        }

        // Try pattern matching
        for (const [pattern, handler] of Object.entries(this.routes)) {
            const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
            const match = path.match(regex);
            if (match) {
                handler(...match.slice(1));
                return;
            }
        }

        // Default to gallery if logged in
        if (token) {
            this.navigate('/');
        }
    }
};

// Utility functions
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function html(el, content) { el.innerHTML = content; }
function formatDate(ts) {
    if (!ts) return 'Unknown';
    return new Date(ts * 1000).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}
function formatDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(1) + ' ' + units[i];
}

// Infinite scroll setup
function setupInfiniteScroll() {
    let ticking = false;

    const checkScroll = () => {
        if (isLoadingMore || !hasMorePhotos || !nextCursor) return;

        const scrollY = window.scrollY;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;

        // Start loading when user is within 1500px of bottom (about 2-3 screen heights ahead)
        // This ensures content loads well before user reaches the end
        const threshold = 1500;
        const distanceFromBottom = documentHeight - (scrollY + windowHeight);

        if (distanceFromBottom < threshold) {
            loadMorePhotos();
        }
    };

    window.removeEventListener('scroll', window._infiniteScrollHandler);
    window._infiniteScrollHandler = () => {
        if (!ticking) {
            // Use requestAnimationFrame for smooth performance during fast scrolling
            requestAnimationFrame(() => {
                checkScroll();
                ticking = false;
            });
            ticking = true;
        }
    };
    window.addEventListener('scroll', window._infiniteScrollHandler, { passive: true });

    // Also check on resize
    window.removeEventListener('resize', window._infiniteScrollResizeHandler);
    window._infiniteScrollResizeHandler = checkScroll;
    window.addEventListener('resize', window._infiniteScrollResizeHandler, { passive: true });
}

async function loadMorePhotos() {
    if (isLoadingMore || !hasMorePhotos || !nextCursor) return;

    const grid = $('#photo-grid');
    if (!grid) return; // Guard against null grid (page changed)

    isLoadingMore = true;

    // Show loading indicator
    const loadingEl = document.createElement('div');
    loadingEl.className = 'load-more loading-indicator';
    loadingEl.innerHTML = '<span>Loading...</span>';
    grid.appendChild(loadingEl);

    try {
        if (currentLoadContext === 'gallery') {
            await appendGalleryPhotos();
        } else if (currentLoadContext?.startsWith('album:')) {
            const albumId = currentLoadContext.split(':')[1];
            await appendAlbumPhotos(albumId);
        } else if (currentLoadContext?.startsWith('place:')) {
            const placeId = currentLoadContext.split(':')[1];
            await appendPlacePhotos(placeId);
        }
    } finally {
        isLoadingMore = false;
        // Remove loading indicator
        const indicator = grid.querySelector('.loading-indicator');
        if (indicator) indicator.remove();
    }
}

async function appendGalleryPhotos() {
    const sort = $('#sort')?.value || 'date';
    const filter = $('#filter')?.value || '';

    let url = `/api/v1/photos?limit=100&sort=${sort}`;
    if (filter === 'favorite') url += '&favorite=true';
    else if (filter) url += `&type=${filter}`;
    url += `&cursor=${nextCursor}`;

    const data = await api.get(url);

    hasMorePhotos = data.has_more;
    nextCursor = data.next_cursor;

    appendPhotosToGrid(data.photos);
}

async function appendAlbumPhotos(albumId) {
    let url = `/api/v1/albums/${albumId}/photos?limit=100&cursor=${nextCursor}`;

    const data = await api.get(url);

    hasMorePhotos = data.has_more;
    nextCursor = data.next_cursor;

    appendPhotosToGrid(data.photos);
}

async function appendPlacePhotos(placeId) {
    let url = `/api/v1/places/${placeId}?limit=100&cursor=${nextCursor}`;

    const data = await api.get(url);

    hasMorePhotos = data.has_more;
    nextCursor = data.next_cursor;

    appendPhotosToGrid(data.photos);
}

function appendPhotosToGrid(newPhotos) {
    const grid = $('#photo-grid');
    const startIndex = currentPhotos.length;

    currentPhotos = [...currentPhotos, ...newPhotos];

    for (let i = 0; i < newPhotos.length; i++) {
        const photo = newPhotos[i];
        const index = startIndex + i;

        const div = document.createElement('div');
        div.className = `photo-item ${photo.type === 'video' ? 'video' : ''}`;
        div.dataset.id = photo.id;
        div.dataset.index = index;
        div.innerHTML = `
            <img src="${API_BASE}${photo.small}" loading="lazy" alt="">
            ${photo.duration ? `<span class="duration">${formatDuration(photo.duration)}</span>` : ''}
        `;
        div.onclick = () => openPhotoModal(index);
        grid.appendChild(div);
    }
}

// Header component
function renderHeader(active) {
    return `
        <header class="header">
            <div class="header-left">
                <h1>Imgable</h1>
                <nav class="nav">
                    <a href="/" class="${active === 'gallery' ? 'active' : ''}" data-link>Gallery</a>
                    <a href="/albums" class="${active === 'albums' ? 'active' : ''}" data-link>Albums</a>
                    <a href="/places" class="${active === 'places' ? 'active' : ''}" data-link>Map</a>
                    <a href="/sync" class="${active === 'sync' ? 'active' : ''}" data-link>Sync</a>
                    <a href="/upload" class="${active === 'upload' ? 'active' : ''}" data-link>Upload</a>
                </nav>
            </div>
            <div class="header-right">
                <a href="/sync" data-link><span class="sync-indicator ok" id="sync-status"></span></a>
                <button onclick="api.logout()">Logout</button>
            </div>
        </header>
    `;
}

// Pages
function renderLogin() {
    html($('#app'), `
        <div class="login-page">
            <h1>Imgable</h1>
            <form class="login-form" id="login-form">
                <input type="password" id="password" placeholder="Password" autofocus>
                <button type="submit">Login</button>
                <div class="login-error" id="login-error"></div>
            </form>
        </div>
    `);

    $('#login-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            await api.login($('#password').value);
            router.navigate('/');
        } catch (err) {
            $('#login-error').textContent = err.message;
        }
    };
}

async function renderGallery() {
    html($('#app'), renderHeader('gallery') + `
        <div class="container">
            <div class="gallery-controls">
                <select id="sort">
                    <option value="date">By Date</option>
                    <option value="created">By Added</option>
                </select>
                <select id="filter">
                    <option value="">All</option>
                    <option value="photo">Photos</option>
                    <option value="video">Videos</option>
                    <option value="favorite">Favorites</option>
                </select>
            </div>
            <div class="photo-grid" id="photo-grid">Loading...</div>
        </div>
    `);

    await loadPhotos();

    $('#sort').onchange = () => loadPhotos();
    $('#filter').onchange = () => loadPhotos();
}

async function loadPhotos() {
    // Reset infinite scroll state
    currentPhotos = [];
    isLoadingMore = false;
    hasMorePhotos = false;
    nextCursor = null;
    currentLoadContext = 'gallery';

    const sort = $('#sort')?.value || 'date';
    const filter = $('#filter')?.value || '';

    let url = `/api/v1/photos?limit=100&sort=${sort}`;
    if (filter === 'favorite') url += '&favorite=true';
    else if (filter) url += `&type=${filter}`;

    try {
        const data = await api.get(url);
        currentPhotos = data.photos;
        hasMorePhotos = data.has_more;
        nextCursor = data.next_cursor;

        let gridHtml = '';
        for (const photo of currentPhotos) {
            gridHtml += `
                <div class="photo-item ${photo.type === 'video' ? 'video' : ''}" data-id="${photo.id}" data-index="${currentPhotos.indexOf(photo)}">
                    <img src="${API_BASE}${photo.small}" loading="lazy" alt="">
                    ${photo.duration ? `<span class="duration">${formatDuration(photo.duration)}</span>` : ''}
                </div>
            `;
        }

        html($('#photo-grid'), gridHtml);

        $$('.photo-item').forEach(el => {
            el.onclick = () => openPhotoModal(parseInt(el.dataset.index));
        });

        // Setup infinite scroll after initial load
        setupInfiniteScroll();

        // Check if we need to load more immediately (viewport might be tall)
        setTimeout(() => {
            if (hasMorePhotos && nextCursor) {
                const scrollY = window.scrollY;
                const windowHeight = window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                if (documentHeight - (scrollY + windowHeight) < 1500) {
                    loadMorePhotos();
                }
            }
        }, 100);
    } catch (err) {
        html($('#photo-grid'), `Error: ${err.message}`);
    }
}

async function openPhotoModal(index) {
    currentPhotoIndex = index;
    const photo = currentPhotos[index];

    try {
        const details = await api.get(`/api/v1/photos/${photo.id}`);
        renderPhotoModal(details);
    } catch (err) {
        alert('Error loading photo: ' + err.message);
    }
}

function renderPhotoModal(photo) {
    const isVideo = photo.type === 'video';
    const mediaUrl = API_BASE + (isVideo ? photo.urls.video : photo.urls.large);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'photo-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <span>${photo.original_filename || photo.id}</span>
            <button class="close-btn" onclick="closePhotoModal()">×</button>
        </div>
        <div class="modal-content">
            ${currentPhotoIndex > 0 ? '<button class="modal-nav prev" onclick="navPhoto(-1)">‹</button>' : ''}
            ${isVideo
                ? `<video src="${mediaUrl}" controls autoplay></video>`
                : `<img src="${mediaUrl}" alt="">`
            }
            ${currentPhotoIndex < currentPhotos.length - 1 ? '<button class="modal-nav next" onclick="navPhoto(1)">›</button>' : ''}
        </div>
        <div class="modal-footer">
            <div class="modal-actions">
                <button onclick="toggleFavorite('${photo.id}', ${!photo.is_favorite})">${photo.is_favorite ? '♥ Unfavorite' : '♡ Favorite'}</button>
                <button onclick="showAddToAlbum('${photo.id}')">📁 Add to Album</button>
                <button onclick="showShareModal('photo', '${photo.id}')">🔗 Share</button>
                <button onclick="deletePhoto('${photo.id}')">🗑 Delete</button>
            </div>
            <div class="modal-comment">
                <input type="text" id="comment-input" value="${photo.comment || ''}" placeholder="Add comment...">
                <button onclick="saveComment('${photo.id}')">Save</button>
            </div>
            <div class="modal-meta">
                ${photo.taken_at ? `<div>Date: ${formatDate(photo.taken_at)}</div>` : ''}
                ${photo.width && photo.height ? `<div>Size: ${photo.width} × ${photo.height}</div>` : ''}
                ${photo.size_bytes ? `<div>File: ${formatBytes(photo.size_bytes)}</div>` : ''}
                ${photo.exif?.camera_make ? `<div>Camera: ${photo.exif.camera_make} ${photo.exif.camera_model || ''}</div>` : ''}
                ${photo.place ? `<div>Place: ${photo.place.name}</div>` : ''}
                ${photo.duration_sec ? `<div>Duration: ${formatDuration(photo.duration_sec)}</div>` : ''}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.onclick = (e) => { if (e.target === modal) closePhotoModal(); };
    document.onkeydown = (e) => {
        if (e.key === 'Escape') closePhotoModal();
        if (e.key === 'ArrowLeft') navPhoto(-1);
        if (e.key === 'ArrowRight') navPhoto(1);
    };
}

function closePhotoModal() {
    const modal = $('#photo-modal');
    if (modal) modal.remove();
    document.onkeydown = null;
}

function navPhoto(dir) {
    const newIndex = currentPhotoIndex + dir;
    if (newIndex >= 0 && newIndex < currentPhotos.length) {
        closePhotoModal();
        openPhotoModal(newIndex);
    }
}

async function toggleFavorite(id, add) {
    try {
        if (add) await api.post(`/api/v1/photos/${id}/favorite`);
        else await api.delete(`/api/v1/photos/${id}/favorite`);
        closePhotoModal();
        openPhotoModal(currentPhotoIndex);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function saveComment(id) {
    try {
        await api.patch(`/api/v1/photos/${id}`, { comment: $('#comment-input').value });
        alert('Comment saved');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function deletePhoto(id) {
    if (!confirm('Delete this photo?')) return;
    try {
        await api.delete(`/api/v1/photos/${id}`);
        closePhotoModal();
        currentPhotos = currentPhotos.filter(p => p.id !== id);
        loadPhotos();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function showAddToAlbum(photoId) {
    try {
        const data = await api.get('/api/v1/albums');
        const albums = data.albums.filter(a => a.type === 'manual');

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="album-select-modal">
                <h3>Add to Album</h3>
                ${albums.map(a => `<div class="album-select-item" data-id="${a.id}">${a.name} (${a.photo_count})</div>`).join('')}
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.album-select-item').forEach(el => {
            el.onclick = async () => {
                try {
                    await api.post(`/api/v1/albums/${el.dataset.id}/photos`, { photo_ids: [photoId] });
                    modal.remove();
                    alert('Added to album');
                } catch (err) {
                    alert('Error: ' + err.message);
                }
            };
        });
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function showShareModal(type, id) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="share-modal">
            <h3>Share ${type}</h3>
            <div id="share-content">
                <button onclick="createShare('${type}', '${id}')">Create Share Link</button>
            </div>
            <button onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
}

async function createShare(type, id) {
    try {
        const body = { type };
        if (type === 'photo') body.photo_id = id;
        else body.album_id = id;

        const data = await api.post('/api/v1/shares', body);
        const url = location.origin + data.url;

        html($('#share-content'), `
            <div class="share-url">
                <input type="text" value="${url}" readonly id="share-url-input">
                <button onclick="navigator.clipboard.writeText('${url}'); alert('Copied!')">Copy</button>
            </div>
        `);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Albums Page
async function renderAlbums() {
    html($('#app'), renderHeader('albums') + `
        <div class="container">
            <div class="albums-header">
                <h2>Albums</h2>
                <button onclick="showCreateAlbumModal()">+ Create Album</button>
            </div>
            <div class="albums-grid" id="albums-grid">Loading...</div>
        </div>
    `);

    try {
        const data = await api.get('/api/v1/albums');
        let gridHtml = '';

        for (const album of data.albums) {
            gridHtml += `
                <div class="album-card" onclick="router.navigate('/albums/${album.id}')">
                    <div class="album-card-cover">
                        ${album.cover_url
                            ? `<img src="${API_BASE}${album.cover_url}" alt="">`
                            : (album.type === 'favorites' ? '⭐' : '📁')}
                    </div>
                    <div class="album-card-info">
                        <h3>${album.name}</h3>
                        <span>${album.photo_count} photos</span>
                    </div>
                </div>
            `;
        }

        html($('#albums-grid'), gridHtml || 'No albums yet');
    } catch (err) {
        html($('#albums-grid'), `Error: ${err.message}`);
    }
}

function showCreateAlbumModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="create-album-modal">
            <h3>Create Album</h3>
            <input type="text" id="album-name" placeholder="Album name">
            <div class="buttons">
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button onclick="createAlbum()">Create</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    $('#album-name').focus();
}

async function createAlbum() {
    const name = $('#album-name').value.trim();
    if (!name) return alert('Enter album name');

    try {
        await api.post('/api/v1/albums', { name });
        $('.modal-overlay').remove();
        renderAlbums();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Album View
async function renderAlbumView(albumId) {
    // Reset infinite scroll state
    currentPhotos = [];
    isLoadingMore = false;
    hasMorePhotos = false;
    nextCursor = null;
    currentLoadContext = `album:${albumId}`;

    html($('#app'), renderHeader('albums') + `
        <div class="container">
            <div class="album-header" id="album-header">Loading...</div>
            <div class="photo-grid" id="photo-grid">Loading...</div>
        </div>
    `);

    try {
        const data = await api.get(`/api/v1/albums/${albumId}`);
        const album = data.album;
        currentPhotos = data.photos;
        hasMorePhotos = data.has_more;
        nextCursor = data.next_cursor;

        html($('#album-header'), `
            <h2><a href="/albums" data-link class="back-link">←</a> ${album.name} (${album.photo_count})</h2>
            <div class="album-actions">
                ${album.type === 'manual' ? `
                    <button onclick="showShareModal('album', '${album.id}')">🔗 Share</button>
                    <button onclick="deleteAlbum('${album.id}')">🗑 Delete</button>
                ` : ''}
            </div>
        `);

        let gridHtml = '';
        for (const photo of currentPhotos) {
            gridHtml += `
                <div class="photo-item ${photo.type === 'video' ? 'video' : ''}" data-id="${photo.id}" data-index="${currentPhotos.indexOf(photo)}">
                    <img src="${API_BASE}${photo.small}" loading="lazy" alt="">
                    ${photo.duration ? `<span class="duration">${formatDuration(photo.duration)}</span>` : ''}
                </div>
            `;
        }

        html($('#photo-grid'), gridHtml || 'No photos in album');

        $$('.photo-item').forEach(el => {
            el.onclick = () => openPhotoModal(parseInt(el.dataset.index));
        });

        // Setup infinite scroll
        setupInfiniteScroll();

        // Check if we need to load more immediately (viewport might be tall)
        setTimeout(() => {
            if (hasMorePhotos && nextCursor) {
                const scrollY = window.scrollY;
                const windowHeight = window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                if (documentHeight - (scrollY + windowHeight) < 1500) {
                    loadMorePhotos();
                }
            }
        }, 100);
    } catch (err) {
        html($('#album-header'), `Error: ${err.message}`);
    }
}

async function deleteAlbum(id) {
    if (!confirm('Delete this album?')) return;
    try {
        await api.delete(`/api/v1/albums/${id}`);
        router.navigate('/albums');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Places / Map
async function renderPlaces() {
    html($('#app'), renderHeader('places') + `
        <div class="container">
            <h2>Map</h2>
            <div id="map"></div>
            <div class="places-list" id="places-list">Loading...</div>
        </div>
    `);

    const map = L.map('map').setView([55.75, 37.62], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    try {
        const [placesData, mapData] = await Promise.all([
            api.get('/api/v1/places'),
            api.get('/api/v1/map')
        ]);

        // Add markers
        if (mapData.markers) {
            for (const marker of mapData.markers) {
                L.marker([marker.lat, marker.lon])
                    .addTo(map)
                    .bindPopup(`<b>${marker.name}</b><br>${marker.count} photos`)
                    .on('click', () => router.navigate(`/places/${marker.id}`));
            }
        }

        // List places
        let listHtml = '';
        for (const place of placesData.places) {
            listHtml += `
                <div class="place-item" onclick="router.navigate('/places/${place.id}')">
                    <span>${place.name}</span>
                    <span>${place.photo_count} photos</span>
                </div>
            `;
        }
        html($('#places-list'), listHtml || 'No places with GPS data');
    } catch (err) {
        html($('#places-list'), `Error: ${err.message}`);
    }
}

// Place View (single place with photos)
async function renderPlaceView(placeId) {
    // Reset infinite scroll state
    currentPhotos = [];
    isLoadingMore = false;
    hasMorePhotos = false;
    nextCursor = null;
    currentLoadContext = `place:${placeId}`;

    html($('#app'), renderHeader('places') + `
        <div class="container">
            <div class="place-header" id="place-header">Loading...</div>
            <div id="place-map-small"></div>
            <div class="photo-grid" id="photo-grid">Loading...</div>
        </div>
    `);

    try {
        const data = await api.get(`/api/v1/places/${placeId}`);
        const place = data.place;
        currentPhotos = data.photos;
        hasMorePhotos = data.has_more;
        nextCursor = data.next_cursor;

        html($('#place-header'), `
            <h2><a href="/places" data-link class="back-link">←</a> ${place.name}</h2>
            <div class="place-info">
                ${place.city ? `<span>${place.city}</span>` : ''}
                ${place.country ? `<span>${place.country}</span>` : ''}
                <span>${place.photo_count} photos</span>
            </div>
        `);

        // Small map showing the place location
        const smallMap = L.map('place-map-small', {
            zoomControl: false,
            dragging: false,
            scrollWheelZoom: false
        }).setView([place.gps_lat, place.gps_lon], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(smallMap);
        L.marker([place.gps_lat, place.gps_lon]).addTo(smallMap);

        let gridHtml = '';
        for (const photo of currentPhotos) {
            gridHtml += `
                <div class="photo-item ${photo.type === 'video' ? 'video' : ''}" data-id="${photo.id}" data-index="${currentPhotos.indexOf(photo)}">
                    <img src="${API_BASE}${photo.small}" loading="lazy" alt="">
                    ${photo.duration ? `<span class="duration">${formatDuration(photo.duration)}</span>` : ''}
                </div>
            `;
        }

        html($('#photo-grid'), gridHtml || 'No photos in this place');

        $$('.photo-item').forEach(el => {
            el.onclick = () => openPhotoModal(parseInt(el.dataset.index));
        });

        // Setup infinite scroll
        setupInfiniteScroll();

        // Check if we need to load more immediately (viewport might be tall)
        setTimeout(() => {
            if (hasMorePhotos && nextCursor) {
                const scrollY = window.scrollY;
                const windowHeight = window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                if (documentHeight - (scrollY + windowHeight) < 1500) {
                    loadMorePhotos();
                }
            }
        }, 100);
    } catch (err) {
        html($('#place-header'), `Error: ${err.message}`);
    }
}

// Sync Status
async function renderSync() {
    html($('#app'), renderHeader('sync') + `
        <div class="container">
            <h2>Sync Status</h2>
            <div id="sync-content">Loading...</div>
        </div>
    `);

    await refreshSync();
}

async function refreshSync() {
    try {
        const [scanner, processor] = await Promise.all([
            api.get('/api/v1/sync/scanner/status'),
            api.get('/api/v1/sync/processor/status')
        ]);

        html($('#sync-content'), `
            <div class="sync-section">
                <h3>Scanner</h3>
                <div class="sync-row"><span>Status:</span> <span>${scanner.status}</span></div>
                <div class="sync-row"><span>Watched dirs:</span> <span>${scanner.watcher?.watched_dirs || 0}</span></div>
                <div class="sync-row"><span>Files discovered:</span> <span>${scanner.watcher?.files_discovered || 0}</span></div>
                <div class="sync-row"><span>Files queued:</span> <span>${scanner.watcher?.files_queued || 0}</span></div>
                <div class="sync-row"><span>Pending:</span> <span>${scanner.watcher?.pending_files_count || 0}</span></div>
                <div class="sync-actions">
                    <button onclick="triggerRescan()">🔄 Rescan</button>
                </div>
            </div>

            <div class="sync-section">
                <h3>Processor</h3>
                <div class="sync-row"><span>Status:</span> <span>${processor.status} ${processor.paused ? '(paused)' : ''}</span></div>
                <div class="sync-row"><span>Workers:</span> <span>${processor.workers?.active || 0} / ${processor.workers?.total || 0}</span></div>
                <div class="sync-row"><span>Queue:</span> <span>${processor.queue?.pending || 0} pending</span></div>
                <div class="sync-row"><span>Completed:</span> <span>${processor.queue?.completed_total || 0}</span></div>
                <div class="sync-row"><span>Failed:</span> <span>${processor.queue?.failed_total || 0}</span></div>
                <div class="sync-row"><span>Memory:</span> <span>${processor.resources?.memory_used_mb || 0} MB</span></div>
                <div class="sync-actions">
                    <button onclick="toggleProcessor()">${processor.paused ? '▶ Resume' : '⏸ Pause'}</button>
                </div>
            </div>

            <button onclick="refreshSync()">Refresh</button>
        `);
    } catch (err) {
        html($('#sync-content'), `Error: ${err.message}`);
    }
}

async function triggerRescan() {
    try {
        await api.post('/api/v1/sync/scanner/rescan');
        alert('Rescan triggered');
        refreshSync();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function toggleProcessor() {
    try {
        const status = await api.get('/api/v1/sync/processor/status');
        if (status.paused) {
            await api.post('/api/v1/sync/processor/resume');
        } else {
            await api.post('/api/v1/sync/processor/pause');
        }
        refreshSync();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Share View (public)
async function renderShare(code) {
    html($('#app'), `
        <div class="share-page">
            <h1>Imgable</h1>
            <div id="share-content">Loading...</div>
        </div>
    `);

    try {
        const res = await fetch(`${API_BASE}/s/${code}`);
        const data = await res.json();

        if (res.status === 401) {
            // Password required
            html($('#share-content'), `
                <form class="share-password-form" onsubmit="submitSharePassword(event, '${code}')">
                    <p>This share is password protected</p>
                    <input type="password" id="share-password" placeholder="Password">
                    <button type="submit">View</button>
                </form>
            `);
            return;
        }

        if (!res.ok) {
            html($('#share-content'), `Error: ${data.error}`);
            return;
        }

        if (data.type === 'photo') {
            html($('#share-content'), `
                <img src="${API_BASE}${data.photo.urls.large}" style="max-width: 90vw; max-height: 80vh;">
            `);
        } else {
            // Album
            let photosHtml = '';
            for (const photo of data.photos) {
                photosHtml += `
                    <div class="photo-item ${photo.type === 'video' ? 'video' : ''}">
                        <img src="${API_BASE}${photo.small}" loading="lazy" alt="">
                    </div>
                `;
            }
            html($('#share-content'), `
                <h2>${data.album.name} (${data.album.photo_count} photos)</h2>
                <div class="photo-grid" style="max-width: 800px; margin: 20px auto;">
                    ${photosHtml}
                </div>
            `);
        }
    } catch (err) {
        html($('#share-content'), `Error: ${err.message}`);
    }
}

async function submitSharePassword(e, code) {
    e.preventDefault();
    const password = $('#share-password').value;
    try {
        const res = await fetch(`${API_BASE}/s/${code}?password=${encodeURIComponent(password)}`);
        if (res.ok) {
            location.reload(); // Simple reload with password in URL
        } else {
            alert('Invalid password');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Upload Page - Parallel uploads with individual progress bars
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB
const SUPPORTED_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.tiff', '.tif', '.bmp',
    '.raw', '.cr2', '.cr3', '.arw', '.nef', '.dng', '.orf', '.rw2',
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mts', '.m2ts', '.3gp'
];
const MAX_PARALLEL_UPLOADS = 3;

let uploadFiles = [];
let uploadIdCounter = 0;
let activeUploads = 0;
let uploadCancelled = false;

function renderUpload() {
    // Reset state when entering page
    uploadFiles = [];
    uploadIdCounter = 0;
    activeUploads = 0;
    uploadCancelled = false;

    html($('#app'), renderHeader('upload') + `
        <div class="container">
            <h2>Upload Files</h2>
            <div class="upload-area" id="upload-area">
                <div class="upload-icon">📁</div>
                <div class="upload-text">Drag & drop files or folders here</div>
                <div class="upload-subtext">or</div>
                <div class="upload-buttons">
                    <button type="button" id="btn-select-files">Select Files</button>
                    <button type="button" id="btn-select-folder">Select Folder</button>
                </div>
                <input type="file" id="file-input" multiple accept="image/*,video/*" style="display:none">
                <input type="file" id="folder-input" webkitdirectory style="display:none">
                <div class="upload-hint">Photos & videos up to 4 GB each. Supports nested folders.</div>
            </div>
            <div class="upload-summary" id="upload-summary" style="display:none">
                <div class="summary-stats">
                    <span id="summary-total">0 files</span>
                    <span id="summary-size">0 B</span>
                    <span id="summary-done" class="done">0 done</span>
                    <span id="summary-failed" class="failed" style="display:none">0 failed</span>
                </div>
                <div class="summary-actions">
                    <button type="button" id="btn-cancel-all">Cancel All</button>
                    <button type="button" id="btn-clear-done">Clear Completed</button>
                </div>
            </div>
            <div class="upload-list" id="upload-list"></div>
        </div>
    `);

    setupUploadHandlers();
}

function setupUploadHandlers() {
    const area = $('#upload-area');
    const fileInput = $('#file-input');
    const folderInput = $('#folder-input');

    // Button clicks
    $('#btn-select-files').onclick = () => fileInput.click();
    $('#btn-select-folder').onclick = () => folderInput.click();
    $('#btn-cancel-all').onclick = cancelAllUploads;
    $('#btn-clear-done').onclick = clearCompletedUploads;

    // Drag and drop
    area.ondragenter = area.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        area.classList.add('dragover');
    };

    area.ondragleave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        area.classList.remove('dragover');
    };

    area.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        area.classList.remove('dragover');

        const items = e.dataTransfer.items;
        if (!items) return;

        const files = [];
        const entries = [];

        // Collect all entries first
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry) {
                    entries.push(entry);
                } else {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
        }

        // Process entries (may include folders)
        for (const entry of entries) {
            await traverseEntry(entry, files);
        }

        processFiles(files);
    };

    fileInput.onchange = () => {
        if (fileInput.files.length > 0) {
            processFiles(Array.from(fileInput.files));
            fileInput.value = '';
        }
    };

    folderInput.onchange = () => {
        if (folderInput.files.length > 0) {
            processFiles(Array.from(folderInput.files));
            folderInput.value = '';
        }
    };
}

async function traverseEntry(entry, files) {
    if (entry.isFile) {
        try {
            const file = await new Promise((resolve, reject) => {
                entry.file(resolve, reject);
            });
            files.push(file);
        } catch (e) {
            console.warn('Could not read file:', entry.fullPath, e);
        }
    } else if (entry.isDirectory) {
        const reader = entry.createReader();

        const readBatch = () => new Promise((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });

        try {
            let batch;
            do {
                batch = await readBatch();
                for (const childEntry of batch) {
                    await traverseEntry(childEntry, files);
                }
            } while (batch.length > 0);
        } catch (e) {
            console.warn('Could not read directory:', entry.fullPath, e);
        }
    }
}

function isValidFile(file) {
    if (!file.name || file.name.startsWith('.')) return false;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
}

function processFiles(files) {
    const skipped = { invalid: 0, tooLarge: 0 };
    let added = 0;

    for (const file of files) {
        if (!isValidFile(file)) {
            skipped.invalid++;
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            skipped.tooLarge++;
            continue;
        }

        const id = ++uploadIdCounter;
        const item = {
            id,
            file,
            status: 'pending', // pending, uploading, done, error, cancelled
            progress: 0,
            error: null,
            xhr: null
        };

        uploadFiles.push(item);
        renderFileItem(item);
        added++;
    }

    updateSummary();

    if (skipped.invalid > 0 || skipped.tooLarge > 0) {
        const msgs = [];
        if (skipped.invalid > 0) msgs.push(`${skipped.invalid} unsupported`);
        if (skipped.tooLarge > 0) msgs.push(`${skipped.tooLarge} too large (>4GB)`);
        setTimeout(() => alert(`Skipped: ${msgs.join(', ')}`), 100);
    }

    // Start/continue uploading - allow adding files while upload is in progress
    if (added > 0) {
        uploadCancelled = false;
        processQueue();
    }
}

function renderFileItem(item) {
    const list = $('#upload-list');
    if (!list) return;

    const div = document.createElement('div');
    div.className = 'upload-item';
    div.id = `upload-item-${item.id}`;
    div.innerHTML = `
        <div class="upload-item-info">
            <span class="upload-item-name" title="${item.file.name}">${truncateName(item.file.name, 40)}</span>
            <span class="upload-item-size">${formatBytes(item.file.size)}</span>
        </div>
        <div class="upload-item-progress">
            <div class="upload-item-bar" id="bar-${item.id}"></div>
        </div>
        <div class="upload-item-status" id="status-${item.id}">Waiting...</div>
        <button class="upload-item-cancel" id="cancel-${item.id}" title="Cancel">×</button>
    `;

    list.insertBefore(div, list.firstChild);

    document.getElementById(`cancel-${item.id}`).onclick = () => cancelUpload(item.id);
}

function truncateName(name, max) {
    if (name.length <= max) return name;
    const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
    const base = name.slice(0, name.length - ext.length);
    const truncated = base.slice(0, max - ext.length - 3) + '...';
    return truncated + ext;
}

function updateFileItem(item) {
    const bar = document.getElementById(`bar-${item.id}`);
    const status = document.getElementById(`status-${item.id}`);
    const cancel = document.getElementById(`cancel-${item.id}`);
    const row = document.getElementById(`upload-item-${item.id}`);

    if (!bar || !status || !row) return;

    bar.style.width = `${item.progress}%`;

    if (item.status === 'uploading') {
        bar.className = 'upload-item-bar uploading';
        status.textContent = `${item.progress}%`;
        status.className = 'upload-item-status';
    } else if (item.status === 'done') {
        bar.className = 'upload-item-bar done';
        bar.style.width = '100%';
        status.textContent = 'Done';
        status.className = 'upload-item-status done';
        if (cancel) cancel.style.display = 'none';
    } else if (item.status === 'error') {
        bar.className = 'upload-item-bar error';
        status.textContent = item.error || 'Error';
        status.className = 'upload-item-status error';
        if (cancel) cancel.style.display = 'none';
    } else if (item.status === 'cancelled') {
        bar.className = 'upload-item-bar cancelled';
        status.textContent = 'Cancelled';
        status.className = 'upload-item-status cancelled';
        if (cancel) cancel.style.display = 'none';
    }
}

function updateSummary() {
    const summary = $('#upload-summary');
    if (!summary) return;

    if (uploadFiles.length === 0) {
        summary.style.display = 'none';
        return;
    }

    summary.style.display = 'flex';

    const total = uploadFiles.length;
    const totalSize = uploadFiles.reduce((sum, f) => sum + f.file.size, 0);
    const done = uploadFiles.filter(f => f.status === 'done').length;
    const failed = uploadFiles.filter(f => f.status === 'error' || f.status === 'cancelled').length;

    const totalEl = document.getElementById('summary-total');
    const sizeEl = document.getElementById('summary-size');
    const doneEl = document.getElementById('summary-done');
    const failedEl = document.getElementById('summary-failed');

    if (totalEl) totalEl.textContent = `${total} files`;
    if (sizeEl) sizeEl.textContent = formatBytes(totalSize);
    if (doneEl) doneEl.textContent = `${done} done`;
    if (failedEl) {
        failedEl.textContent = `${failed} failed`;
        failedEl.style.display = failed > 0 ? '' : 'none';
    }
}

function processQueue() {
    if (uploadCancelled) return;

    while (activeUploads < MAX_PARALLEL_UPLOADS) {
        const next = uploadFiles.find(f => f.status === 'pending');
        if (!next) break;

        startUpload(next);
    }
}

function startUpload(item) {
    item.status = 'uploading';
    item.progress = 0;
    activeUploads++;
    updateFileItem(item);

    const xhr = new XMLHttpRequest();
    item.xhr = xhr;

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && item.status === 'uploading') {
            item.progress = Math.round((e.loaded / e.total) * 100);
            updateFileItem(item);
        }
    };

    xhr.onload = () => {
        item.xhr = null;
        activeUploads--;

        if (xhr.status >= 200 && xhr.status < 300) {
            item.status = 'done';
            item.progress = 100;
        } else {
            item.status = 'error';
            try {
                const resp = JSON.parse(xhr.responseText);
                item.error = resp.error || `Error ${xhr.status}`;
            } catch {
                item.error = xhr.statusText || `Error ${xhr.status}`;
            }
        }

        updateFileItem(item);
        updateSummary();
        processQueue();
    };

    xhr.onerror = () => {
        item.xhr = null;
        activeUploads--;
        item.status = 'error';
        item.error = 'Network error';
        updateFileItem(item);
        updateSummary();
        processQueue();
    };

    xhr.onabort = () => {
        item.xhr = null;
        if (item.status === 'uploading') {
            activeUploads--;
            item.status = 'cancelled';
            updateFileItem(item);
            updateSummary();
            processQueue();
        }
    };

    const formData = new FormData();
    formData.append('file', item.file);

    xhr.open('POST', API_BASE + '/api/v1/upload');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
}

function cancelUpload(id) {
    const item = uploadFiles.find(f => f.id === id);
    if (!item) return;

    if (item.status === 'pending') {
        item.status = 'cancelled';
        updateFileItem(item);
        updateSummary();
    } else if (item.status === 'uploading' && item.xhr) {
        item.xhr.abort();
    }
}

function cancelAllUploads() {
    uploadCancelled = true;

    for (const item of uploadFiles) {
        if (item.status === 'pending') {
            item.status = 'cancelled';
            updateFileItem(item);
        } else if (item.status === 'uploading' && item.xhr) {
            item.xhr.abort();
        }
    }

    updateSummary();
}

function clearCompletedUploads() {
    // Remove completed items from DOM and array
    uploadFiles = uploadFiles.filter(item => {
        if (item.status === 'done' || item.status === 'cancelled' || item.status === 'error') {
            const el = document.getElementById(`upload-item-${item.id}`);
            if (el) el.remove();
            return false;
        }
        return true;
    });

    updateSummary();
}

// Setup routes
router.add('/login', renderLogin);
router.add('/', renderGallery);
router.add('/albums', renderAlbums);
router.add('/albums/:id', renderAlbumView);
router.add('/places', renderPlaces);
router.add('/places/:id', renderPlaceView);
router.add('/sync', renderSync);
router.add('/upload', renderUpload);
router.add('/s/:code', renderShare);

// Handle navigation clicks
document.addEventListener('click', (e) => {
    if (e.target.matches('[data-link]')) {
        e.preventDefault();
        router.navigate(e.target.getAttribute('href'));
    }
});

// Handle browser back/forward
window.addEventListener('popstate', () => router.resolve());

// Initial route
router.resolve();
