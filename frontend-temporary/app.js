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

// Multi-select state
let selectMode = false;
let selectedPhotos = new Set();

// Grouping state
let groupByMonth = localStorage.getItem('groupByMonth') !== 'false'; // default true
let lastRenderedMonth = null;

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

function getPhotoMonthKey(photo) {
    if (!photo.taken_at) return 'no-date';
    const date = new Date(photo.taken_at * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey) {
    if (monthKey === 'no-date') return 'No date';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function renderPhotosWithGroups(photos, startIndex) {
    const grid = $('#photo-grid');

    for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const index = startIndex + i;

        // Add month header if grouping enabled and month changed
        if (groupByMonth) {
            const monthKey = getPhotoMonthKey(photo);
            if (monthKey !== lastRenderedMonth) {
                lastRenderedMonth = monthKey;
                const header = document.createElement('div');
                header.className = 'month-header';
                header.textContent = getMonthLabel(monthKey);
                grid.appendChild(header);
            }
        }

        const div = document.createElement('div');
        div.className = `photo-item ${photo.type === 'video' ? 'video' : ''}`;
        div.dataset.id = photo.id;
        div.dataset.index = index;
        div.innerHTML = `
            <img src="${API_BASE}${photo.small}" loading="lazy" alt="">
            ${photo.duration ? `<span class="duration">${formatDuration(photo.duration)}</span>` : ''}
        `;
        div.onclick = () => {
            if (selectMode) {
                togglePhotoSelection(div.dataset.id, div);
            } else {
                openPhotoModal(index);
            }
        };
        grid.appendChild(div);
    }
}

function appendPhotosToGrid(newPhotos) {
    const startIndex = currentPhotos.length;
    currentPhotos = [...currentPhotos, ...newPhotos];
    renderPhotosWithGroups(newPhotos, startIndex);
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
                    <a href="/people" class="${active === 'people' ? 'active' : ''}" data-link>People</a>
                    <a href="/map" class="${active === 'map' ? 'active' : ''}" data-link>Map</a>
                    <a href="/shares" class="${active === 'shares' ? 'active' : ''}" data-link>Shares</a>
                    <a href="/stats" class="${active === 'stats' ? 'active' : ''}" data-link>Stats</a>
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
    // Reset select mode
    selectMode = false;
    selectedPhotos.clear();

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
                <label class="group-toggle">
                    <input type="checkbox" id="group-by-month" ${groupByMonth ? 'checked' : ''}>
                    Group by month
                </label>
                <button id="btn-select-mode" onclick="toggleSelectMode()">Select</button>
            </div>
            <div class="selection-bar" id="selection-bar" style="display:none">
                <span id="selection-count">0 selected</span>
                <button onclick="bulkAddToAlbum()">Add to Album</button>
                <button onclick="bulkShare()">Share</button>
                <button onclick="bulkDelete()">Delete</button>
                <button onclick="toggleSelectMode()">Cancel</button>
            </div>
            <div class="photo-grid" id="photo-grid">Loading...</div>
        </div>
    `);

    await loadPhotos();

    $('#sort').onchange = () => loadPhotos();
    $('#filter').onchange = () => loadPhotos();
    $('#group-by-month').onchange = (e) => {
        groupByMonth = e.target.checked;
        localStorage.setItem('groupByMonth', groupByMonth);
        loadPhotos();
    };
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
    lastRenderedMonth = null; // Reset for fresh render

    let url = `/api/v1/photos?limit=100&sort=${sort}`;
    if (filter === 'favorite') url += '&favorite=true';
    else if (filter) url += `&type=${filter}`;

    try {
        const data = await api.get(url);
        currentPhotos = data.photos;
        hasMorePhotos = data.has_more;
        nextCursor = data.next_cursor;

        const grid = $('#photo-grid');
        grid.innerHTML = '';
        renderPhotosWithGroups(currentPhotos, 0);

        $$('.photo-item').forEach(el => {
            el.onclick = () => {
                if (selectMode) {
                    togglePhotoSelection(el.dataset.id, el);
                } else {
                    openPhotoModal(parseInt(el.dataset.index));
                }
            };
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
    const inAlbum = currentAlbumId && currentAlbumId !== 'favorites';

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
                <button onclick="showAddToAlbum('${photo.id}')">Add to Album</button>
                ${inAlbum ? `<button onclick="removePhotoFromAlbum('${photo.id}')" class="btn-warning">Remove from Album</button>` : ''}
                <button onclick="showShareModal('photo', '${photo.id}')">Share</button>
                <button onclick="deletePhoto('${photo.id}')" class="btn-danger">Delete</button>
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

async function removePhotoFromAlbum(photoId) {
    if (!currentAlbumId) return;
    if (!confirm('Remove this photo from album?')) return;

    try {
        await api.delete(`/api/v1/albums/${currentAlbumId}/photos/${photoId}`);
        closePhotoModal();
        currentPhotos = currentPhotos.filter(p => p.id !== photoId);
        renderAlbumView(currentAlbumId);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Multi-select functions
function toggleSelectMode() {
    selectMode = !selectMode;
    selectedPhotos.clear();

    const btn = $('#btn-select-mode');
    const bar = $('#selection-bar');
    const grid = $('#photo-grid');

    if (selectMode) {
        if (btn) btn.textContent = 'Cancel';
        if (bar) bar.style.display = 'flex';
        if (grid) grid.classList.add('select-mode');
    } else {
        if (btn) btn.textContent = 'Select';
        if (bar) bar.style.display = 'none';
        if (grid) grid.classList.remove('select-mode');
        // Remove selected class from all photos
        $$('.photo-item.selected').forEach(el => el.classList.remove('selected'));
    }
    updateSelectionCount();
}

function togglePhotoSelection(id, el) {
    if (selectedPhotos.has(id)) {
        selectedPhotos.delete(id);
        el.classList.remove('selected');
    } else {
        selectedPhotos.add(id);
        el.classList.add('selected');
    }
    updateSelectionCount();
}

function updateSelectionCount() {
    const countEl = $('#selection-count');
    if (countEl) {
        countEl.textContent = `${selectedPhotos.size} selected`;
    }
}

async function bulkDelete() {
    if (selectedPhotos.size === 0) {
        alert('No photos selected');
        return;
    }

    if (!confirm(`Delete ${selectedPhotos.size} photos?`)) return;

    try {
        await api.delete('/api/v1/photos', { ids: Array.from(selectedPhotos) });
        alert(`Deleted ${selectedPhotos.size} photos`);
        toggleSelectMode();
        loadPhotos();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function bulkAddToAlbum() {
    if (selectedPhotos.size === 0) {
        alert('No photos selected');
        return;
    }

    try {
        const data = await api.get('/api/v1/albums');
        const albums = data.albums.filter(a => a.type === 'manual' || a.type === 'favorites');

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="album-select-modal">
                <h3>Add ${selectedPhotos.size} photos to album</h3>
                ${albums.length ? albums.map(a => `<div class="album-select-item" data-id="${a.id}">${a.name} (${a.photo_count})</div>`).join('') : '<p>No albums. Create one first.</p>'}
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.album-select-item').forEach(el => {
            el.onclick = async () => {
                try {
                    const result = await api.post(`/api/v1/albums/${el.dataset.id}/photos`, { photo_ids: Array.from(selectedPhotos) });
                    modal.remove();
                    alert(`Added ${result.added} photos to album`);
                    toggleSelectMode();
                } catch (err) {
                    alert('Error: ' + err.message);
                }
            };
        });
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function bulkRemoveFromAlbum() {
    if (selectedPhotos.size === 0) {
        alert('No photos selected');
        return;
    }

    if (!currentAlbumId) {
        alert('Not in album view');
        return;
    }

    if (!confirm(`Remove ${selectedPhotos.size} photos from album?`)) return;

    try {
        const result = await api.delete(`/api/v1/albums/${currentAlbumId}/photos`, { photo_ids: Array.from(selectedPhotos) });
        alert(`Removed ${result.removed} photos from album`);
        toggleSelectMode();
        renderAlbumView(currentAlbumId);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function bulkShare() {
    if (selectedPhotos.size === 0) {
        alert('No photos selected');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="bulk-share-modal">
            <h3>Share ${selectedPhotos.size} photos</h3>
            <div class="form-group">
                <label>Album name</label>
                <input type="text" id="bulk-share-name" placeholder="Shared photos" value="Shared ${new Date().toLocaleDateString('ru-RU')}">
            </div>
            <div class="form-group">
                <label>Password (optional)</label>
                <input type="text" id="bulk-share-password" placeholder="Leave empty for no password">
            </div>
            <div class="form-group">
                <label>Expires in days (optional)</label>
                <input type="number" id="bulk-share-expires" placeholder="Leave empty for no expiration" min="1">
            </div>
            <div id="bulk-share-result" style="display:none">
                <label>Share link:</label>
                <div class="share-url">
                    <input type="text" id="bulk-share-url" readonly>
                    <button onclick="navigator.clipboard.writeText($('#bulk-share-url').value); alert('Copied!')">Copy</button>
                </div>
            </div>
            <div class="buttons" id="bulk-share-buttons">
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button onclick="createBulkShare()">Create Share Link</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    $('#bulk-share-name').focus();
}

async function createBulkShare() {
    const name = $('#bulk-share-name').value.trim();
    const password = $('#bulk-share-password').value.trim() || null;
    const expiresDays = $('#bulk-share-expires').value ? parseInt($('#bulk-share-expires').value) : null;

    if (!name) {
        alert('Enter album name');
        return;
    }

    const btn = $('#bulk-share-buttons button:last-child');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        // 1. Create album
        const albumData = await api.post('/api/v1/albums', { name });
        const albumId = albumData.id;

        // 2. Add photos to album
        await api.post(`/api/v1/albums/${albumId}/photos`, { photo_ids: Array.from(selectedPhotos) });

        // 3. Create share link
        const shareBody = { type: 'album', album_id: albumId };
        if (password) shareBody.password = password;
        if (expiresDays) shareBody.expires_days = expiresDays;

        const shareData = await api.post('/api/v1/shares', shareBody);
        const url = location.origin + shareData.url;

        // Show result
        $('#bulk-share-result').style.display = 'block';
        $('#bulk-share-url').value = url;
        $('#bulk-share-buttons').innerHTML = `
            <button onclick="this.closest('.modal-overlay').remove(); toggleSelectMode();">Done</button>
        `;
    } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Create Share Link';
    }
}

async function showAddToAlbum(photoId) {
    try {
        const data = await api.get('/api/v1/albums');
        const albums = data.albums.filter(a => a.type === 'manual' || a.type === 'favorites');

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
                <div class="form-group">
                    <label>Password (optional)</label>
                    <input type="text" id="share-password" placeholder="Leave empty for no password">
                </div>
                <div class="form-group">
                    <label>Expires in days (optional)</label>
                    <input type="number" id="share-expires" placeholder="Leave empty for no expiration" min="1">
                </div>
                <div id="share-result" style="display:none">
                    <label>Share link:</label>
                    <div class="share-url">
                        <input type="text" id="share-url" readonly>
                        <button onclick="navigator.clipboard.writeText($('#share-url').value); alert('Copied!')">Copy</button>
                    </div>
                </div>
                <div class="buttons" id="share-buttons">
                    <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button onclick="createShare('${type}', '${id}')">Create Link</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function createShare(type, id) {
    const password = $('#share-password').value.trim() || null;
    const expiresDays = $('#share-expires').value ? parseInt($('#share-expires').value) : null;

    const btn = $('#share-buttons button:last-child');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const body = { type };
        if (type === 'photo') body.photo_id = id;
        else body.album_id = id;
        if (password) body.password = password;
        if (expiresDays) body.expires_days = expiresDays;

        const data = await api.post('/api/v1/shares', body);
        const url = location.origin + data.url;

        // Hide form, show result
        $('#share-password').parentElement.style.display = 'none';
        $('#share-expires').parentElement.style.display = 'none';
        $('#share-result').style.display = 'block';
        $('#share-url').value = url;
        $('#share-buttons').innerHTML = `
            <button onclick="this.closest('.modal-overlay').remove()">Done</button>
        `;
    } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Create Link';
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

            <div class="albums-header" id="places-header" style="display: none;">
                <h2>Places</h2>
            </div>
            <div class="albums-grid" id="places-grid"></div>
        </div>
    `);

    try {
        const data = await api.get('/api/v1/albums');
        const userAlbums = data.albums.filter(a => a.type === 'manual' || a.type === 'favorites');
        const placeAlbums = data.albums.filter(a => a.type === 'place');

        // User albums
        let albumsHtml = '';
        for (const album of userAlbums) {
            albumsHtml += `
                <div class="album-card" onclick="router.navigate('/albums/${album.id}')">
                    <div class="album-card-cover">
                        ${album.cover
                            ? `<img src="${API_BASE}${album.cover}" alt="">`
                            : (album.type === 'favorites' ? '⭐' : '📁')}
                    </div>
                    <div class="album-card-info">
                        <h3>${album.name}</h3>
                        <span>${album.photo_count} photos</span>
                    </div>
                </div>
            `;
        }
        html($('#albums-grid'), albumsHtml || 'No albums yet');

        // Place albums
        if (placeAlbums.length > 0) {
            $('#places-header').style.display = 'flex';
            let placesHtml = '';
            for (const album of placeAlbums) {
                placesHtml += `
                    <div class="album-card" onclick="router.navigate('/albums/${album.id}')">
                        <div class="album-card-cover">
                            ${album.cover
                                ? `<img src="${API_BASE}${album.cover}" alt="">`
                                : '📍'}
                        </div>
                        <div class="album-card-info">
                            <h3>${album.name}</h3>
                            <span>${album.photo_count} photos</span>
                        </div>
                    </div>
                `;
            }
            html($('#places-grid'), placesHtml);
        }
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
let currentAlbumId = null;
let currentAlbumType = null;

async function renderAlbumView(albumId) {
    // Reset select mode and infinite scroll state
    selectMode = false;
    selectedPhotos.clear();
    currentPhotos = [];
    isLoadingMore = false;
    hasMorePhotos = false;
    nextCursor = null;
    currentLoadContext = `album:${albumId}`;
    currentAlbumId = albumId;

    html($('#app'), renderHeader('albums') + `
        <div class="container">
            <div class="album-header" id="album-header">Loading...</div>
            <div class="selection-bar" id="selection-bar" style="display:none">
                <span id="selection-count">0 selected</span>
                <button onclick="bulkRemoveFromAlbum()">Remove from Album</button>
                <button onclick="bulkDelete()">Delete Photos</button>
                <button onclick="toggleSelectMode()">Cancel</button>
            </div>
            <div class="photo-grid" id="photo-grid">Loading...</div>
        </div>
    `);

    try {
        const data = await api.get(`/api/v1/albums/${albumId}`);
        const album = data.album;
        currentPhotos = data.photos;
        hasMorePhotos = data.has_more;
        nextCursor = data.next_cursor;
        currentAlbumType = album.type;

        html($('#album-header'), `
            <h2><a href="/albums" data-link class="back-link">←</a> ${album.name} (${album.photo_count})</h2>
            ${album.description ? `<p class="album-description">${album.description}</p>` : ''}
            <div class="album-actions">
                <button id="btn-select-mode" onclick="toggleSelectMode()">Select</button>
                ${album.type === 'manual' ? `<button onclick="showEditAlbumModal('${album.id}', '${album.name.replace(/'/g, "\\'")}', '${(album.description || '').replace(/'/g, "\\'")}')">Edit</button>` : ''}
                <button onclick="showShareModal('album', '${album.id}')">Share</button>
                ${album.type === 'manual' ? `<button onclick="deleteAlbum('${album.id}')" class="btn-danger">Delete</button>` : ''}
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
            el.onclick = () => {
                if (selectMode) {
                    togglePhotoSelection(el.dataset.id, el);
                } else {
                    openPhotoModal(parseInt(el.dataset.index));
                }
            };
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

function showEditAlbumModal(albumId, currentName, currentDescription) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="edit-album-modal">
            <h3>Edit Album</h3>
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="edit-album-name" value="${currentName}">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="edit-album-description" rows="3" placeholder="Optional description">${currentDescription}</textarea>
            </div>
            <div class="form-group">
                <label>Cover Photo</label>
                <div class="cover-selection">
                    <span id="cover-status">Current cover will be kept</span>
                    <button type="button" onclick="selectAlbumCover('${albumId}')">Choose from album</button>
                </div>
                <input type="hidden" id="edit-album-cover" value="">
            </div>
            <div class="buttons">
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button onclick="saveAlbumChanges('${albumId}')">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    $('#edit-album-name').focus();
}

async function saveAlbumChanges(albumId) {
    const name = $('#edit-album-name').value.trim();
    const description = $('#edit-album-description').value.trim();
    const coverPhotoId = $('#edit-album-cover').value;

    if (!name) {
        alert('Name is required');
        return;
    }

    try {
        const body = { name };
        if (description) body.description = description;
        else body.description = null;
        if (coverPhotoId) body.cover_photo_id = coverPhotoId;

        await api.patch(`/api/v1/albums/${albumId}`, body);
        $('.modal-overlay').remove();
        renderAlbumView(albumId);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function selectAlbumCover(albumId) {
    // Close edit modal temporarily
    const editModal = $('.edit-album-modal');
    const name = $('#edit-album-name').value;
    const description = $('#edit-album-description').value;

    $('.modal-overlay').remove();

    // Show cover selection modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="cover-select-modal">
            <h3>Select Cover Photo</h3>
            <p>Click on a photo to set it as album cover</p>
            <div class="cover-photo-grid" id="cover-photo-grid">Loading...</div>
            <div class="buttons">
                <button onclick="cancelCoverSelection('${albumId}', '${name.replace(/'/g, "\\'")}', '${description.replace(/'/g, "\\'")}')">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Populate with current photos
    const grid = $('#cover-photo-grid');
    let gridHtml = '';
    for (const photo of currentPhotos) {
        gridHtml += `
            <div class="cover-photo-item" onclick="setCoverPhoto('${albumId}', '${photo.id}', '${name.replace(/'/g, "\\'")}', '${description.replace(/'/g, "\\'")}')">
                <img src="${API_BASE}${photo.small}" alt="">
            </div>
        `;
    }
    grid.innerHTML = gridHtml || 'No photos in album';
}

function cancelCoverSelection(albumId, name, description) {
    $('.modal-overlay').remove();
    showEditAlbumModal(albumId, name, description);
}

function setCoverPhoto(albumId, photoId, name, description) {
    $('.modal-overlay').remove();
    showEditAlbumModal(albumId, name, description);

    // Set the cover photo ID and update status
    setTimeout(() => {
        $('#edit-album-cover').value = photoId;
        $('#cover-status').textContent = 'New cover selected';
        $('#cover-status').style.color = '#0a0';
    }, 50);
}

// Map with MapLibre GL JS + coordinate-based clustering
let mapInstance = null;
let mapMarkersMap = new Map();  // key -> marker, for efficient updates
let clusterGalleryBounds = null;
let clusterGalleryPhotos = [];
let clusterGalleryHasMore = false;
let clusterGalleryCursor = null;

async function renderMap() {
    // Cleanup previous map instance
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
    }
    mapMarkersMap.clear();

    html($('#app'), renderHeader('map') + `
        <div class="map-container">
            <div id="map"></div>
            <div class="map-loading" id="map-loading">Loading map...</div>
            <div class="map-info" id="map-info"></div>
        </div>
    `);

    try {
        // Get initial bounds to center map
        const boundsData = await api.get('/api/v1/map/bounds');

        if (boundsData.total === 0) {
            html($('#map-loading'), 'No photos with GPS data');
            return;
        }

        // Calculate center from bounds
        const center = [
            (boundsData.bounds.e + boundsData.bounds.w) / 2,
            (boundsData.bounds.n + boundsData.bounds.s) / 2
        ];

        // Initialize MapLibre with simple Positron style (light, fast)
        mapInstance = new maplibregl.Map({
            container: 'map',
            style: 'https://tiles.openfreemap.org/styles/positron',
            center: center,
            zoom: 4,
            maxZoom: 18,
            renderWorldCopies: false  // Prevent infinite horizontal scrolling
        });

        // Add navigation controls
        mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

        // Wait for map to load
        mapInstance.on('load', async () => {
            $('#map-loading').style.display = 'none';

            // Load initial clusters
            await loadMapClusters();

            // Update info
            updateMapInfo(boundsData.total);
        });

        // Reload clusters on map move/zoom (debounced)
        let moveTimeout = null;
        mapInstance.on('moveend', () => {
            clearTimeout(moveTimeout);
            moveTimeout = setTimeout(loadMapClusters, 300);
        });

    } catch (err) {
        html($('#map-loading'), `Error: ${err.message}`);
    }
}

async function loadMapClusters() {
    if (!mapInstance) return;

    const bounds = mapInstance.getBounds();
    const zoom = Math.floor(mapInstance.getZoom());

    // Normalize coordinates to valid range (MapLibre can return values outside -180/180)
    const north = Math.min(Math.max(bounds.getNorth(), -90), 90);
    const south = Math.min(Math.max(bounds.getSouth(), -90), 90);
    let east = bounds.getEast();
    let west = bounds.getWest();

    // Wrap longitude to -180/180 range
    while (east > 180) east -= 360;
    while (east < -180) east += 360;
    while (west > 180) west -= 360;
    while (west < -180) west += 360;

    // If view spans more than 360 degrees, just use full range
    if (bounds.getEast() - bounds.getWest() >= 360) {
        east = 180;
        west = -180;
    }

    try {
        const data = await api.get(
            `/api/v1/map/clusters?north=${north}&south=${south}` +
            `&east=${east}&west=${west}&zoom=${zoom}`
        );

        // Build map of new clusters by key
        const newClusters = new Map();
        for (const cluster of data.clusters) {
            const key = `${cluster.lat.toFixed(6)},${cluster.lon.toFixed(6)},${cluster.preview_id}`;
            newClusters.set(key, cluster);
        }

        // Remove markers that are no longer needed
        const toRemove = [];
        for (const [key, marker] of mapMarkersMap) {
            if (!newClusters.has(key)) {
                marker.remove();
                toRemove.push(key);
            }
        }
        toRemove.forEach(key => mapMarkersMap.delete(key));

        // Add new markers (only if they don't exist)
        for (const [key, cluster] of newClusters) {
            if (!mapMarkersMap.has(key)) {
                const el = createMarkerElement(cluster);

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([cluster.lon, cluster.lat])
                    .addTo(mapInstance);

                // Click handler
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (cluster.photo_id) {
                        openSinglePhoto(cluster.photo_id);
                    } else {
                        openClusterGallery(cluster.bounds, cluster.count);
                    }
                });

                mapMarkersMap.set(key, marker);
            }
        }

        updateMapInfo(data.total);

    } catch (err) {
        console.error('Failed to load clusters:', err);
    }
}

function createMarkerElement(cluster) {
    const el = document.createElement('div');

    if (cluster.count === 1) {
        // Single photo marker
        el.className = 'photo-marker';
        el.innerHTML = `<img src="${API_BASE}${cluster.preview}" alt="">`;
    } else {
        // Cluster marker
        el.className = 'cluster-marker';
        el.innerHTML = `
            <img src="${API_BASE}${cluster.preview}" alt="">
            <span class="count">${cluster.count > 99 ? '99+' : cluster.count}</span>
        `;
    }

    return el;
}

function updateMapInfo(total) {
    const info = $('#map-info');
    if (info) {
        info.textContent = `${total.toLocaleString()} photos with location`;
    }
}

async function openSinglePhoto(photoId) {
    try {
        // Fetch photo details and find its index
        const photo = await api.get(`/api/v1/photos/${photoId}`);

        // Create a minimal photo list for the modal
        currentPhotos = [{
            id: photo.id,
            type: photo.type,
            blurhash: photo.blurhash,
            small: photo.urls.small,
            w: photo.width,
            h: photo.height,
            taken_at: photo.taken_at,
            is_favorite: photo.is_favorite,
            duration: photo.duration_sec
        }];

        openPhotoModal(0);
    } catch (err) {
        console.error('Failed to open photo:', err);
    }
}

async function openClusterGallery(bounds, count) {
    // Remove existing gallery if any
    const existing = $('#cluster-gallery');
    if (existing) existing.remove();

    clusterGalleryBounds = bounds;
    clusterGalleryPhotos = [];
    clusterGalleryHasMore = false;
    clusterGalleryCursor = null;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'cluster-gallery-overlay';
    overlay.id = 'cluster-gallery';
    overlay.innerHTML = `
        <div class="cluster-gallery-header">
            <h3>${count} photos in this area</h3>
            <button class="close-btn" onclick="closeClusterGallery()">&times;</button>
        </div>
        <div class="cluster-gallery-content">
            <div class="cluster-gallery-grid" id="cluster-gallery-grid">
                <div class="cluster-gallery-load-more">Loading...</div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close on escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeClusterGallery();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Load photos
    await loadClusterGalleryPhotos();
}

async function loadClusterGalleryPhotos() {
    const grid = $('#cluster-gallery-grid');
    if (!grid) return;

    try {
        let url = `/api/v1/photos?north=${clusterGalleryBounds.n}&south=${clusterGalleryBounds.s}` +
                  `&east=${clusterGalleryBounds.e}&west=${clusterGalleryBounds.w}&limit=50`;

        if (clusterGalleryCursor) {
            url += `&cursor=${clusterGalleryCursor}`;
        }

        const data = await api.get(url);

        clusterGalleryHasMore = data.has_more;
        clusterGalleryCursor = data.next_cursor;

        // Remove loading indicator
        const loading = grid.querySelector('.cluster-gallery-load-more');
        if (loading && clusterGalleryPhotos.length === 0) {
            loading.remove();
        }

        // Add photos to gallery
        const startIndex = clusterGalleryPhotos.length;
        clusterGalleryPhotos.push(...data.photos);

        for (let i = 0; i < data.photos.length; i++) {
            const photo = data.photos[i];
            const index = startIndex + i;

            const item = document.createElement('div');
            item.className = `cluster-gallery-item ${photo.type === 'video' ? 'video' : ''}`;
            item.innerHTML = `<img src="${API_BASE}${photo.small}" loading="lazy" alt="">`;
            item.onclick = () => openClusterPhoto(index);

            grid.appendChild(item);
        }

        // Add load more button if needed
        if (clusterGalleryHasMore) {
            const existing = grid.querySelector('.cluster-gallery-load-more');
            if (existing) existing.remove();

            const loadMore = document.createElement('div');
            loadMore.className = 'cluster-gallery-load-more';
            loadMore.innerHTML = '<button onclick="loadClusterGalleryPhotos()">Load more</button>';
            grid.appendChild(loadMore);
        }

    } catch (err) {
        console.error('Failed to load cluster photos:', err);
        grid.innerHTML = `<div class="cluster-gallery-load-more">Error: ${err.message}</div>`;
    }
}

function openClusterPhoto(index) {
    // Set current photos from cluster gallery
    currentPhotos = clusterGalleryPhotos;

    // Close cluster gallery
    const gallery = $('#cluster-gallery');
    if (gallery) gallery.style.display = 'none';

    // Open photo modal
    openPhotoModal(index);
}

function closeClusterGallery() {
    const gallery = $('#cluster-gallery');
    if (gallery) {
        gallery.remove();
    }
    clusterGalleryPhotos = [];
    clusterGalleryBounds = null;
}

// Override close modal to reopen cluster gallery if it was open
const originalClosePhotoModal = typeof closePhotoModal === 'function' ? closePhotoModal : null;

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
        const [scanner, processor, places] = await Promise.all([
            api.get('/api/v1/sync/scanner/status'),
            api.get('/api/v1/sync/processor/status'),
            api.get('/api/v1/sync/places/api/v1/status')
        ]);

        const lastRun = places.last_run;
        const lastRunTime = lastRun?.started_at ? new Date(lastRun.started_at).toLocaleString() : 'Never';

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

            <div class="sync-section">
                <h3>Places</h3>
                <div class="sync-row"><span>Status:</span> <span>${places.status}</span></div>
                <div class="sync-row"><span>Pending photos:</span> <span>${places.pending_count || 0}</span></div>
                <div class="sync-row"><span>Last run:</span> <span>${lastRunTime}</span></div>
                <div class="sync-row"><span>Photos processed:</span> <span>${lastRun?.photos_processed || 0}</span></div>
                <div class="sync-row"><span>Places created:</span> <span>${lastRun?.places_created || 0}</span></div>
                <div class="sync-row"><span>Nominatim requests:</span> <span>${lastRun?.nominatim_requests || 0}</span></div>
                <div class="sync-row"><span>Errors:</span> <span>${lastRun?.errors || 0}</span></div>
                <div class="sync-actions">
                    <button onclick="triggerPlacesRun()">🔄 Run Now</button>
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

async function triggerPlacesRun() {
    try {
        await api.post('/api/v1/sync/places/api/v1/run');
        alert('Places run triggered');
        refreshSync();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Share View (public)
let shareCode = null;
let sharePassword = null;
let sharePhotos = [];
let shareHasMore = false;
let shareNextCursor = null;
let shareIsLoading = false;

async function renderShare(code) {
    // Reset state
    shareCode = code;
    sharePassword = new URLSearchParams(location.search).get('password') || null;
    sharePhotos = [];
    shareHasMore = false;
    shareNextCursor = null;
    shareIsLoading = false;

    html($('#app'), `
        <div class="share-page">
            <h1>Imgable</h1>
            <div id="share-content">Loading...</div>
        </div>
    `);

    try {
        let url = `${API_BASE}/s/${code}`;
        if (sharePassword) url += `?password=${encodeURIComponent(sharePassword)}`;

        const res = await fetch(url);
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
            let photoUrl = `${API_BASE}${data.photo.urls.large}`;
            if (sharePassword) {
                photoUrl += (photoUrl.includes('?') ? '&' : '?') + `password=${encodeURIComponent(sharePassword)}`;
            }
            html($('#share-content'), `
                <img src="${photoUrl}" style="max-width: 90vw; max-height: 80vh;">
            `);
        } else {
            // Album with infinite scroll
            sharePhotos = data.photos;
            shareHasMore = data.has_more;
            shareNextCursor = data.next_cursor;

            html($('#share-content'), `
                <h2>${data.album.name} (${data.album.photo_count} photos)</h2>
                <div class="photo-grid" id="share-photo-grid" style="max-width: 800px; margin: 20px auto;"></div>
            `);

            renderSharePhotos(sharePhotos);
            setupShareInfiniteScroll();
        }
    } catch (err) {
        html($('#share-content'), `Error: ${err.message}`);
    }
}

function renderSharePhotos(photos, startIndex = 0) {
    const grid = $('#share-photo-grid');
    if (!grid) return;

    for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const index = startIndex + i;
        const div = document.createElement('div');
        div.className = `photo-item ${photo.type === 'video' ? 'video' : ''}`;
        div.dataset.index = index;
        // Add password to image URL if needed
        let imgUrl = `${API_BASE}${photo.small}`;
        if (sharePassword) {
            imgUrl += `&password=${encodeURIComponent(sharePassword)}`;
        }
        div.innerHTML = `<img src="${imgUrl}" loading="lazy" alt="">`;
        div.onclick = () => openSharePhotoModal(index);
        grid.appendChild(div);
    }
}

function openSharePhotoModal(index) {
    const photo = sharePhotos[index];
    if (!photo) return;

    // Build large/video URL
    let mediaUrl;
    if (photo.type === 'video') {
        mediaUrl = `${API_BASE}/s/${shareCode}/photo/video?id=${photo.id}`;
    } else {
        mediaUrl = `${API_BASE}/s/${shareCode}/photo/large?id=${photo.id}`;
    }
    if (sharePassword) {
        mediaUrl += `&password=${encodeURIComponent(sharePassword)}`;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'share-photo-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <span>${index + 1} / ${sharePhotos.length}</span>
            <button class="close-btn" onclick="closeSharePhotoModal()">×</button>
        </div>
        <div class="modal-content">
            ${index > 0 ? '<button class="modal-nav prev" onclick="navSharePhoto(-1)">‹</button>' : ''}
            ${photo.type === 'video'
                ? `<video src="${mediaUrl}" controls autoplay></video>`
                : `<img src="${mediaUrl}" alt="">`
            }
            ${index < sharePhotos.length - 1 ? '<button class="modal-nav next" onclick="navSharePhoto(1)">›</button>' : ''}
        </div>
    `;
    document.body.appendChild(modal);

    // Store current index for navigation
    modal.dataset.currentIndex = index;

    modal.onclick = (e) => { if (e.target === modal) closeSharePhotoModal(); };
    document.onkeydown = (e) => {
        if (e.key === 'Escape') closeSharePhotoModal();
        if (e.key === 'ArrowLeft') navSharePhoto(-1);
        if (e.key === 'ArrowRight') navSharePhoto(1);
    };
}

function closeSharePhotoModal() {
    const modal = $('#share-photo-modal');
    if (modal) modal.remove();
    document.onkeydown = null;
}

function navSharePhoto(dir) {
    const modal = $('#share-photo-modal');
    if (!modal) return;
    const currentIndex = parseInt(modal.dataset.currentIndex);
    const newIndex = currentIndex + dir;
    if (newIndex >= 0 && newIndex < sharePhotos.length) {
        closeSharePhotoModal();
        openSharePhotoModal(newIndex);
    }
}

function setupShareInfiniteScroll() {
    const checkScroll = () => {
        if (shareIsLoading || !shareHasMore || !shareNextCursor) return;

        const scrollY = window.scrollY;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const threshold = 1500;

        if (documentHeight - (scrollY + windowHeight) < threshold) {
            loadMoreSharePhotos();
        }
    };

    window.removeEventListener('scroll', window._shareScrollHandler);
    window._shareScrollHandler = () => {
        requestAnimationFrame(checkScroll);
    };
    window.addEventListener('scroll', window._shareScrollHandler, { passive: true });

    // Check immediately in case viewport is tall
    setTimeout(checkScroll, 100);
}

async function loadMoreSharePhotos() {
    if (shareIsLoading || !shareHasMore || !shareNextCursor) return;

    shareIsLoading = true;

    try {
        let url = `${API_BASE}/s/${shareCode}?cursor=${shareNextCursor}`;
        if (sharePassword) url += `&password=${encodeURIComponent(sharePassword)}`;

        const res = await fetch(url);
        const data = await res.json();

        if (res.ok && data.photos) {
            const startIndex = sharePhotos.length;
            sharePhotos = [...sharePhotos, ...data.photos];
            shareHasMore = data.has_more;
            shareNextCursor = data.next_cursor;
            renderSharePhotos(data.photos, startIndex);
        }
    } catch (err) {
        console.error('Failed to load more photos:', err);
    } finally {
        shareIsLoading = false;
    }
}

async function submitSharePassword(e, code) {
    e.preventDefault();
    const password = $('#share-password').value;
    try {
        const res = await fetch(`${API_BASE}/s/${code}?password=${encodeURIComponent(password)}`);
        if (res.ok) {
            // Save password and re-render the share page
            sharePassword = password;
            const newUrl = `${location.pathname}?password=${encodeURIComponent(password)}`;
            history.replaceState(null, '', newUrl);
            renderShare(code);
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

// Shares Management Page
async function renderShares() {
    html($('#app'), renderHeader('shares') + `
        <div class="container">
            <h2>Shared Links</h2>
            <div class="shares-list" id="shares-list">Loading...</div>
        </div>
    `);

    await loadShares();
}

async function loadShares() {
    try {
        const data = await api.get('/api/v1/shares');
        const shares = data.shares;

        if (shares.length === 0) {
            html($('#shares-list'), '<p class="empty-message">No shared links yet. Share photos or albums from the gallery.</p>');
            return;
        }

        let listHtml = '<div class="shares-grid">';
        for (const share of shares) {
            const url = location.origin + share.url;
            const createdDate = formatDate(share.created_at);
            const expiresText = share.expires_at
                ? `Expires: ${formatDate(share.expires_at)}`
                : 'No expiration';
            const isExpired = share.expires_at && share.expires_at * 1000 < Date.now();

            listHtml += `
                <div class="share-card ${isExpired ? 'expired' : ''}" data-id="${share.id}">
                    <div class="share-card-header">
                        <span class="share-type">${share.type === 'photo' ? 'Photo' : 'Album'}</span>
                        ${share.has_password ? '<span class="share-badge">Password</span>' : ''}
                        ${isExpired ? '<span class="share-badge expired">Expired</span>' : ''}
                    </div>
                    <div class="share-card-url">
                        <input type="text" value="${url}" readonly onclick="this.select()">
                        <button onclick="navigator.clipboard.writeText('${url}'); alert('Copied!')">Copy</button>
                    </div>
                    <div class="share-card-meta">
                        <span>Views: ${share.view_count}</span>
                        <span>${expiresText}</span>
                    </div>
                    <div class="share-card-meta">
                        <span>Created: ${createdDate}</span>
                    </div>
                    <div class="share-card-actions">
                        <a href="${share.url}" target="_blank" class="btn-open">Open</a>
                        <button onclick="deleteShare('${share.id}')" class="btn-delete">Delete</button>
                    </div>
                </div>
            `;
        }
        listHtml += '</div>';

        html($('#shares-list'), listHtml);
    } catch (err) {
        html($('#shares-list'), `<p class="error">Error: ${err.message}</p>`);
    }
}

async function deleteShare(id) {
    if (!confirm('Delete this share link? Anyone with the link will no longer have access.')) return;

    try {
        await api.delete(`/api/v1/shares/${id}`);
        loadShares();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Stats Page
async function renderStats() {
    html($('#app'), renderHeader('stats') + `
        <div class="container">
            <h2>Statistics</h2>
            <div class="stats-content" id="stats-content">Loading...</div>
        </div>
    `);

    try {
        const data = await api.get('/api/v1/stats');

        const oldestDate = data.dates.oldest ? formatDate(data.dates.oldest) : 'N/A';
        const newestDate = data.dates.newest ? formatDate(data.dates.newest) : 'N/A';

        html($('#stats-content'), `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">📷</div>
                    <div class="stat-value">${data.total_photos.toLocaleString()}</div>
                    <div class="stat-label">Photos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🎬</div>
                    <div class="stat-value">${data.total_videos.toLocaleString()}</div>
                    <div class="stat-label">Videos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">📁</div>
                    <div class="stat-value">${data.total_albums.toLocaleString()}</div>
                    <div class="stat-label">Albums</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">📍</div>
                    <div class="stat-value">${data.total_places.toLocaleString()}</div>
                    <div class="stat-label">Places</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⭐</div>
                    <div class="stat-value">${data.total_favorites.toLocaleString()}</div>
                    <div class="stat-label">Favorites</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💾</div>
                    <div class="stat-value">${data.storage.human}</div>
                    <div class="stat-label">Storage Used</div>
                </div>
            </div>
            <div class="stats-dates">
                <h3>Photo Timeline</h3>
                <div class="dates-range">
                    <div class="date-item">
                        <span class="date-label">Oldest photo:</span>
                        <span class="date-value">${oldestDate}</span>
                    </div>
                    <div class="date-item">
                        <span class="date-label">Newest photo:</span>
                        <span class="date-value">${newestDate}</span>
                    </div>
                </div>
            </div>
        `);
    } catch (err) {
        html($('#stats-content'), `<p class="error">Error: ${err.message}</p>`);
    }
}

// =============================================================================
// People Page - AI Face Recognition
// =============================================================================

// Random placeholder names for unnamed persons
const UNKNOWN_PLACEHOLDERS = [
    "Who's This?", "Someone", "Do I Know You?", "Name?",
    "You Look Familiar", "Have We Met?", "Wait, Who?",
    "New Here?", "Ring Any Bells?", "Seen You Before"
];

function getUnknownPlaceholder(personId) {
    // Use person ID to get consistent placeholder per person
    const hash = personId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return UNKNOWN_PLACEHOLDERS[hash % UNKNOWN_PLACEHOLDERS.length];
}

function formatPersonName(person) {
    if (person.name_source === 'manual') {
        return person.name;
    }
    return getUnknownPlaceholder(person.id);
}

function formatGroupNames(names, personIds) {
    const formatted = names.map((name, i) => {
        if (name && !name.startsWith('Unknown ')) {
            return name;
        }
        return null; // Unknown person
    });

    const known = formatted.filter(n => n !== null);
    const unknownCount = formatted.filter(n => n === null).length;

    if (known.length === 0) {
        return `${unknownCount} people`;
    }
    if (unknownCount === 0) {
        return known.join(', ');
    }
    return `${known.join(', ')} and ${unknownCount} other${unknownCount > 1 ? 's' : ''}`;
}

// People state
let peopleOffset = 0;
let peopleTotal = 0;
let groupsOffset = 0;
let groupsTotal = 0;
const PEOPLE_LIMIT = 15;

// Person view state
let currentPersonId = null;
let currentPersonPhotos = [];
let personNextCursor = null;
let personHasMore = false;
let personLoadingMore = false;
let viewingHidden = false;

// Group view state
let currentGroupIds = null;

async function renderPeople() {
    peopleOffset = 0;
    groupsOffset = 0;

    html($('#app'), renderHeader('people') + `
        <div class="container">
            <div class="people-section">
                <div class="section-header">
                    <h2>People</h2>
                    <span class="section-count" id="people-count"></span>
                </div>
                <div class="people-grid" id="people-grid">Loading...</div>
                <button class="load-more-btn" id="load-more-people" style="display:none" onclick="loadMorePeople()">Load More</button>
            </div>

            <div class="people-section" id="groups-section" style="display:none">
                <div class="section-header">
                    <h2>Together</h2>
                    <span class="section-count" id="groups-count"></span>
                </div>
                <div class="people-grid groups-grid" id="groups-grid"></div>
                <button class="load-more-btn" id="load-more-groups" style="display:none" onclick="loadMoreGroups()">Load More</button>
            </div>
        </div>
    `);

    await loadPeople();
    await loadGroups();
}

async function loadPeople() {
    try {
        const data = await api.get(`/api/v1/people?limit=${PEOPLE_LIMIT}&offset=${peopleOffset}`);
        peopleTotal = data.total;

        $('#people-count').textContent = `(${peopleTotal})`;

        if (peopleOffset === 0) {
            html($('#people-grid'), '');
        }

        if (data.people.length === 0 && peopleOffset === 0) {
            html($('#people-grid'), '<p class="empty-message">No people detected yet. Upload photos and wait for AI processing.</p>');
            return;
        }

        let peopleHtml = '';
        for (const person of data.people) {
            const displayName = formatPersonName(person);
            const isUnknown = person.name_source !== 'manual';

            peopleHtml += `
                <div class="person-card" onclick="router.navigate('/people/${person.id}')">
                    <div class="person-avatar ${isUnknown ? 'unknown' : ''}">
                        ${person.face_url
                            ? `<img src="${API_BASE}${person.face_url}" alt="" style="${person.face_box ? getFaceCropStyle(person.face_box) : ''}">`
                            : '👤'}
                    </div>
                    <div class="person-info">
                        <span class="person-name ${isUnknown ? 'unknown' : ''}">${displayName}</span>
                        <span class="person-count">${person.photo_count} photos</span>
                    </div>
                </div>
            `;
        }

        $('#people-grid').innerHTML += peopleHtml;
        peopleOffset += data.people.length;

        $('#load-more-people').style.display = data.has_more ? 'block' : 'none';
    } catch (err) {
        html($('#people-grid'), `<p class="error">Error: ${err.message}</p>`);
    }
}

async function loadMorePeople() {
    await loadPeople();
}

async function loadGroups() {
    try {
        const data = await api.get(`/api/v1/people/groups?limit=${PEOPLE_LIMIT}&offset=${groupsOffset}`);
        groupsTotal = data.total;

        if (data.groups.length === 0 && groupsOffset === 0) {
            return; // No groups, hide section
        }

        $('#groups-section').style.display = 'block';
        $('#groups-count').textContent = `(${groupsTotal})`;

        if (groupsOffset === 0) {
            html($('#groups-grid'), '');
        }

        let groupsHtml = '';
        for (const group of data.groups) {
            const displayName = formatGroupNames(group.names, group.person_ids);
            const idsParam = group.person_ids.join(',');

            groupsHtml += `
                <div class="group-card" onclick="router.navigate('/people/group?ids=${idsParam}')">
                    <div class="group-avatars">
                        ${group.face_urls.slice(0, 3).map(url =>
                            url ? `<img src="${API_BASE}${url}" alt="">` : '<span class="no-face">👤</span>'
                        ).join('')}
                        ${group.person_ids.length > 3 ? `<span class="more-faces">+${group.person_ids.length - 3}</span>` : ''}
                    </div>
                    <div class="group-info">
                        <span class="group-name">${displayName}</span>
                        <span class="group-count">${group.photo_count} photos</span>
                    </div>
                </div>
            `;
        }

        $('#groups-grid').innerHTML += groupsHtml;
        groupsOffset += data.groups.length;

        $('#load-more-groups').style.display = data.has_more ? 'block' : 'none';
    } catch (err) {
        console.error('Failed to load groups:', err);
    }
}

async function loadMoreGroups() {
    await loadGroups();
}

function getFaceCropStyle(box) {
    // Calculate transform to center and zoom on face
    const scale = 1 / Math.max(box.w, box.h) * 0.8;
    const translateX = (0.5 - (box.x + box.w / 2)) * 100;
    const translateY = (0.5 - (box.y + box.h / 2)) * 100;
    return `transform: scale(${scale}) translate(${translateX}%, ${translateY}%);`;
}

// =============================================================================
// Person View
// =============================================================================

async function renderPersonView(personId) {
    currentPersonId = personId;
    currentPersonPhotos = [];
    personNextCursor = null;
    personHasMore = false;
    viewingHidden = false;

    html($('#app'), renderHeader('people') + `
        <div class="container">
            <div class="person-header" id="person-header">Loading...</div>
            <div class="person-tabs">
                <button class="tab-btn active" id="tab-photos" onclick="switchPersonTab('photos')">Photos</button>
                <button class="tab-btn" id="tab-hidden" onclick="switchPersonTab('hidden')">Hidden</button>
                <button class="tab-btn" id="tab-faces" onclick="switchPersonTab('faces')">Faces</button>
            </div>
            <div class="photo-grid" id="person-photos">Loading...</div>
            <div class="loading-more" id="loading-more" style="display:none">Loading more...</div>
        </div>
    `);

    try {
        const person = await api.get(`/api/v1/people/${personId}`);
        renderPersonHeader(person);
        await loadPersonPhotos();
        setupPersonInfiniteScroll();
    } catch (err) {
        html($('#person-header'), `<p class="error">Error: ${err.message}</p>`);
    }
}

function renderPersonHeader(person) {
    const displayName = formatPersonName(person);
    const isUnknown = person.name_source !== 'manual';

    html($('#person-header'), `
        <div class="person-header-content">
            <button class="back-btn" onclick="router.navigate('/people')">← Back</button>
            <div class="person-header-info">
                <div class="person-avatar-large ${isUnknown ? 'unknown' : ''}">
                    ${person.face_url
                        ? `<img src="${API_BASE}${person.face_url}" alt="" style="${person.face_box ? getFaceCropStyle(person.face_box) : ''}">`
                        : '👤'}
                </div>
                <div>
                    <h2 class="${isUnknown ? 'unknown-name' : ''}">${displayName}</h2>
                    <p>${person.photo_count} photos · ${person.faces_count} face${person.faces_count !== 1 ? 's' : ''}</p>
                </div>
            </div>
            <div class="person-actions">
                <button onclick="showRenamePersonModal('${person.id}', '${person.name.replace(/'/g, "\\'")}')">✏️ Rename</button>
                <button onclick="showMergePersonModal('${person.id}')">🔗 Merge</button>
                <button onclick="showPersonFaces('${person.id}')">👤 Faces</button>
                <button class="danger" onclick="deletePerson('${person.id}')">🗑️ Delete</button>
            </div>
        </div>
    `);
}

async function loadPersonPhotos() {
    const endpoint = viewingHidden
        ? `/api/v1/people/${currentPersonId}/photos/hidden`
        : `/api/v1/people/${currentPersonId}/photos`;

    const url = personNextCursor
        ? `${endpoint}?limit=100&cursor=${personNextCursor}`
        : `${endpoint}?limit=100`;

    try {
        const data = await api.get(url);

        if (personNextCursor === null) {
            currentPersonPhotos = data.photos;
        } else {
            currentPersonPhotos = [...currentPersonPhotos, ...data.photos];
        }

        personNextCursor = data.next_cursor || null;
        personHasMore = data.has_more;

        renderPersonPhotos();
    } catch (err) {
        html($('#person-photos'), `<p class="error">Error: ${err.message}</p>`);
    }
}

function renderPersonPhotos() {
    if (currentPersonPhotos.length === 0) {
        html($('#person-photos'), `<p class="empty-message">${viewingHidden ? 'No hidden photos' : 'No photos'}</p>`);
        return;
    }

    let photosHtml = '';
    for (let i = 0; i < currentPersonPhotos.length; i++) {
        const photo = currentPersonPhotos[i];
        photosHtml += `
            <div class="photo-item" onclick="openPersonPhoto(${i})">
                <img src="${API_BASE}${photo.small}" alt="" loading="lazy">
                ${photo.is_favorite ? '<span class="favorite-badge">⭐</span>' : ''}
                ${photo.duration ? `<span class="duration-badge">${formatDuration(photo.duration)}</span>` : ''}
            </div>
        `;
    }

    html($('#person-photos'), photosHtml);
}

function setupPersonInfiniteScroll() {
    window.onscroll = async () => {
        if (personLoadingMore || !personHasMore) return;

        const scrollPos = window.innerHeight + window.scrollY;
        const threshold = document.body.offsetHeight - 500;

        if (scrollPos >= threshold) {
            personLoadingMore = true;
            $('#loading-more').style.display = 'block';

            await loadPersonPhotos();

            $('#loading-more').style.display = 'none';
            personLoadingMore = false;
        }
    };
}

async function switchPersonTab(tab) {
    $$('.tab-btn').forEach(btn => btn.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');

    if (tab === 'photos') {
        viewingHidden = false;
        $('#person-photos').style.display = 'grid';
        personNextCursor = null;
        await loadPersonPhotos();
    } else if (tab === 'hidden') {
        viewingHidden = true;
        $('#person-photos').style.display = 'grid';
        personNextCursor = null;
        await loadPersonPhotos();
    } else if (tab === 'faces') {
        await showPersonFaces(currentPersonId);
    }
}

function openPersonPhoto(index) {
    currentPhotos = currentPersonPhotos;
    openPhotoModal(index);
}

// =============================================================================
// Group View
// =============================================================================

async function renderGroupView() {
    const params = new URLSearchParams(location.search);
    const ids = params.get('ids');

    if (!ids) {
        router.navigate('/people');
        return;
    }

    currentGroupIds = ids.split(',');
    currentPersonPhotos = [];
    personNextCursor = null;
    personHasMore = false;
    viewingHidden = false;

    html($('#app'), renderHeader('people') + `
        <div class="container">
            <div class="group-header" id="group-header">Loading...</div>
            <div class="person-tabs">
                <button class="tab-btn active" id="tab-photos" onclick="switchGroupTab('photos')">Photos</button>
                <button class="tab-btn" id="tab-hidden" onclick="switchGroupTab('hidden')">Hidden</button>
            </div>
            <div class="photo-grid" id="person-photos">Loading...</div>
            <div class="loading-more" id="loading-more" style="display:none">Loading more...</div>
        </div>
    `);

    try {
        // Get person names
        const names = [];
        for (const id of currentGroupIds) {
            const person = await api.get(`/api/v1/people/${id}`);
            names.push(person.name_source === 'manual' ? person.name : null);
        }

        const displayName = formatGroupNames(names, currentGroupIds);

        html($('#group-header'), `
            <div class="person-header-content">
                <button class="back-btn" onclick="router.navigate('/people')">← Back</button>
                <div class="person-header-info">
                    <div class="group-avatars-large">
                        ${currentGroupIds.slice(0, 3).map(() => '<span>👤</span>').join('')}
                    </div>
                    <div>
                        <h2>${displayName}</h2>
                        <p>Photos together</p>
                    </div>
                </div>
            </div>
        `);

        await loadGroupPhotos();
        setupPersonInfiniteScroll();
    } catch (err) {
        html($('#group-header'), `<p class="error">Error: ${err.message}</p>`);
    }
}

async function loadGroupPhotos() {
    const idsParam = currentGroupIds.join(',');
    const endpoint = viewingHidden
        ? `/api/v1/people/groups/photos/hidden?ids=${idsParam}`
        : `/api/v1/people/groups/photos?ids=${idsParam}`;

    const url = personNextCursor
        ? `${endpoint}&limit=100&cursor=${personNextCursor}`
        : `${endpoint}&limit=100`;

    try {
        const data = await api.get(url);

        if (personNextCursor === null) {
            currentPersonPhotos = data.photos;
        } else {
            currentPersonPhotos = [...currentPersonPhotos, ...data.photos];
        }

        personNextCursor = data.next_cursor || null;
        personHasMore = data.has_more;

        renderPersonPhotos();
    } catch (err) {
        html($('#person-photos'), `<p class="error">Error: ${err.message}</p>`);
    }
}

async function switchGroupTab(tab) {
    $$('.tab-btn').forEach(btn => btn.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');

    viewingHidden = tab === 'hidden';
    personNextCursor = null;
    await loadGroupPhotos();
}

// =============================================================================
// Person Management Modals
// =============================================================================

function showRenamePersonModal(personId, currentName) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Rename Person</h3>
            <input type="text" id="person-name-input" value="${currentName.startsWith('Unknown') ? '' : currentName}" placeholder="Enter name">
            <div class="modal-buttons">
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button onclick="renamePerson('${personId}')">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    $('#person-name-input').focus();
    $('#person-name-input').select();
}

async function renamePerson(personId) {
    const name = $('#person-name-input').value.trim();
    if (!name) {
        alert('Please enter a name');
        return;
    }

    try {
        await api.patch(`/api/v1/people/${personId}`, { name });
        $('.modal-overlay').remove();
        renderPersonView(personId);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function showMergePersonModal(personId) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <h3>Merge with Another Person</h3>
            <p>Select people to merge into this person:</p>
            <div class="merge-people-list" id="merge-people-list">Loading...</div>
            <div class="modal-buttons">
                <button onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                <button onclick="mergeSelectedPersons('${personId}')">Merge Selected</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    loadMergeCandidates(personId);
}

async function loadMergeCandidates(currentPersonId) {
    try {
        const data = await api.get('/api/v1/people?limit=100&offset=0');
        const others = data.people.filter(p => p.id !== currentPersonId);

        if (others.length === 0) {
            html($('#merge-people-list'), '<p>No other people to merge with</p>');
            return;
        }

        let listHtml = '';
        for (const person of others) {
            const displayName = formatPersonName(person);
            listHtml += `
                <label class="merge-person-item">
                    <input type="checkbox" value="${person.id}">
                    <div class="person-avatar-small">
                        ${person.face_url ? `<img src="${API_BASE}${person.face_url}" alt="">` : '👤'}
                    </div>
                    <span>${displayName}</span>
                    <span class="photo-count">${person.photo_count}</span>
                </label>
            `;
        }

        html($('#merge-people-list'), listHtml);
    } catch (err) {
        html($('#merge-people-list'), `<p class="error">Error: ${err.message}</p>`);
    }
}

async function mergeSelectedPersons(targetId) {
    const checkboxes = $$('#merge-people-list input:checked');
    const sourceIds = Array.from(checkboxes).map(cb => cb.value);

    if (sourceIds.length === 0) {
        alert('Select at least one person to merge');
        return;
    }

    sourceIds.push(targetId); // Include target in source_ids

    try {
        const result = await api.post('/api/v1/people/merge', {
            source_ids: sourceIds,
            target_id: targetId
        });

        alert(`Merged ${result.merged_count} person(s), moved ${result.faces_moved} face(s)`);
        $('.modal-overlay').remove();
        renderPersonView(targetId);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function showPersonFaces(personId) {
    try {
        const data = await api.get(`/api/v1/people/${personId}/faces`);

        if (data.faces.length <= 1) {
            alert('This person has only one face. Nothing to manage.');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        let facesHtml = '';
        for (const face of data.faces) {
            facesHtml += `
                <div class="face-item">
                    <div class="face-preview">
                        <img src="${API_BASE}${face.preview_url}" alt="" style="${getFaceCropStyle(face.preview_box)}">
                    </div>
                    <span>${face.photo_count} photos</span>
                    <button class="small danger" onclick="detachFace('${personId}', '${face.id}')">Detach</button>
                </div>
            `;
        }

        modal.innerHTML = `
            <div class="modal-content modal-large">
                <h3>Manage Faces</h3>
                <p>This person has ${data.faces.length} different face embeddings. You can detach a face to create a new person.</p>
                <div class="faces-grid">${facesHtml}</div>
                <div class="modal-buttons">
                    <button onclick="this.closest('.modal-overlay').remove()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function detachFace(personId, faceId) {
    if (!confirm('Detach this face? A new person will be created.')) return;

    try {
        const result = await api.delete(`/api/v1/people/${personId}/faces/${faceId}`);
        alert(`Face detached. New person created: ${result.new_person_id}`);
        $('.modal-overlay').remove();
        renderPersonView(personId);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function deletePerson(personId) {
    if (!confirm('Delete this person? Photos will be kept but face data will be removed.')) return;

    try {
        await api.delete(`/api/v1/people/${personId}`);
        router.navigate('/people');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Setup routes
router.add('/login', renderLogin);
router.add('/', renderGallery);
router.add('/albums', renderAlbums);
router.add('/albums/:id', renderAlbumView);
router.add('/people', renderPeople);
router.add('/people/group', renderGroupView);
router.add('/people/:id', renderPersonView);
router.add('/map', renderMap);
router.add('/shares', renderShares);
router.add('/stats', renderStats);
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
