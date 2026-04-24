// ============================================================================
// ============================================================================

// ── Global Error Handler (Early Catch) ──
window.onerror = function(msg, url, line, col, error) {
  const container = document.getElementById('main-content');
  if (container) {
    container.innerHTML = `
      <div style="padding:4rem 2rem; text-align:center; color:#ff4d4d; background:rgba(255,0,0,0.05); border-radius:12px; margin:2rem; border:1px solid rgba(255,0,0,0.2);">
        <h2 style="margin-bottom:1rem;">⚠️ Application Error</h2>
        <p style="opacity:0.8; font-size:0.9rem;">${msg}</p>
        <p style="opacity:0.6; font-size:0.8rem;">Line: ${line}, Col: ${col}, URL: ${url}</p>
        <p style="opacity:0.6; font-size:0.8rem; text-align:left; background:#222; padding:1rem; border-radius:6px; margin-top:1rem; overflow-x:auto;">
          ${error && error.stack ? error.stack.replace(/\\n/g, '<br>') : 'No stack trace'}
        </p>
        <button onclick="location.reload()" style="margin-top:1.5rem; padding:0.6rem 1.2rem; background:#ff4d4d; color:white; border:none; border-radius:6px; cursor:pointer;">Refresh Page</button>
      </div>`;
  }
  return false;
};

// BODA STUDIO AI v2.0
// Main Core Application
// ============================================================================

// ══════════════════════════════════════
// FIREBASE Link Boda Integration
// ══════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyD53FikQjDPnf8cVAgzXViNttYuF6qtNmU",
  authDomain: "link-bod.firebaseapp.com",
  projectId: "link-bod",
  storageBucket: "link-bod.firebasestorage.app",
  messagingSenderId: "563207613619",
  appId: "1:563207613619:web:e52436e5778cd43cf2d4c6",
  measurementId: "G-F4Z7LKV327"
};

let fbDb = null;
let fbRealtime = null;
let fbAnalytics = null;
try {
  firebase.initializeApp(firebaseConfig);
  fbDb = firebase.firestore();
  fbRealtime = firebase.database();
  fbAnalytics = firebase.analytics();
} catch (e) {
  console.error("Firebase init error", e);
}

// ══════════════════════════════════════
// 1. UUID Generator
// ══════════════════════════════════════
function uuid() {
  return 'xxxx-xxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

// ── Toast Notifications ──
const Toast = {
  container: null,
  init() {
    this.container = document.getElementById('toast-container');
  },
  show(message, type = 'info', duration = 3000) {
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const t = document.createElement('div');
    t.className = `toast ${type} `;
    t.innerHTML = `<span>${icons[type] || 'ℹ'}</span> <span>${message}</span>`;
    this.container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }
};

// ── Project Store (localStorage) ──
const Store = {
  KEY: 'boda_projects',
  PHOTO_KEY: 'boda_photos_',
  _photoCache: {},

  getAll() {
    try {
      const data = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch(e) { 
      console.error("Store.getAll error:", e);
      return []; 
    }
  },
  save(projects) {
    localStorage.setItem(this.KEY, JSON.stringify(projects));
  },
  create(name) {
    const projects = this.getAll();
    const p = {
      id: uuid(),
      name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      photoCount: 0,
      thumbnailData: null
    };
    projects.unshift(p);
    this.save(projects);
    return p;
  },
  get(id) {
    return this.getAll().find(p => p.id === id);
  },
  update(id, data) {
    const projects = this.getAll();
    const idx = projects.findIndex(p => p.id === id);
    if (idx >= 0) { Object.assign(projects[idx], data); this.save(projects); }
  },
  delete(id) {
    this.save(this.getAll().filter(p => p.id !== id));
    localStorage.removeItem(this.PHOTO_KEY + id);
    delete this._photoCache[id];
  },
  getPhotos(projectId) {
    if (this._photoCache[projectId]) return this._photoCache[projectId];
    const photos = JSON.parse(localStorage.getItem(this.PHOTO_KEY + projectId) || '[]');
    this._photoCache[projectId] = photos;
    return photos;
  },
  savePhotos(projectId, photos) {
    this._photoCache[projectId] = photos;
    localStorage.setItem(this.PHOTO_KEY + projectId, JSON.stringify(photos));
  }
};

// ── Photo memory cache (data URLs) ──
const PhotoCache = {};

// ── IndexedDB for persistent photo storage ──
const PhotoDB = {
  DB_NAME: 'boda_photo_db',
  STORE_NAME: 'photos',
  THUMB_STORE: 'thumbnails',
  DB_VERSION: 2,
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
        if (!db.objectStoreNames.contains(this.THUMB_STORE)) {
          db.createObjectStore(this.THUMB_STORE);
        }
      };
      req.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async savePhotoBatch(projectId, photoDataMap, isThumb = false) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const storeName = isThumb ? this.THUMB_STORE : this.STORE_NAME;
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const [photoId, dataUrl] of Object.entries(photoDataMap)) {
        store.put(dataUrl, `${projectId}_${photoId}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async getPhoto(projectId, photoId, isThumb = false) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const storeName = isThumb ? this.THUMB_STORE : this.STORE_NAME;
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(`${projectId}_${photoId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async loadProjectPhotos(projectId, photoIds, isThumb = false) {
    const db = await this.open();
    const cache = {};
    return new Promise((resolve, reject) => {
      const storeName = isThumb ? this.THUMB_STORE : this.STORE_NAME;
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      let completed = 0;
      if (photoIds.length === 0) { resolve(cache); return; }
      photoIds.forEach(pid => {
        const req = store.get(`${projectId}_${pid}`);
        req.onsuccess = () => {
          if (req.result) cache[pid] = req.result;
          completed++;
          if (completed === photoIds.length) resolve(cache);
        };
        req.onerror = () => {
          completed++;
          if (completed === photoIds.length) resolve(cache);
        };
      });
    });
  },

  async deleteProjectPhotos(projectId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const stores = [this.STORE_NAME, this.THUMB_STORE];
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach(sName => {
        const store = tx.objectStore(sName);
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (typeof cursor.key === 'string' && cursor.key.startsWith(projectId + '_')) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
      });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
};

// ── Helper: File to compressed data URL ──
function fileToDataUrl(file, maxSize = 2160, quality = 0.95) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          const scale = maxSize / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Router ──
const Router = {
  routes: {},
  register(hash, handler) { this.routes[hash] = handler; },
  navigate(hash) {
    window.location.hash = hash;
  },
  init() {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  },
  resolve() {
    const hash = window.location.hash || '#dashboard';
    const main = document.getElementById('main-content');
    main.innerHTML = '';

    // Update active nav
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.route === hash.split('/')[0]);
    });

    // Match parametric routes
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const regex = new RegExp('^' + pattern.replace(/:[^\\/]+/g, '([^\\/]+)') + '$');
      const match = hash.match(regex);
      if (match) {
        try {
          const content = handler(...match.slice(1));
          if (typeof content === 'string') {
            main.innerHTML = `<div class="page-enter"> ${content}</div> `;
          }
        } catch(err) {
          main.innerHTML = `<div style="color:red;padding:2rem;">Route Error: ${err.message}<br><pre>${err.stack}</pre></div>`;
          console.error('Route error:', err);
        }
        return;
      }
    }
    // Fallback
    if (this.routes['#dashboard']) {
      window.location.hash = '#dashboard';
    }
  }
};

// ── Format helpers ──
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Dashboard Page ──
function renderDashboard() {
  const projects = Store.getAll();
  const total = projects.length;
  const pending = projects.filter(p => p.status === 'pending').length;
  const processing = projects.filter(p => p.status === 'processing').length;
  const ready = projects.filter(p => p.status === 'ready').length;
  const totalPhotos = projects.reduce((s, p) => s + (p.photoCount || 0), 0);

  const main = document.getElementById('main-content');
  if(!main) {
     alert('MAIN NOT FOUND'); return;
  }
  main.innerHTML = `<div class="page-enter" style="height:100%;">
    <div class="page-header" style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h2>Dashboard</h2>
        <p>Manage and organize project photos</p>
      </div>
    </div>

    <div class="stats-row">
      <div class="glass stat-card">
        <div class="stat-icon blue">📁</div>
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Projects</div>
      </div>
      <div class="glass stat-card">
        <div class="stat-icon cyan">📷</div>
        <div class="stat-value">${totalPhotos}</div>
        <div class="stat-label">Total Photos</div>
      </div>
      <div class="glass stat-card">
        <div class="stat-icon amber">⏳</div>
        <div class="stat-value">${pending + processing}</div>
        <div class="stat-label">In Progress</div>
      </div>
      <div class="glass stat-card">
        <div class="stat-icon green">✅</div>
        <div class="stat-value">${ready}</div>
        <div class="stat-label">Ready</div>
      </div>
    </div>

    <div class="action-bar">
      <h3 style="font-weight:700;">Projects</h3>
      <div style="display:flex;gap:0.75rem;">
        <button class="btn btn-primary" onclick="showNewProjectModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Project
        </button>
      </div>
    </div>

    <div id="projects-list">
      ${projects.length === 0 ? renderEmptyState() : renderProjectCards(projects)}
    </div>
  </div> `;
}

function renderEmptyState() {
  return `<div class="empty-state glass">
    <div class="empty-icon">📸</div>
    <h3>No projects yet</h3>
    <p>Create your first project to start managing photos</p>
    <button class="btn btn-primary" onclick="showNewProjectModal()">Create Project</button>
  </div> `;
}

function renderProjectCards(projects) {
  return `<div class="projects-grid"> ${projects.map(p => {
    let thumbHtml = '<div class="thumb-placeholder">📁</div>';
    if (p.thumbnailData) {
      thumbHtml = `<img src="${p.thumbnailData}" alt="${p.name}">`;
    } else {
      // Only get photos if we need them for thumbnails
      const photos = Store.getPhotos(p.id);
      if (photos.length > 0) {
        const cache = PhotoCache[p.id] || {};
        const thumbPhotos = photos.slice(0, 4);
        if (thumbPhotos.some(ph => cache[ph.id])) {
          thumbHtml = `<div style="display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%;">${thumbPhotos.map(ph => cache[ph.id] ? `<img src="${cache[ph.id]}" style="width:100%;height:100%;object-fit:cover;aspect-ratio:1;">` : '').join('')}</div>`;
        }
      }
    }

    return `
    <div class="glass project-card" onclick="Router.navigate('#project/${p.id}')">
      <div class="card-thumb">
        ${thumbHtml}
      </div>
      <div class="card-body">
        <h3>${p.name}</h3>
        <div class="card-meta">
          <span class="status-badge ${p.status}">${p.status}</span>
          <span>📷 ${p.photoCount || 0}</span>
          <span>${formatDate(p.createdAt)}</span>
        </div>
      </div>
      <div class="card-actions" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" onclick="changeStatus('${p.id}')">Status</button>
        <button class="btn btn-ghost btn-sm" onclick="renameProject('${p.id}')">Rename</button>
        <button class="btn btn-ghost btn-sm" onclick="duplicateProject('${p.id}')">Copy</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">Delete</button>
      </div>
    </div>`;
  }).join('')
    }</div> `;
}


// ── Sort State ──
let currentSort = 'default';

function sortPhotos(photos, sortBy) {
  const sorted = [...photos];
  switch (sortBy) {
    case 'name-asc': return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc': return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'size-desc': return sorted.sort((a, b) => b.size - a.size);
    case 'size-asc': return sorted.sort((a, b) => a.size - b.size);
    case 'score-desc': return sorted.sort((a, b) => (SelectionState.getScore(b.id) || 0) - (SelectionState.getScore(a.id) || 0));
    default: return sorted;
  }
}

const SelectionState = {
  projectId: null,
  selected: new Set(),
  liked: new Set(),
  locked: new Set(),
  autoSuggested: new Set(),
  scores: {},
  filter: 'all',
  _lastId: null,
  _saveTimer: null,

  load(projectId) {
    if (this._lastId === projectId) return;
    this._lastId = projectId;
    this.projectId = projectId;
    const data = JSON.parse(localStorage.getItem('boda_selection_' + projectId) || '{}');
    this.selected = new Set(data.selected || []);
    this.liked = new Set(data.liked || []);
    this.locked = new Set(data.locked || []);
    this.autoSuggested = new Set(data.autoSuggested || []);
    this.scores = data.scores || {};
    this.filter = 'all';
  },
  save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (!this.projectId) return;
      localStorage.setItem('boda_selection_' + this.projectId, JSON.stringify({
        selected: [...this.selected],
        liked: [...this.liked],
        locked: [...this.locked],
        autoSuggested: [...this.autoSuggested],
        scores: this.scores
      }));
    }, 800); // Increased debounce for large projects
  },
  toggleSelect(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.save();
  },
  toggleLike(id) {
    if (this.liked.has(id)) this.liked.delete(id);
    else { this.liked.add(id); this.selected.add(id); }
    this.save();
  },
  toggleLock(id) {
    if (this.locked.has(id)) this.locked.delete(id);
    else this.locked.add(id);
    this.save();
  },
  selectAll(ids) { ids.forEach(id => this.selected.add(id)); this.save(); },
  deselectAll() {
    const unlocked = [...this.selected].filter(id => !this.locked.has(id));
    unlocked.forEach(id => this.selected.delete(id));
    this.save();
  },
  isSelected(id) { return this.selected.has(id); },
  isLiked(id) { return this.liked.has(id); },
  isLocked(id) { return this.locked.has(id); },
  isAutoSuggested(id) { return this.autoSuggested.has(id); },
  getScore(id) { return this.scores[id] || 0; },
  totalSelected() { return this.selected.size; }
};

// ── Auto-Suggest Engine ──
function autoSuggestPhotos(photos) {
  if (photos.length === 0) return;

  const sizes = photos.map(p => p.size);
  const maxSize = Math.max(...sizes);
  const minSize = Math.min(...sizes);
  const sizeRange = maxSize - minSize || 1;

  const typeScore = { 'image/jpeg': 10, 'image/png': 8, 'image/webp': 6, 'image/gif': 2 };

  photos.forEach(p => {
    const sizeNorm = ((p.size - minSize) / sizeRange) * 60;
    const tScore = typeScore[p.type] || 5;
    const nameBonus = /best|final|select|hd|hq|raw/i.test(p.name) ? 15 : 0;
    const jitter = Math.random() * 10;
    SelectionState.scores[p.id] = Math.min(100, Math.round(sizeNorm + tScore + nameBonus + jitter));
  });

  const sorted = [...photos].sort((a, b) => (SelectionState.scores[b.id] || 0) - (SelectionState.scores[a.id] || 0));
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.3));
  SelectionState.autoSuggested = new Set(sorted.slice(0, topCount).map(p => p.id));
  SelectionState.save();
}

// ── Project View Page (with Selection System) ──
async function renderProject(id) {
  const project = Store.get(id);
  if (!project) { Router.navigate('#dashboard'); return; }

  const photos = Store.getPhotos(id);

  SelectionState.load(id);

  // Defer auto-suggest to avoid blocking initial render
  if (photos.length > 0 && Object.keys(SelectionState.scores).length === 0) {
    setTimeout(() => autoSuggestPhotos(photos), 100);
  }

  // Filter photos
  let filtered = photos;
  const f = SelectionState.filter;
  if (f === 'selected') filtered = photos.filter(p => SelectionState.isSelected(p.id));
  else if (f === 'auto') filtered = photos.filter(p => SelectionState.isAutoSuggested(p.id));
  else if (f === 'liked') filtered = photos.filter(p => SelectionState.isLiked(p.id));

  const selCount = SelectionState.totalSelected();
  const autoCount = photos.filter(p => SelectionState.isAutoSuggested(p.id)).length;
  const likedCount = photos.filter(p => SelectionState.isLiked(p.id)).length;

  // Sort photos
  filtered = sortPhotos(filtered, currentSort);
  
  window.CurrentLightboxPhotos = filtered;
  window.CurrentLightboxProjectId = id;

  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="page-enter">
    <a class="back-link" href="#dashboard">← Back to Dashboard</a>
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
      <div>
        <div class="project-title-wrap" onclick="renameProjectInline('${id}')">
          <h2>${project.name}</h2>
          <span class="edit-icon">✏️</span>
        </div>
        <p>
          <span class="status-badge ${project.status}">${project.status}</span>
          &nbsp; ${photos.length} photos • Created ${formatDate(project.createdAt)}
        </p>
      </div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <button class="btn btn-ghost" onclick="addFilesToProject('${id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Files
        </button>
        <button class="btn btn-ghost" onclick="addPhotosToProject('${id}')">📂 Add Folder</button>
        <button class="btn btn-primary" onclick="runAutoSuggest('${id}')">⚡ Auto Suggest</button>
      </div>
    </div>

    ${photos.length === 0 ? `
      <div class="upload-zone glass" id="inline-upload">
        <div class="upload-icon">📸</div>
        <h3>Drop photos here or choose an option</h3>
        <p>Supports JPG, PNG, WEBP • Drag and drop or click below</p>
        <div class="upload-btns">
          <button class="btn btn-primary" onclick="addFilesToProject('${id}')">📷 Add Files</button>
          <button class="btn btn-ghost" onclick="addPhotosToProject('${id}')">📂 Add Folder</button>
        </div>
      </div>
    ` : `
      <!-- Selection Toolbar -->
      <div class="selection-toolbar">
        <div class="toolbar-left">
          <div class="filter-tabs">
            <button class="filter-tab ${f === 'all' ? 'active' : ''}" onclick="setFilter('all','${id}')">
              All <span class="count">${photos.length}</span>
            </button>
            <button class="filter-tab ${f === 'selected' ? 'active' : ''}" onclick="setFilter('selected','${id}')">
              ✓ Selected <span class="count">${selCount}</span>
            </button>
            <button class="filter-tab ${f === 'auto' ? 'active' : ''}" onclick="setFilter('auto','${id}')">
              ⚡ Auto <span class="count">${autoCount}</span>
            </button>
            <button class="filter-tab ${f === 'liked' ? 'active' : ''}" onclick="setFilter('liked','${id}')">
              ❤️ Liked <span class="count">${likedCount}</span>
            </button>
          </div>
          ${selCount > 0 ? `
            <div class="selection-counter">
              <div class="counter-dot"></div>
              ${selCount} selected
            </div>
          ` : ''}
        </div>
        <div class="toolbar-right">
          <select class="sort-select" onchange="currentSort=this.value;renderProject('${id}')">
            <option value="default" ${currentSort === 'default' ? 'selected' : ''}>Sort: Default</option>
            <option value="name-asc" ${currentSort === 'name-asc' ? 'selected' : ''}>Name A→Z</option>
            <option value="name-desc" ${currentSort === 'name-desc' ? 'selected' : ''}>Name Z→A</option>
            <option value="size-desc" ${currentSort === 'size-desc' ? 'selected' : ''}>Size ↓</option>
            <option value="size-asc" ${currentSort === 'size-asc' ? 'selected' : ''}>Size ↑</option>
            <option value="score-desc" ${currentSort === 'score-desc' ? 'selected' : ''}>Score ↓</option>
          </select>
          <button class="btn btn-ghost btn-sm" onclick="selectAllVisible('${id}')">Select All</button>
          <button class="btn btn-ghost btn-sm" onclick="deselectAllPhotos('${id}')">Deselect</button>
          <button class="btn btn-ghost btn-sm" onclick="acceptAutoSuggestions('${id}')">✓ Accept Auto</button>
        </div>
      </div>

      <!-- Photo Grid (Streaming/Chunked) -->
      <div class="photo-grid" id="photo-grid-main">
        <!-- Chunks injected here -->
      </div>
    `}

    <!--Bulk Action Bar-->
  <div class="bulk-bar ${selCount > 0 ? 'show' : ''}" id="bulk-bar">
    <div class="bulk-info"><span>${selCount}</span> photos selected</div>
    <button class="btn btn-ghost btn-sm" onclick="deselectAllPhotos('${id}')">Clear</button>
    <button class="btn btn-primary btn-sm" style="background:var(--success);border-color:var(--success);" onclick="bulkDownloadPhotos('${id}')">📥 Download</button>
    <button class="btn btn-danger btn-sm" onclick="bulkDeletePhotos('${id}')">🗑️ Delete</button>
    <button class="btn btn-primary btn-sm" onclick="IGBuilderState.projectId = '${id}'; Router.navigate('#ig-builder');">→ IG Builder</button>
  </div>
  </div> `;

  // Start streaming photos to grid
  const grid = document.getElementById('photo-grid-main');
  if (grid && filtered.length > 0) {
    streamPhotosToGrid(grid, filtered, id);
  }

  // Setup drag & drop on project view
  setupProjectDragDrop(id);
}

const PhotoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const id = el.dataset.id;
      const pid = el.dataset.project;
      if (!PhotoCache[pid] || !PhotoCache[pid][id]) {
        // Try Thumbnail first
        PhotoDB.getPhoto(pid, id, true).then(thumb => {
          if (thumb) {
            _setPhotoItemImg(el, pid, id, thumb);
          } else {
            // Fallback to HD if thumb missing (legacy projects)
            PhotoDB.getPhoto(pid, id, false).then(hd => {
              if (hd) _setPhotoItemImg(el, pid, id, hd);
            });
          }
        });
      }
      PhotoObserver.unobserve(el);
    }
  });
}, { rootMargin: '400px' });

function _setPhotoItemImg(el, pid, id, src) {
  if (!PhotoCache[pid]) PhotoCache[pid] = {};
  PhotoCache[pid][id] = src;
  const img = el.querySelector('img');
  const placeholder = el.querySelector('.photo-placeholder');
  if (img) { img.src = src; img.style.display = 'block'; }
  if (placeholder) placeholder.remove();
}

function streamPhotosToGrid(container, photos, projectId, batchSize = 40) {
  let index = 0;
  function renderNextBatch() {
    const end = Math.min(index + batchSize, photos.length);
    const batch = photos.slice(index, end);
    const blobUrls = PhotoCache[projectId] || {};

    const html = batch.map(p => {
      const isSelected = SelectionState.isSelected(p.id);
      const isLiked = SelectionState.isLiked(p.id);
      const isAuto = SelectionState.isAutoSuggested(p.id);
      const isLocked = SelectionState.isLocked(p.id);
      const score = SelectionState.getScore(p.id);
      const src = blobUrls[p.id] || '';
      return `
        <div class="photo-item ${isSelected ? 'selected' : ''}" data-id="${p.id}" data-project="${projectId}" data-name="${p.name.replace(/"/g, '&quot;')}" onclick="handlePhotoClick(this)" oncontextmenu="showContextMenu(event,this)">
          <img src="${src}" alt="${p.name}" style="${!src ? 'display:none' : ''}">
          ${!src ? '<div class="photo-placeholder">🖼️</div>' : ''}
          <button class="photo-heart ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation();togglePhotoLike('${p.id}','${projectId}')">${isLiked ? '❤️' : '🤍'}</button>
          ${isAuto && !isSelected ? `<div class="photo-badge-auto">⚡ AUTO</div>` : ''}
          ${isLocked ? `<div class="photo-lock" onclick="event.stopPropagation();togglePhotoLock('${p.id}','${projectId}')">🔒</div>` : ''}
          <div class="photo-score" style="width:${score}%"></div>
          <div class="photo-name">${p.name}</div>
        </div>`;
    }).join('');

    const range = document.createRange();
    const fragment = range.createContextualFragment(html);
    fragment.querySelectorAll('.photo-item').forEach(item => {
      if (!item.querySelector('img').src) PhotoObserver.observe(item);
    });
    container.appendChild(fragment);
    index = end;
    if (index < photos.length) requestAnimationFrame(renderNextBatch);
  }
  renderNextBatch();
}

// ── Click Handler: single=select, double=lightbox ──
let _clickTimer = null;
let _clickCount = 0;

function handlePhotoClick(el) {
  const photoId = el.dataset.id;
  const projectId = el.dataset.project;
  const photoName = el.dataset.name;

  _clickCount++;
  if (_clickCount === 1) {
    _clickTimer = setTimeout(() => {
      // Single click → select/deselect (INSTANT DOM update, no full re-render)
      _clickCount = 0;
      SelectionState.toggleSelect(photoId);
      _updatePhotoItemDOM(el, photoId, projectId);
    }, 250);
  } else if (_clickCount === 2) {
    // Double click → open lightbox
    clearTimeout(_clickTimer);
    _clickCount = 0;
    
    if (window.CurrentLightboxPhotos) {
      const idx = window.CurrentLightboxPhotos.findIndex(p => p.id === photoId);
      if (idx !== -1) openLightboxAt(idx);
    }
  }
}

// ── Optimized DOM update for photo selection (no full re-render) ──
function _updatePhotoItemDOM(el, photoId, projectId) {
  const isSelected = SelectionState.isSelected(photoId);
  const isAuto = SelectionState.isAutoSuggested(photoId);

  // Toggle selected class
  el.classList.toggle('selected', isSelected);

  // Update auto badge visibility
  const badge = el.querySelector('.photo-badge-auto');
  if (badge) {
    badge.style.display = (isAuto && !isSelected) ? '' : 'none';
  }

  // Update counter in toolbar
  const selCount = SelectionState.totalSelected();
  const counterEl = document.querySelector('.selection-counter');
  const filterTabSel = document.querySelector('.filter-tab[onclick*="selected"] .count');
  if (filterTabSel) filterTabSel.textContent = selCount;

  if (selCount > 0) {
    if (!counterEl) {
      // Insert counter next to filter tabs
      const toolbarLeft = document.querySelector('.toolbar-left');
      if (toolbarLeft) {
        const div = document.createElement('div');
        div.className = 'selection-counter';
        div.innerHTML = `<div class="counter-dot"></div> ${selCount} selected`;
        toolbarLeft.appendChild(div);
      }
    } else {
      counterEl.innerHTML = `<div class="counter-dot"></div> ${selCount} selected`;
    }
  } else {
    if (counterEl) counterEl.remove();
  }

  // Update bulk bar
  const bulkBar = document.getElementById('bulk-bar');
  if (bulkBar) {
    bulkBar.classList.toggle('show', selCount > 0);
    const infoSpan = bulkBar.querySelector('.bulk-info span');
    if (infoSpan) infoSpan.textContent = selCount;
  }
}

function togglePhotoSelect(photoId, projectId) {
  SelectionState.toggleSelect(photoId);
  const el = document.querySelector(`.photo-item[data-id="${photoId}"]`);
  if (el) _updatePhotoItemDOM(el, photoId, projectId);
  else renderProject(projectId);
}

function togglePhotoLike(photoId, projectId) {
  SelectionState.toggleLike(photoId);
  const isLiked = SelectionState.isLiked(photoId);
  Toast.show(isLiked ? '❤️ Photo liked!' : 'Like removed', isLiked ? 'success' : 'info', 1500);

  // Update heart button DOM instantly
  const el = document.querySelector(`.photo-item[data-id="${photoId}"]`);
  if (el) {
    const heartBtn = el.querySelector('.photo-heart');
    if (heartBtn) {
      heartBtn.className = `photo-heart ${isLiked ? 'liked' : ''}`;
      heartBtn.textContent = isLiked ? '❤️' : '🤍';
    }
    // Also update selection visuals
    _updatePhotoItemDOM(el, photoId, projectId);

    // Update liked count tab
    const likedCount = [...SelectionState.liked].length;
    const likeTab = document.querySelector('.filter-tab[onclick*="liked"] .count');
    if (likeTab) likeTab.textContent = likedCount;
  } else {
    renderProject(projectId);
  }
}

function togglePhotoLock(photoId, projectId) {
  SelectionState.toggleLock(photoId);
  const isLocked = SelectionState.isLocked(photoId);
  Toast.show(isLocked ? '🔒 Photo locked' : '🔓 Photo unlocked', 'info', 1500);
  // Lock changes state visibility — just re-render lock icon area
  const el = document.querySelector(`.photo-item[data-id="${photoId}"]`);
  if (el) {
    let lockEl = el.querySelector('.photo-lock');
    if (isLocked) {
      if (!lockEl) {
        lockEl = document.createElement('div');
        lockEl.className = 'photo-lock';
        lockEl.title = 'Locked';
        lockEl.onclick = (e) => { e.stopPropagation(); togglePhotoLock(photoId, projectId); };
        el.appendChild(lockEl);
      }
      lockEl.textContent = '🔒';
      lockEl.style.opacity = '1';
    } else {
      if (lockEl) lockEl.remove();
    }
  } else {
    renderProject(projectId);
  }
}

function setFilter(filter, projectId) {
  SelectionState.filter = filter;
  renderProject(projectId);
}

function selectAllVisible(projectId) {
  const photos = Store.getPhotos(projectId);
  SelectionState.selectAll(photos.map(p => p.id));
  Toast.show(`All ${photos.length} photos selected`, 'success');
  renderProject(projectId);
}

function deselectAllPhotos(projectId) {
  SelectionState.deselectAll();
  Toast.show('Selection cleared (locked photos kept)', 'info');
  renderProject(projectId);
}

function acceptAutoSuggestions(projectId) {
  const autoIds = [...SelectionState.autoSuggested];
  SelectionState.selectAll(autoIds);
  Toast.show(`✓ ${autoIds.length} auto - suggested photos selected`, 'success');
  renderProject(projectId);
}

// ── True AI: Blur Detection (Variance of Laplacian) ──
function calculateBlurScore(imgElement) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scale = 200 / Math.max(imgElement.width, imgElement.height);
  canvas.width = Math.round(imgElement.width * scale);
  canvas.height = Math.round(imgElement.height * scale);
  ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const laplacian = new Float32Array(width * height);
  let sum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const val = gray[idx - width] + gray[idx - 1] - 4 * gray[idx] + gray[idx + 1] + gray[idx + width];
      laplacian[idx] = val;
      sum += val;
    }
  }

  const mean = sum / (width * height);
  let variance = 0;
  for (let i = 0; i < laplacian.length; i++) {
    variance += Math.pow(laplacian[i] - mean, 2);
  }
  return variance / laplacian.length;
}

function runAutoSuggest(projectId) {
  const photos = Store.getPhotos(projectId);
  Swal.fire({
    title: '🧠 True AI Analysis',
    html: `<p> AI will download local neural networks (~2MB) to scan <strong>${photos.length}</strong> photos for facial expressions and focus clarity.</p>
  <p style="margin-top:0.5rem;font-size:0.85rem;opacity:0.7;">This operates 100% offline in your browser.</p>`,
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Run AI Analysis',
    cancelButtonText: 'Cancel'
  }).then(result => {
    if (result.isConfirmed) {
      runTrueAIAnalysis(projectId, photos);
    }
  });
}

async function runTrueAIAnalysis(projectId, photos) {
  Swal.fire({
    title: 'Initializing AI Models...',
    html: 'Downloading weights... Please wait.<br><br><div class="progress-bar" style="width:100%;background:#334155;border-radius:10px;overflow:hidden;height:8px;margin-top:10px;"><div id="ai-progress" style="width:0%;height:100%;background:#3B82F6;transition: width 0.3s;"></div></div><p id="ai-status" style="margin-top:10px;font-size:0.9rem;"></p>',
    allowOutsideClick: false,
    showConfirmButton: false,
    didOpen: async () => {
      try {
        const pBar = document.getElementById('ai-progress');
        const statusText = document.getElementById('ai-status');

        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);

        SelectionState.scores = {};
        SelectionState.autoSuggested = new Set();

        const cache = PhotoCache[projectId] || {};

        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];

          if (statusText) statusText.innerText = `Scanning photo ${i + 1} of ${photos.length}...`;
          if (pBar) pBar.style.width = Math.round(((i + 1) / photos.length) * 100) + '%';

          let score = 50;
          const nameBonus = /best|final|select|hd|hq|raw|edit/i.test(p.name) ? 20 : 0;
          const sizeBonus = Math.min(20, (p.size / 1024 / 1024) * 2);
          score += nameBonus + sizeBonus;

          let dataUrl = cache[p.id];
          if (!dataUrl) dataUrl = await PhotoDB.getPhoto(projectId, p.id, true);

          if (dataUrl) {
            const img = new Image();
            await new Promise(res => { img.onload = res; img.src = dataUrl; });

            const blurVariance = calculateBlurScore(img);
            if (blurVariance < 100) score -= 80; // Strongly penalize blur
            else if (blurVariance < 200) score -= 30;
            else if (blurVariance > 500) score += 30; // Very sharp
            else score += 10;

            try {
              const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
              if (detections && detections.length > 0) {
                score += (detections.length * 5); // +5 per face
                let maxHappy = 0;
                for (const det of detections) {
                  if (det.expressions && det.expressions.happy > maxHappy) {
                    maxHappy = det.expressions.happy;
                  }
                }
                if (maxHappy > 0.8) score += 40; // Extremely happy
                else if (maxHappy > 0.5) score += 20; // Smiling
              }
            } catch(e) { console.error('FaceAPI err', e); }
          }

          SelectionState.scores[p.id] = Math.max(0, Math.round(score)); // No artificial cap, sorting will be precise
          await new Promise(r => setTimeout(r, 10));
        }

        const sorted = [...photos].sort((a, b) => (SelectionState.scores[b.id] || 0) - (SelectionState.scores[a.id] || 0));
        const topCount = Math.max(1, Math.ceil(sorted.length * 0.3));
        SelectionState.autoSuggested = new Set(sorted.slice(0, topCount).map(p => p.id));
        SelectionState.save();

        Swal.close();
        Toast.show(`⚡ AI selected ${SelectionState.autoSuggested.size} best photos!`, 'success', 3000);
        renderProject(projectId);
      } catch (err) {
        Swal.close();
        Toast.show('AI Analysis failed. See console.', 'error');
        console.error(err);
      }
    }
  });
}

async function addPhotosToProject(projectId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*';
  input.setAttribute('webkitdirectory', '');
  input.onchange = async () => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const files = Array.from(input.files).filter(f => imageTypes.includes(f.type));
    if (files.length === 0) { Toast.show('No images found', 'error'); return; }
    promptGoogleDriveSync(projectId, files);
  };
  input.click();
}

// ── Lightbox & Histogram ──
window.CurrentLightboxIndex = 0;

async function openLightboxAt(index) {
  if (!window.CurrentLightboxPhotos || index < 0 || index >= window.CurrentLightboxPhotos.length) return;
  window.CurrentLightboxIndex = index;
  const photo = window.CurrentLightboxPhotos[index];
  const projectId = window.CurrentLightboxProjectId;
  
  const lb = document.getElementById('lightbox');
  const imgEL = document.getElementById('lightbox-img');
  
  lb.classList.add('show');

  // Try cache
  let src = (PhotoCache[projectId] || {})[photo.id];
  
  // Proactively fetch HD
  PhotoDB.getPhoto(projectId, photo.id, false).then(hdUrl => {
    if (hdUrl) {
      imgEL.src = hdUrl;
    } else if (!src) {
      Toast.show('High-res photo not found', 'error');
    }
  });

  if (src) imgEL.src = src;
  else imgEL.src = ''; 
  
  imgEL.alt = photo.name;

  // Clear histogram
  const canvas = document.getElementById('histogram-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0, canvas.width, canvas.height);
  }

  imgEL.onload = () => {
    drawHistogram(imgEL);
  };
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('show');
}

function prevLightboxPhoto(e) {
  if (e) e.stopPropagation();
  openLightboxAt(window.CurrentLightboxIndex - 1);
}

function nextLightboxPhoto(e) {
  if (e) e.stopPropagation();
  openLightboxAt(window.CurrentLightboxIndex + 1);
}

function downloadLightboxPhoto() {
  if (!window.CurrentLightboxPhotos || window.CurrentLightboxIndex < 0 || window.CurrentLightboxIndex >= window.CurrentLightboxPhotos.length) return;
  const photo = window.CurrentLightboxPhotos[window.CurrentLightboxIndex];
  const projectId = window.CurrentLightboxProjectId;
  
  Toast.show('Menyiapkan file unduhan...', 'info');
  PhotoDB.getPhoto(projectId, photo.id, false).then(dataUrl => {
    if (dataUrl) {
      const link = document.createElement('a');
      link.download = photo.name;
      link.href = dataUrl;
      link.click();
      Toast.show('1 Foto diunduh', 'success');
    } else {
      Toast.show('Resolusi tinggi tidak ditemukan!', 'error');
    }
  });
}

async function bulkDownloadPhotos(projectId) {
  const count = SelectionState.totalSelected();
  if (count === 0) return;
  const selectedIds = new Set(SelectionState.selected);
  const photos = Store.getPhotos(projectId).filter(p => selectedIds.has(p.id));

  Swal.fire({
    title: 'Mempersiapkan ZIP...',
    text: 'Sedang mengkompresi foto-foto Anda...',
    allowOutsideClick: false,
    showConfirmButton: false,
    didOpen: async () => {
      Swal.showLoading();
      try {
        const zip = new JSZip();
        for (const photo of photos) {
          const dataUrl = await PhotoDB.getPhoto(projectId, photo.id, false);
          if (dataUrl) {
            const base64Data = dataUrl.split(',')[1];
            zip.file(photo.name, base64Data, {base64: true});
          }
        }
        
        const content = await zip.generateAsync({type:"blob"});
        const link = document.createElement('a');
        const projName = Store.get(projectId)?.name || 'Project';
        link.download = `BodaStudio_${projName}_${count}photos.zip`;
        link.href = URL.createObjectURL(content);
        link.click();
        
        Swal.close();
        Toast.show(`Berhasil mengunduh ${count} foto!`, 'success');
      } catch (err) {
        Swal.close();
        Toast.show('Terjadi kesalahan saat membuat ZIP', 'error');
        console.error(err);
      }
    }
  });
}

// Keyboard shortcuts for Lightbox
document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('lightbox');
  if (lb && lb.classList.contains('show')) {
    if (e.key === 'ArrowLeft') prevLightboxPhoto();
    if (e.key === 'ArrowRight') nextLightboxPhoto();
    if (e.key === 'Escape') closeLightbox();
  }
});

function drawHistogram(img) {
  const canvas = document.getElementById('histogram-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
  const w = 120; 
  const h = Math.round(120 / (img.naturalWidth/img.naturalHeight) || 120);
  if (w <= 0 || h <= 0) return;
  offCanvas.width = w;
  offCanvas.height = h;
  offCtx.drawImage(img, 0, 0, w, h);
  
  const imgData = offCtx.getImageData(0, 0, w, h).data;
  const rBin = new Array(256).fill(0);
  const gBin = new Array(256).fill(0);
  const bBin = new Array(256).fill(0);
  
  let maxCount = 0;
  for (let i = 0; i < imgData.length; i += 4) {
    rBin[imgData[i]]++;
    gBin[imgData[i+1]]++;
    bBin[imgData[i+2]]++;
  }
  for (let i=0; i<256; i++) {
     maxCount = Math.max(maxCount, rBin[i], gBin[i], bBin[i]);
  }
  
  ctx.clearRect(0,0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'screen';
  
  function drawChannel(bin, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let i=0; i<256; i++) {
        const x = (i / 256) * canvas.width;
        const y = canvas.height - ((bin[i] / maxCount) * canvas.height * 0.9);
        ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();
  }
  
  drawChannel(rBin, 'rgba(255, 60, 60, 0.8)');
  drawChannel(gBin, 'rgba(60, 255, 60, 0.8)');
  drawChannel(bBin, 'rgba(60, 60, 255, 0.8)');
}

function changeStatus(id) {
  const project = Store.get(id);
  if (!project) return;
  Swal.fire({
    title: 'Change Status',
    html: `<p> Update status for "<strong>${project.name}</strong>"</p > `,
    input: 'select',
    inputOptions: { pending: '⏳ Pending', processing: '🔄 Processing', ready: '✅ Ready' },
    inputValue: project.status,
    showCancelButton: true,
    confirmButtonText: 'Save',
    cancelButtonText: 'Cancel'
  }).then(result => {
    if (result.isConfirmed) {
      Store.update(id, { status: result.value });
      Toast.show('Status updated!', 'success');
      const hash = window.location.hash;
      if (hash.startsWith('#project/')) renderProject(id);
      else renderDashboard();
    }
  });
}

function deleteProject(id) {
  const project = Store.get(id);
  if (!project) return;
  Swal.fire({
    title: '⚠️ Delete Project',
    html: `<p> Are you sure you want to delete "<strong>${project.name}</strong>" ?</p >
  <p style="margin-top:0.5rem;font-size:0.85rem;opacity:0.7;">This action cannot be undone.</p>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, Delete',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#EF4444'
  }).then(result => {
    if (result.isConfirmed) {
      Store.delete(id);
      localStorage.removeItem('boda_selection_' + id);
      PhotoDB.deleteProjectPhotos(id);
      if (PhotoCache[id]) { delete PhotoCache[id]; }
      Toast.show('Project deleted', 'info');
      if (window.location.hash.startsWith('#project/')) {
        Router.navigate('#dashboard');
      } else {
        renderDashboard();
      }
    }
  });
}

// ── Add Individual Files (no folder restriction) ──
async function addFilesToProject(projectId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*';
  input.onchange = async () => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const files = Array.from(input.files).filter(f => imageTypes.includes(f.type));
    if (files.length === 0) { Toast.show('No images found', 'error'); return; }
    promptGoogleDriveSync(projectId, files);
  };
  input.click();
}

// ── Shared file processing for both addFiles and drag-drop ──
async function processAndAddFiles(projectId, files, syncToDrive = false) {
  const newMeta = files.map(f => ({ id: uuid(), name: f.name, size: f.size, type: f.type, path: f.webkitRelativePath || f.name }));
  Toast.show(`Adding ${newMeta.length} photos in batches...`, 'info', 2000);

  if (!PhotoCache[projectId]) PhotoCache[projectId] = {};

  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batchFiles = files.slice(i, i + BATCH_SIZE);
    const batchMeta = newMeta.slice(i, i + BATCH_SIZE);

    Toast.show(`Processing photos ${i + 1} to ${Math.min(i + BATCH_SIZE, files.length)} of ${files.length}...`, 'info', 1500);

    const batchUrls = {};
    const batchThumbs = {};
    const promises = batchFiles.map(async (f, j) => {
      const hdUrl = await fileToDataUrl(f, 2160, 0.9);
      const thumbUrl = await fileToDataUrl(f, 320, 0.6); // Fast grid preview
      batchUrls[batchMeta[j].id] = hdUrl;
      batchThumbs[batchMeta[j].id] = thumbUrl;
    });
    await Promise.all(promises);

    // Store only thumbnails in memory to keep memory usage low
    if (!PhotoCache[projectId]) PhotoCache[projectId] = {};
    Object.assign(PhotoCache[projectId], batchThumbs);

    await PhotoDB.savePhotoBatch(projectId, batchUrls); // Save HD to persistent store
    await PhotoDB.savePhotoBatch(projectId, batchThumbs, true); // Save Thumbs to persistent store

    // Sync to Drive
    if (syncToDrive && typeof CloudUploader !== 'undefined') {
      try {
        const project = Store.get(projectId);
        CloudUploader.add(projectId, project.name, batchMeta.map(pm => ({
          id: pm.id,
          name: pm.name,
          dataUrl: batchUrls[pm.id]
        })));
      } catch (e) { }
    }

    // Update thumbnail if project had none and this is the first batch
    const projectProps = {};
    if (i === 0) {
      const p = Store.get(projectId);
      if (!p.thumbnailData && batchMeta.length > 0) {
        const firstUrl = batchUrls[batchMeta[0].id];
        const img = new Image();
        await new Promise(res => {
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = 400; c.height = 250;
            const ctx = c.getContext('2d');
            const s = Math.max(400 / img.width, 250 / img.height);
            ctx.drawImage(img, (400 - img.width * s) / 2, (250 - img.height * s) / 2, img.width * s, img.height * s);
            projectProps.thumbnailData = c.toDataURL('image/jpeg', 0.5);
            res();
          };
          img.src = firstUrl;
        });
      }
    }

    // Incrementally update UI counters + save photos
    const currentMeta = Store.getPhotos(projectId);
    Store.savePhotos(projectId, [...currentMeta, ...batchMeta]);
    projectProps.photoCount = currentMeta.length + batchMeta.length;
    Store.update(projectId, projectProps);

    // Give UI thread a moment so browser doesn't freeze
    await new Promise(r => setTimeout(r, 75));
  }

  Toast.show(`Successfully added ${files.length} photos!`, 'success', 3000);

  // Re-render if we are already viewing it
  if (window.location.hash === '#project/' + projectId) {
    renderProject(projectId);
  }
}

// ── Drag & Drop on Project View ──
let _currentDragProjectId = null;
function setupProjectDragDrop(projectId) {
  _currentDragProjectId = projectId;

  // 1) Global overlay listeners for populated projects
  const overlay = document.getElementById('drop-overlay');
  document.removeEventListener('dragenter', _onDragEnter);
  document.removeEventListener('dragleave', _onDragLeave);
  document.removeEventListener('dragover', _onDragOver);
  document.removeEventListener('drop', _onDrop);

  document.addEventListener('dragenter', _onDragEnter);
  document.addEventListener('dragleave', _onDragLeave);
  document.addEventListener('dragover', _onDragOver);
  document.addEventListener('drop', _onDrop);

  // 2) Inline-upload zone handlers (if empty state)
  const inlineZone = document.getElementById('inline-upload');
  if (inlineZone) {
    inlineZone.addEventListener('dragover', e => {
      e.preventDefault();
      inlineZone.classList.add('dragover');
    });
    inlineZone.addEventListener('dragleave', e => {
      inlineZone.classList.remove('dragover');
    });
    inlineZone.addEventListener('drop', e => {
      e.preventDefault();
      inlineZone.classList.remove('dragover');
      handleProjectDrop(projectId, e.dataTransfer.files);
    });

    // Make clicking the zone open the file picker (like Smart Import)
    inlineZone.style.cursor = 'pointer';
    inlineZone.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') {
        addFilesToProject(projectId);
      }
    };
  }
}

function handleProjectDrop(projectId, fileList) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const files = Array.from(fileList).filter(f => imageTypes.includes(f.type));
  if (files.length === 0) { Toast.show('No image files found', 'error'); return; }
  promptGoogleDriveSync(projectId, files);
}

function promptGoogleDriveSync(projectId, files) {
  if (!SettingsState.gasUrl || typeof CloudUploader === 'undefined') {
    processAndAddFiles(projectId, files, false);
    return;
  }
  Swal.fire({
    title: '☁️ Cloud Sync',
    text: `Backup ${files.length} foto ini ke Google Drive otomatis?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Ya, Backup',
    cancelButtonText: 'Tidak, Lokal Saja',
    confirmButtonColor: 'var(--primary)',
    cancelButtonColor: '#6b7280',
    reverseButtons: true
  }).then(result => {
    processAndAddFiles(projectId, files, result.isConfirmed);
  });
}

function _onDragEnter(e) {
  e.preventDefault();
  if (e.dataTransfer.types.includes('Files') && window.location.hash.startsWith('#project/')) {
    const inlineZone = document.getElementById('inline-upload');
    if (!inlineZone) document.getElementById('drop-overlay').classList.add('show');
  }
}
function _onDragLeave(e) {
  if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
    document.getElementById('drop-overlay').classList.remove('show');
  }
}
function _onDragOver(e) { e.preventDefault(); }
function _onDrop(e) {
  e.preventDefault();
  document.getElementById('drop-overlay').classList.remove('show');
  if (!_currentDragProjectId || !window.location.hash.startsWith('#project/')) return;
  const inlineZone = document.getElementById('inline-upload');
  if (inlineZone && inlineZone.contains(e.target)) return; // Handled by inline zone
  handleProjectDrop(_currentDragProjectId, e.dataTransfer.files);
}

// ── Context Menu ──
function showContextMenu(e, el) {
  e.preventDefault();
  e.stopPropagation();
  // Remove existing menu
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());

  const photoId = el.dataset.id;
  const projectId = el.dataset.project;
  const photoName = el.dataset.name;
  const photoSize = el.dataset.size;
  const photoType = el.dataset.type;

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <button class="ctx-item" onclick="ctxView('${projectId}','${photoId}','${photoName.replace(/'/g, "\\'")}')"><span class="ctx-icon">👁️</span> View Photo</button>
    <button class="ctx-item" onclick="renamePhoto('${projectId}','${photoId}')"><span class="ctx-icon">✏️</span> Rename</button>
    <button class="ctx-item" onclick="showPhotoInfo('${photoId}','${projectId}')"><span class="ctx-icon">ℹ️</span> Photo Info</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item danger" onclick="deletePhoto('${projectId}','${photoId}','${photoName.replace(/'/g, "\\'")}')"><span class="ctx-icon">🗑️</span> Delete</button>
  `;

  // Position
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);

  // Close on click outside
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

function ctxView(projectId, photoId, photoName) {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  if (window.CurrentLightboxPhotos && window.CurrentLightboxProjectId === projectId) {
    const idx = window.CurrentLightboxPhotos.findIndex(p => p.id === photoId);
    if (idx !== -1) openLightboxAt(idx);
  }
}

// ── Rename Photo ──
function renamePhoto(projectId, photoId) {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  const photos = Store.getPhotos(projectId);
  const photo = photos.find(p => p.id === photoId);
  if (!photo) return;

  Swal.fire({
    title: '✏️ Rename Photo',
    input: 'text',
    inputValue: photo.name,
    showCancelButton: true,
    confirmButtonText: 'Rename',
    cancelButtonText: 'Cancel',
    inputValidator: v => { if (!v?.trim()) return 'Name cannot be empty'; }
  }).then(result => {
    if (result.isConfirmed) {
      photo.name = result.value.trim();
      Store.savePhotos(projectId, photos);
      Toast.show('Photo renamed!', 'success');
      renderProject(projectId);
    }
  });
}

// ── Photo Info ──
function showPhotoInfo(photoId, projectId) {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  const photos = Store.getPhotos(projectId);
  const photo = photos.find(p => p.id === photoId);
  if (!photo) return;
  const score = SelectionState.getScore(photoId);
  const isSelected = SelectionState.isSelected(photoId);
  const isLiked = SelectionState.isLiked(photoId);

  Swal.fire({
    title: 'ℹ️ Photo Info',
    html: `< dl class="photo-info-grid">
            <dt>Name</dt><dd>${photo.name}</dd>
            <dt>Size</dt><dd>${formatSize(photo.size)}</dd>
            <dt>Type</dt><dd>${photo.type}</dd>
            <dt>Score</dt><dd>${score}/100</dd>
            <dt>Selected</dt><dd>${isSelected ? '✓ Yes' : '✕ No'}</dd>
            <dt>Liked</dt><dd>${isLiked ? '❤️ Yes' : 'No'}</dd>
            <dt>ID</dt><dd style="font-size:0.7rem;opacity:0.5;">${photo.id}</dd>
        </dl > `,
    confirmButtonText: 'Close',
    showCancelButton: false
  });
}

// ── Delete Single Photo ──
function deletePhoto(projectId, photoId, photoName) {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  Swal.fire({
    title: '🗑️ Delete Photo',
    html: `<p> Delete "<strong>${photoName}</strong>" ?</p > `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#EF4444'
  }).then(async result => {
    if (result.isConfirmed) {
      let photos = Store.getPhotos(projectId);
      photos = photos.filter(p => p.id !== photoId);
      Store.savePhotos(projectId, photos);
      Store.update(projectId, { photoCount: photos.length });
      // Remove from cache
      if (PhotoCache[projectId]) delete PhotoCache[projectId][photoId];
      // Remove from selection state
      SelectionState.selected.delete(photoId);
      SelectionState.liked.delete(photoId);
      SelectionState.locked.delete(photoId);
      SelectionState.save();
      Toast.show('Photo deleted', 'info');
      renderProject(projectId);
    }
  });
}

// ── Bulk Delete Selected Photos ──
function bulkDeletePhotos(projectId) {
  const count = SelectionState.totalSelected();
  if (count === 0) return;
  Swal.fire({
    title: '🗑️ Delete Selected',
    html: `<p> Delete <strong> ${count}</strong > selected photos ?</p >
  <p style="margin-top:0.5rem;font-size:0.85rem;opacity:0.7;">This cannot be undone.</p>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: `Delete ${count} Photos`,
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#EF4444'
  }).then(async result => {
    if (result.isConfirmed) {
      const selectedIds = new Set(SelectionState.selected);
      let photos = Store.getPhotos(projectId);
      photos = photos.filter(p => !selectedIds.has(p.id));
      Store.savePhotos(projectId, photos);
      Store.update(projectId, { photoCount: photos.length });
      // Clean cache
      if (PhotoCache[projectId]) {
        selectedIds.forEach(id => delete PhotoCache[projectId][id]);
      }
      // Reset selection
      SelectionState.selected = new Set();
      SelectionState.liked = new Set([...SelectionState.liked].filter(id => !selectedIds.has(id)));
      SelectionState.locked = new Set([...SelectionState.locked].filter(id => !selectedIds.has(id)));
      SelectionState.save();
      Toast.show(`${count} photos deleted`, 'info');
      renderProject(projectId);
    }
  });
}

// ── Rename Project from Project View ──
function renameProjectInline(projectId) {
  const project = Store.get(projectId);
  if (!project) return;
  Swal.fire({
    title: '✏️ Rename Project',
    input: 'text',
    inputValue: project.name,
    showCancelButton: true,
    confirmButtonText: 'Rename',
    cancelButtonText: 'Cancel',
    inputValidator: v => { if (!v?.trim()) return 'Name cannot be empty'; }
  }).then(result => {
    if (result.isConfirmed) {
      Store.update(projectId, { name: result.value.trim() });
      Toast.show('Project renamed!', 'success');
      renderProject(projectId);
    }
  });
}

// ══════════════════════════════════════
// PHASE 3 — IG Builder & Live Preview
// ══════════════════════════════════════

const IGLiveState = {
  sessionId: null,
  isActive: false,
  timeoutRef: null,
  
  toggleLive() {
    this.isActive = !this.isActive;
    const btn = document.getElementById('live-preview-btn');
    const badge = document.getElementById('live-badge');
    
    if (this.isActive) {
      if (!this.sessionId) this.sessionId = Math.random().toString(36).substr(2, 6);
      this.showQRCode();
      if(btn) { btn.classList.add('btn-primary'); btn.style.background = 'var(--accent)'; }
      if(badge) badge.style.display = 'inline-block';
      this.syncLive();
    } else {
      if (this.sessionId && fbRealtime) {
        fbRealtime.ref('ig_live_preview/' + this.sessionId).remove();
      }
      this.sessionId = null;
      if(btn) { btn.classList.remove('btn-primary'); btn.style.background = ''; }
      if(badge) badge.style.display = 'none';
      if(window.Toast) Toast.show('Live Preview dimatikan', 'info');
    }
  },
  
  showQRCode() {
    const url = "https://link-bod.firebaseapp.com/#live/" + this.sessionId;
    const qrUrl = `https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=${encodeURIComponent(url)}`;
    Swal.fire({
      title: 'Scan untuk Live Preview',
      html: `
        <img src="${qrUrl}" style="margin: 0 auto; display: block; border-radius: 8px;">
        <p style="margin-top: 1rem; font-size: 0.9rem; color: #555;">Scan kode ini menggunakan HP Anda.</p>
        <p style="margin-top: 0.5rem; font-size: 0.70rem; word-wrap: break-word;"><a href="${url}" target="_blank">${url}</a></p>
      `,
      confirmButtonText: 'Tutup',
      background: 'rgba(255, 255, 255, 0.95)'
    });
  },

  syncLive() {
    if (!this.isActive || !this.sessionId || !fbRealtime) return;
    clearTimeout(this.timeoutRef);
    this.timeoutRef = setTimeout(async () => {
      const slides = document.querySelectorAll('.ig-slide');
      if (!slides.length) return;
      if (Swal.isVisible()) return; // Don't sync when UI is blocked
      
      const renders = [];
      for (const slide of slides) {
        try {
          const canvas = await html2canvas(slide, { scale: 0.4, useCORS: true, logging: false });
          renders.push(canvas.toDataURL('image/jpeg', 0.6));
        } catch(e) {}
      }
      if (renders.length > 0) {
        fbRealtime.ref('ig_live_preview/' + this.sessionId).update({
          status: 'live',
          updatedAt: Date.now(),
          slides: renders
        });
      }
    }, 1500); 
  },

  async pushHD() {
    if (!this.isActive || !this.sessionId || !fbRealtime) {
      if(window.Toast) Toast.show('Silakan aktifkan Live (QR Code) terlebih dahulu.', 'warning');
      return;
    }
    Swal.fire({ title: 'Merender HD...', text: 'Mengirim kualitas tinggi ke HP Anda', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    const slides = document.querySelectorAll('.ig-slide');
    const renders = [];
    for (const slide of slides) {
      try {
        const canvas = await html2canvas(slide, { scale: 1.5, useCORS: true, logging: false });
        renders.push(canvas.toDataURL('image/jpeg', 0.85));
      } catch(e) {}
    }
    if (renders.length > 0) {
      fbRealtime.ref('ig_live_preview/' + this.sessionId).update({
        status: 'hd',
        updatedAt: Date.now(),
        slidesHD: renders
      }).then(() => {
        Swal.fire('Berhasil Terkirim', 'Silakan unduh gambar dari layar HP Anda (Long Press -> Save).', 'success');
      }).catch(() => {
        Swal.fire('Gagal', 'Terjadi kesalahan jaringan.', 'error');
      });
    } else {
        Swal.close();
    }
  }
};

// ── Modal: New Project (SweetAlert2) ──
function showNewProjectModal() {
  Swal.fire({
    title: 'New Project',
    input: 'text',
    inputPlaceholder: 'e.g. Event OSIS 2026',
    inputAttributes: { autocapitalize: 'off' },
    showCancelButton: true,
    confirmButtonText: 'Create',
    cancelButtonText: 'Cancel',
    inputValidator: (value) => { if (!value?.trim()) return 'Please enter a project name'; }
  }).then(result => {
    if (result.isConfirmed) {
      const name = result.value.trim();
      Store.create(name);
      Toast.show(`Project "${name}" created!`, 'success');
      renderDashboard();
    }
  });
}

// ══════════════════════════════════════
// PHASE 3 — IG Slide Builder
// ══════════════════════════════════════

const IGBuilderState = {
  projectId: null,
  format: '4:5',
  slides: [], // { id, topId, bottomId }
  activePhotoId: null, // For point & click support

  setFormat(format) {
    this.format = format;
    if (this.projectId) {
      localStorage.setItem('boda_ig_format_' + this.projectId, format);
    }
  },

  load(projectId) {
    this.projectId = projectId;
    this.format = localStorage.getItem('boda_ig_format_' + projectId) || '4:5';
    const loaded = JSON.parse(localStorage.getItem('boda_ig_slides_' + projectId) || '[]');
    this.slides = loaded.map(s => ({
      ...s,
      layout: s.layout || 'split',
      topTransform: s.topTransform || { x: 0, y: 0, scale: 1 },
      bottomTransform: s.bottomTransform || { x: 0, y: 0, scale: 1 }
    }));
    if (this.slides.length === 0) this.addSlide();
  },
  save() {
    if (this.projectId) {
      localStorage.setItem('boda_ig_slides_' + this.projectId, JSON.stringify(this.slides));
    }
    if (typeof IGLiveState !== 'undefined') IGLiveState.syncLive();
  },
  addSlide() {
    this.slides.push({
      id: uuid(),
      layout: 'split',
      topId: null,
      bottomId: null,
      topTransform: { x: 0, y: 0, scale: 1 },
      bottomTransform: { x: 0, y: 0, scale: 1 }
    });
    this.save();
  },
  removeSlide(slideId) {
    this.slides = this.slides.filter(s => s.id !== slideId);
    if (this.slides.length === 0) this.addSlide();
    this.save();
  },
  updateSlide(slideId, slot, photoId) {
    const slide = this.slides.find(s => s.id === slideId);
    if (slide) {
      slide[slot] = photoId;
      this.save();
    }
  },
  swapSlide(slideId) {
    const slide = this.slides.find(s => s.id === slideId);
    if (slide) {
      const temp = slide.topId;
      slide.topId = slide.bottomId;
      slide.bottomId = temp;

      const tempT = slide.topTransform;
      slide.topTransform = slide.bottomTransform;
      slide.bottomTransform = tempT;

      this.save();
    }
  },
  toggleLayout(slideId) {
    const slide = this.slides.find(s => s.id === slideId);
    if (slide) {
      slide.layout = slide.layout === 'split' ? 'single' : 'split';
      this.save();
    }
  },
  resetTransform(slideId, slotPrefix) {
    const slide = this.slides.find(s => s.id === slideId);
    if (slide) {
      slide[slotPrefix + 'Transform'] = { x: 0, y: 0, scale: 1 };
      this.save();
    }
  }
};

async function renderIGBuilder() {
  const main = document.getElementById('main-content');
  const projects = Store.getAll();

  if (projects.length === 0) {
    main.innerHTML = `<div class="page-enter">
  <div class="page-header"><h2>IG Builder</h2><p>No projects available.</p></div>
    </div> `;
    return;
  }

  if (!IGBuilderState.projectId || !projects.find(p => p.id === IGBuilderState.projectId)) {
    IGBuilderState.projectId = projects[0].id;
  }

  IGBuilderState.load(IGBuilderState.projectId);

  let html = `<div class="page-enter" style = "height:100%;">
    <div class="page-header" style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h2>IG Slide Builder 🔥</h2>
        <p>Drag photos to create perfect ${IGBuilderState.format === '9:16' ? '1080x1920' : '1080x1350'} canvas for Instagram</p>
      </div>
      <div style="display:flex;gap:0.75rem;align-items:center;">
        <div style="display:flex;gap:0.5rem;align-items:center;background:rgba(255,255,255,0.05);padding:0.25rem;border-radius:var(--radius-sm);margin-right:0.5rem;">
          <button id="live-preview-btn" class="btn btn-ghost btn-sm ${IGLiveState.isActive ? 'btn-primary' : ''}" style="${IGLiveState.isActive ? 'background:var(--accent)' : ''}" onclick="IGLiveState.toggleLive()">📱 Live <span id="live-badge" style="display:${IGLiveState.isActive ? 'inline-block' : 'none'};width:8px;height:8px;background:red;border-radius:50%;margin-left:4px;animation:pulse 1.5s infinite;"></span></button>
          <button class="btn btn-ghost btn-sm" onclick="IGLiveState.pushHD()">🚀 Push HD</button>
        </div>
        <select class="btn btn-ghost" onchange="IGBuilderState.setFormat(this.value);renderIGBuilder()" style="padding:0.5rem 1rem;background:var(--bg-glass);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:var(--radius-xs);">
          <option value="4:5" ${IGBuilderState.format === '4:5' ? 'selected' : ''}>4:5 (1080x1350)</option>
          <option value="9:16" ${IGBuilderState.format === '9:16' ? 'selected' : ''}>9:16 (1080x1920)</option>
        </select>
        <select class="btn btn-ghost" onchange="switchIGProject(this.value)" style="padding:0.5rem 1rem;background:var(--bg-glass);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:var(--radius-xs);">
          ${projects.map(p => `<option value="${p.id}" ${p.id === IGBuilderState.projectId ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="IGBuilderState.addSlide();renderIGSlides();">+ Add Slide</button>
        <button class="btn btn-primary" onclick="batchExportIGSlides()" style="background:var(--success);">📥 PC Export All</button>
      </div>
    </div>
    
    <div class="ig-builder-layout">
      <!-- Sidebar / Photo Pool -->
      <aside class="ig-sidebar" id="ig-sidebar">
        <h4 style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.5rem;">Available Photos</h4>
        <div class="photo-grid" id="ig-photo-pool">
          <!-- Rendered in JS after loading cache -->
        </div>
      </aside>
      
      <!-- Main Canvas Area -->
      <main class="ig-main" id="ig-main">
        <div class="ig-slides-container" id="ig-slides-container">
          <!-- Slides rendered here -->
        </div>
      </main>
    </div>
  </div> `;

  main.innerHTML = html;

  const photos = Store.getPhotos(IGBuilderState.projectId);
  if (photos.length > 0) {
    if (!PhotoCache[IGBuilderState.projectId] || Object.keys(PhotoCache[IGBuilderState.projectId]).length < photos.length) {
      PhotoCache[IGBuilderState.projectId] = await PhotoDB.loadProjectPhotos(IGBuilderState.projectId, photos.map(p => p.id), true);
    }
  }

  // Initially render slides and pool dynamically
  renderIGSlides();
}

function renderIGPhotoPool() {
  const container = document.getElementById('ig-photo-pool');
  if (!container) return;

  const photos = Store.getPhotos(IGBuilderState.projectId);
  SelectionState.load(IGBuilderState.projectId);
  
  let poolPhotos = photos;
  if (SelectionState.selected.size > 0) {
    poolPhotos = photos.filter(p => SelectionState.isSelected(p.id));
  } else if (SelectionState.autoSuggested.size > 0) {
    poolPhotos = photos.filter(p => SelectionState.isAutoSuggested(p.id));
  }

  // Sembunyikan foto yang sudah dipakai
  const usedIds = new Set();
  IGBuilderState.slides.forEach(slide => {
    if (slide.topId) usedIds.add(slide.topId);
    if (slide.layout !== 'single' && slide.bottomId) usedIds.add(slide.bottomId);
  });
  
  poolPhotos = poolPhotos.filter(p => !usedIds.has(p.id));

  const poolHtml = poolPhotos.map(p => {
    const url = PhotoCache[IGBuilderState.projectId] ? PhotoCache[IGBuilderState.projectId][p.id] : null;
    const isActive = IGBuilderState.activePhotoId === p.id;
    return `
      <div class="photo-item ${isActive ? 'selected' : ''}" style="${isActive ? 'border-color:var(--primary); box-shadow: 0 0 0 2px var(--primary);' : ''}" draggable="true" ondragstart="igDragStart(event, '${p.id}')" onclick="igPhotoClick('${p.id}')">
        ${url ? `<img src="${url}" alt="${p.name}">` : `<div style="padding:1rem;">🖼️</div>`}
        <div class="photo-name" style="font-size:0.55rem;padding:0.25rem;">${p.name}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = poolHtml || `<div style="grid-column:1/-1;text-align:center;font-size:0.8rem;color:var(--text-muted);padding:2rem 0;">Semua foto yang direkomendasikan sudah masuk ke Grid! 🎉</div>`;
}
function switchIGProject(projectId) {
  IGBuilderState.projectId = projectId;
  renderIGBuilder();
}

function renderIGSlides() {
  const container = document.getElementById('ig-slides-container');
  if (!container) return;
  const projectCache = PhotoCache[IGBuilderState.projectId] || {};

  container.innerHTML = IGBuilderState.slides.map((slide, idx) => {
    const topUrl = projectCache[slide.topId];
    const botUrl = projectCache[slide.bottomId];

    const slideAspectRatio = IGBuilderState.format === '9:16' ? '1080 / 1920' : '1080 / 1350';

    return `
      <div class="slide-wrap" draggable="true" ondragstart="igSlideDragStart(event, ${idx})" ondragend="igSlideDragEnd(event)" ondragover="igSlideDragOver(event)" ondragleave="igSlideDragLeave(event)" ondrop="igSlideDrop(event, ${idx})" style="transition: transform 0.2s, box-shadow 0.2s; cursor: grab;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
          <div class="slide-badge" style="background:rgba(255,255,255,0.05); padding:0.3rem 0.75rem; border-radius:12px; font-size:0.75rem; font-weight:700; color:var(--text-secondary); border:1px solid var(--border-glass);">
            ${idx + 1} / ${IGBuilderState.slides.length}
          </div>
          <div style="font-size:0.75rem; color:var(--text-muted); opacity:0.6;"><i class="fa-solid fa-grip-lines"></i> Geser</div>
        </div>

        <div class="slide-card layout-${slide.layout}" id="ig-slide-${slide.id}" style="aspect-ratio: ${slideAspectRatio};">
          <div class="slide-slot ${topUrl ? 'has-photo' : ''}" 
               ondragover="igDragOver(event)" ondragleave="igDragLeave(event)" ondrop="igDrop(event, '${slide.id}', 'topId')"
               onclick="igSlotClick('${slide.id}', 'topId')"
               onwheel="${topUrl ? `igZoom(event, '${slide.id}', 'top')` : ''}"
               onmousedown="${topUrl ? `igPanStart(event, '${slide.id}', 'top')` : ''}">
            ${topUrl ? `
              <img src="${topUrl}" id="img-${slide.id}-top" draggable="true" ondragstart="igSlotDragStart(event, '${slide.topId}', '${slide.id}', 'topId')" onload="igImageLoaded('${slide.id}', 'top')">
              <div class="slot-controls">
                <button onclick="event.stopPropagation(); IGBuilderState.resetTransform('${slide.id}', 'top');renderIGSlides();">Reset</button>
              </div>
            ` : `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;color:var(--text-muted);pointer-events:none;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              <span style="font-size:0.7rem;font-weight:600;">Tarik Foto</span>
            </div>
            `}
          </div>
          <div class="slide-slot ${botUrl ? 'has-photo' : ''}"
               ondragover="igDragOver(event)" ondragleave="igDragLeave(event)" ondrop="igDrop(event, '${slide.id}', 'bottomId')"
               onclick="igSlotClick('${slide.id}', 'bottomId')"
               onwheel="${botUrl ? `igZoom(event, '${slide.id}', 'bottom')` : ''}"
               onmousedown="${botUrl ? `igPanStart(event, '${slide.id}', 'bottom')` : ''}">
            ${botUrl ? `
              <img src="${botUrl}" id="img-${slide.id}-bottom" draggable="true" ondragstart="igSlotDragStart(event, '${slide.bottomId}', '${slide.id}', 'bottomId')" onload="igImageLoaded('${slide.id}', 'bottom')">
              <div class="slot-controls">
                <button onclick="event.stopPropagation(); IGBuilderState.resetTransform('${slide.id}', 'bottom');renderIGSlides();">Reset</button>
              </div>
            ` : `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;color:var(--text-muted);pointer-events:none;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              <span style="font-size:0.7rem;font-weight:600;">Tarik Foto</span>
            </div>
            `}
          </div>
        </div>
        
        <div class="slide-actions" style="display:flex; gap:0.4rem; margin-top:0.25rem;">
          <button class="format-btn ${slide.layout === 'split' ? 'active' : ''}" style="flex:1;" onclick="IGBuilderState.toggleLayout('${slide.id}');renderIGSlides();">
             ${slide.layout === 'split' ? '✂️ Split' : '📄 Tunggal'}
          </button>
          <button class="format-btn" style="flex:1; ${slide.layout === 'single' ? 'opacity:0.4;cursor:not-allowed;' : ''}" onclick="IGBuilderState.swapSlide('${slide.id}');renderIGSlides();" ${slide.layout === 'single' ? 'disabled' : ''}>
            ⇅ Tukar
          </button>
          <button class="format-btn" style="flex:none; width:36px; border-color:rgba(16,185,129,0.3); color:var(--success);" onclick="exportIGSlide('${slide.id}', ${idx + 1})" title="Export Slide">
            📥
          </button>
          <button class="format-btn" style="flex:none; width:36px; border-color:rgba(239,68,68,0.3); color:var(--danger);" onclick="IGBuilderState.removeSlide('${slide.id}');renderIGSlides();" title="Hapus Slide">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Sinkronisasi pool untuk hilangkan foto yang sudah dipakai
  renderIGPhotoPool();
}

function igDragStart(e, photoId) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'pool', photoId }));
  e.dataTransfer.effectAllowed = 'copyMove';
}

function igSlotDragStart(e, photoId, slideId, slotPrefix) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'slot', photoId, slideId, slotPrefix }));
  e.dataTransfer.effectAllowed = 'move';
}

function igSlideDragStart(e, index) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'slide', index }));
  e.dataTransfer.effectAllowed = 'move';
  e.stopPropagation();
  setTimeout(() => e.target.style.opacity = '0.4', 0);
}

function igSlideDragEnd(e) {
  e.target.style.opacity = '1';
}

function igSlideDragOver(e) {
  e.preventDefault();
  e.currentTarget.style.transform = 'scale(1.02)';
  e.currentTarget.style.borderLeft = '4px solid var(--primary)';
}

function igSlideDragLeave(e) {
  e.currentTarget.style.transform = '';
  e.currentTarget.style.borderLeft = '';
}

function igSlideDrop(e, targetIndex) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.style.transform = '';
  e.currentTarget.style.borderLeft = '';
  
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (data.type === 'slide') {
      const sourceIndex = data.index;
      if (typeof sourceIndex === 'number' && sourceIndex !== targetIndex) {
        const item = IGBuilderState.slides.splice(sourceIndex, 1)[0];
        let newTargetIndex = targetIndex;
        if (sourceIndex < targetIndex) newTargetIndex--;
        IGBuilderState.slides.splice(newTargetIndex, 0, item);
        IGBuilderState.save();
        renderIGSlides();
      }
    }
  } catch(err) {}
}

function igDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('drag-over');
}

function igDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function igDrop(e, slideId, slot) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (data.type === 'pool') {
      IGBuilderState.updateSlide(slideId, slot, data.photoId);
      renderIGSlides();
    } else if (data.type === 'slot') {
      IGBuilderState.updateSlide(slideId, slot, data.photoId);
      if (data.slideId !== slideId || data.slotPrefix !== slot) {
        IGBuilderState.updateSlide(data.slideId, data.slotPrefix, null);
      }
      renderIGSlides();
    }
  } catch (err) {
    const photoId = e.dataTransfer.getData('text/plain');
    if (photoId && !photoId.startsWith('{')) {
      IGBuilderState.updateSlide(slideId, slot, photoId);
      renderIGSlides();
    }
  }
}

function igPhotoClick(photoId) {
  if (IGBuilderState.activePhotoId === photoId) {
    IGBuilderState.activePhotoId = null;
  } else {
    IGBuilderState.activePhotoId = photoId;
  }
  renderIGPhotoPool();
}

function igSlotClick(slideId, slotPrefix) {
  if (IGBuilderState.activePhotoId) {
    IGBuilderState.updateSlide(slideId, slotPrefix, IGBuilderState.activePhotoId);
    IGBuilderState.activePhotoId = null;
    renderIGBuilder();
  }
}

function igImageLoaded(slideId, slotPrefix) {
  const img = document.getElementById(`img-${slideId}-${slotPrefix}`);
  if (!img) return;
  const slotEl = img.parentElement;
  if (!slotEl) return;

  const rect = slotEl.getBoundingClientRect();
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;

  const slotRatio = rect.width / rect.height;
  const imgRatio = natW / natH;

  let baseW_pct = 100, baseH_pct = 100;
  if (imgRatio > slotRatio) {
    baseW_pct = 100 * (imgRatio / slotRatio);
  } else {
    baseH_pct = 100 * (slotRatio / imgRatio);
  }

  img.style.width = baseW_pct + '%';
  img.style.height = baseH_pct + '%';
  img.style.maxWidth = 'none';
  img.style.objectFit = 'fill';

  applySnapConstraints(slideId, slotPrefix);
}

function applySnapConstraints(slideId, slotPrefix) {
  const slide = IGBuilderState.slides.find(s => s.id === slideId);
  const img = document.getElementById(`img-${slideId}-${slotPrefix}`);
  if (!slide || !img) return;
  const slotEl = img.parentElement;
  if (!slotEl) return;

  const rect = slotEl.getBoundingClientRect();
  const t = slide[slotPrefix + 'Transform'];

  if (t.scale < 1) t.scale = 1;

  const activeW = img.offsetWidth * t.scale;
  const activeH = img.offsetHeight * t.scale;

  const maxX = Math.max(0, (activeW - rect.width) / 2);
  const maxY = Math.max(0, (activeH - rect.height) / 2);

  if (t.x > maxX) t.x = maxX;
  if (t.x < -maxX) t.x = -maxX;
  if (t.y > maxY) t.y = maxY;
  if (t.y < -maxY) t.y = -maxY;

  img.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
}

function igZoom(e, slideId, slotPrefix) {
  if (e.ctrlKey || e.metaKey) return;
  e.preventDefault();

  const slide = IGBuilderState.slides.find(s => s.id === slideId);
  if (!slide) return;
  const slotKey = slotPrefix + 'Transform';
  let t = slide[slotKey];

  const delta = e.deltaY * -0.002;
  t.scale = Math.min(Math.max(1, t.scale + delta), 5);

  applySnapConstraints(slideId, slotPrefix);
  IGBuilderState.save();
}

let _isPanning = false;
let _panState = null;

function igPanStart(e, slideId, slotPrefix) {
  e.preventDefault();
  if (e.target.tagName.toLowerCase() === 'button') return;
  _isPanning = true;

  const slide = IGBuilderState.slides.find(s => s.id === slideId);
  if (!slide) return;
  const slotKey = slotPrefix + 'Transform';
  const t = slide[slotKey];

  _panState = {
    slideId,
    slotPrefix,
    slotKey,
    startX: e.clientX,
    startY: e.clientY,
    origX: t.x,
    origY: t.y,
    img: document.getElementById(`img-${slideId}-${slotPrefix}`)
  };

  document.addEventListener('mousemove', igPanMove);
  document.addEventListener('mouseup', igPanEnd);
}

function igPanMove(e) {
  if (!_isPanning || !_panState) return;
  const slide = IGBuilderState.slides.find(s => s.id === _panState.slideId);
  if (!slide) return;

  const dx = e.clientX - _panState.startX;
  const dy = e.clientY - _panState.startY;

  const t = slide[_panState.slotKey];
  t.x = _panState.origX + dx;
  t.y = _panState.origY + dy;

  applySnapConstraints(_panState.slideId, _panState.slotPrefix);
}

function igPanEnd() {
  _isPanning = false;
  _panState = null;
  document.removeEventListener('mousemove', igPanMove);
  document.removeEventListener('mouseup', igPanEnd);
  IGBuilderState.save();
}

async function exportIGSlide(slideId, index) {
  const el = document.getElementById('ig-slide-' + slideId);
  if (!el) return;

  Toast.show(`Exporting Slide ${index}...`, 'info', 2000);

  try {
    const canvas = await html2canvas(el, {
      scale: 2160 / el.offsetWidth,
      useCORS: true,
      backgroundColor: '#0A0F1C'
    });

    const link = document.createElement('a');
    link.download = `BodaStudio_Slide_${index}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    Toast.show(`Slide ${index} Exported!`, 'success');
  } catch (err) {
    console.error(err);
    Toast.show('Export failed', 'error');
  }
}

async function batchExportIGSlides() {
  if (IGBuilderState.slides.length === 0) return;
  Toast.show(`Batch exporting ${IGBuilderState.slides.length} slides...`, 'info', 3000);

  for (let i = 0; i < IGBuilderState.slides.length; i++) {
    await exportIGSlide(IGBuilderState.slides[i].id, i + 1);
    await new Promise(r => setTimeout(r, 600));
  }
  Toast.show('Batch Export Complete!', 'success');
}

// ══════════════════════════════════════
// PHASE 4 — Branding
// ══════════════════════════════════════

const BrandingState = {
  projectId: null,
  tab: 'library', // 'library' or 'editor'
  logos: (function() {
    try { 
      const d = JSON.parse(localStorage.getItem('boda_branding_logos') || '[]');
      return Array.isArray(d) ? d : [];
    } catch(e) { return []; }
  })(),
  selectedLogoIndex: parseInt(localStorage.getItem('boda_branding_selected_logo') || '0', 10),
  position: localStorage.getItem('boda_branding_pos') || 'wm-br',
  size: parseInt(localStorage.getItem('boda_branding_size') || '30', 10),
  opacity: parseInt(localStorage.getItem('boda_branding_opacity') || '80', 10),

  // ── MULTI-TEXT LAYERS ──
  titleEnabled: localStorage.getItem('boda_title_enabled') !== 'false',
  texts: (function() {
    try { 
      const d = JSON.parse(localStorage.getItem('boda_texts') || '[]');
      return Array.isArray(d) ? d : [];
    } catch(e) { return []; }
  })(),
  activeTextIndex: 0,
  customFonts: (function() {
    try { 
      const d = JSON.parse(localStorage.getItem('boda_custom_fonts') || '[]');
      return Array.isArray(d) ? d : [];
    } catch(e) { return []; }
  })(),

  setTab(tab) {
    this.tab = tab;
    renderBranding();
  },

  get logoUrl() {
    return this.logos[this.selectedLogoIndex] || null;
  },

  getActiveText() {
    return this.texts[this.activeTextIndex];
  },

  updateActiveText(key, value) {
    if (this.texts[this.activeTextIndex]) {
      this.texts[this.activeTextIndex][key] = value;
      this.saveState();
    }
  },

  addTextLayer() {
    this.texts.push({
      id: "text_" + Date.now(),
      text: 'Layer ' + (this.texts.length + 1),
      font: 'Inter',
      size: 32,
      color: '#FFFFFF',
      align: 'center',
      position: 'bottom', // legacy
      posX: 50,
      posY: 80,
      bg: 'rgba(0,0,0,0.45)',
      weight: '700',
      style: 'normal',
      transform: 'none'
    });
    this.activeTextIndex = this.texts.length - 1;
    this.saveState();
  },

  removeTextLayer(index) {
    this.texts.splice(index, 1);
    if (this.texts.length === 0) this.addTextLayer();
    if (this.activeTextIndex >= this.texts.length) {
      this.activeTextIndex = Math.max(0, this.texts.length - 1);
    }
    this.saveState();
  },

  setActiveTextIndex(idx) {
    this.activeTextIndex = idx;
    // We don't save active index to localStorage so it resets to 0 on reload.
  },

  initMigrate() {
    if (typeof _injectCustomFonts === 'function') {
      _injectCustomFonts(); // Ensure custom fonts are loaded
    }

    if (this.logos.length === 0) {
      const old = localStorage.getItem('boda_branding_logo');
      if (old) {
        this.logos.push(old);
        this.saveState();
        localStorage.removeItem('boda_branding_logo');
      }
    }

    // Migrate old single title to Multi-Text
    if (this.texts.length === 0 && localStorage.getItem('boda_title_text')) {
      const legacyPos = localStorage.getItem('boda_title_pos') || 'bottom';
      this.texts.push({
        id: "text_" + Date.now(),
        text: localStorage.getItem('boda_title_text') || '',
        font: localStorage.getItem('boda_title_font') || 'Inter',
        size: parseInt(localStorage.getItem('boda_title_size') || '32', 10),
        color: localStorage.getItem('boda_title_color') || '#FFFFFF',
        align: localStorage.getItem('boda_title_align') || 'center',
        position: legacyPos, // legacy fallback
        posX: 50,
        posY: legacyPos === 'top' ? 10 : legacyPos === 'center' ? 50 : 90,
        bg: localStorage.getItem('boda_title_bg') || 'rgba(0,0,0,0.45)',
        weight: localStorage.getItem('boda_title_weight') || '700',
        style: localStorage.getItem('boda_title_style') || 'normal',
        transform: localStorage.getItem('boda_title_transform') || 'none',
      });
      this.saveState();
      
      // Cleanup legacy keys
      const keysToRemove = ['text','font','size','color','align','pos','bg','weight','style','transform'];
      keysToRemove.forEach(k => localStorage.removeItem('boda_title_' + k));
    }

    if (this.texts.length === 0) {
      this.addTextLayer();
    }
    
    // Normalize existing texts without posX/posY
    let needsSave = false;
    this.texts.forEach(t => {
      if (t.posX === undefined || t.posY === undefined) {
        t.posX = 50;
        t.posY = (t.position === 'top') ? 10 : (t.position === 'center') ? 50 : 90;
        needsSave = true;
      }
    });
    if (needsSave) this.saveState();
  },

  saveState() {
    try {
      localStorage.setItem('boda_branding_logos', JSON.stringify(this.logos));
    } catch (e) {
      console.warn('Logos too large for localStorage', e);
      if (window.Toast) Toast.show('Storage full. Delete some logos to add more.', 'error');
    }
    localStorage.setItem('boda_branding_selected_logo', this.selectedLogoIndex.toString());
    localStorage.setItem('boda_branding_pos', this.position);
    localStorage.setItem('boda_branding_size', this.size.toString());
    localStorage.setItem('boda_branding_opacity', this.opacity.toString());
    
    // Title Multi-Text State
    localStorage.setItem('boda_title_enabled', this.titleEnabled.toString());
    localStorage.setItem('boda_texts', JSON.stringify(this.texts));
    localStorage.setItem('boda_custom_fonts', JSON.stringify(this.customFonts));
  },

  addLogo(url) {
    this.logos.push(url);
    this.selectedLogoIndex = this.logos.length - 1;
    this.saveState();
  },

  selectLogo(idx) {
    this.selectedLogoIndex = idx;
    this.saveState();
  },

  removeLogo(idx) {
    this.logos.splice(idx, 1);
    if (this.selectedLogoIndex >= this.logos.length) {
      this.selectedLogoIndex = Math.max(0, this.logos.length - 1);
    }
    this.saveState();
  }
};

function renderBranding() {
  const oldAside = document.querySelector('.branding-sidebar');
  const scrollPos = oldAside ? oldAside.scrollTop : 0;

  const main = document.getElementById('main-content');
  const projects = Store.getAll();

  if (projects.length === 0) {
    main.innerHTML = `<div class="page-enter">
      <div class="page-header"><h2>Branding</h2><p>No projects available.</p></div>
    </div>`;
    return;
  }

  if (!BrandingState.projectId || !projects.find(p => p.id === BrandingState.projectId)) {
    BrandingState.projectId = projects[0].id;
  }

  IGBuilderState.load(BrandingState.projectId);

  let html = `<div class="page-enter" style="height:100%;">
    <div class="page-header" style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h2>Branding & Watermark</h2>
        <p>Apply logos or watermarks directly to your generated slides</p>
      </div>
      <div style="display:flex;gap:0.75rem;align-items:center;">
        <div style="display:flex; background:rgba(255,255,255,0.05); padding:0.25rem; border-radius:var(--radius-sm); margin-right:1rem;">
          <button class="btn btn-sm ${BrandingState.tab === 'library' ? 'btn-primary' : 'btn-ghost'}" onclick="BrandingState.setTab('library')">Logo Library</button>
          <button class="btn btn-sm ${BrandingState.tab === 'editor' ? 'btn-primary' : 'btn-ghost'}" onclick="BrandingState.setTab('editor')">Editor View</button>
        </div>
        <select class="btn btn-ghost" onchange="BrandingState.projectId=this.value;renderBranding()" style="padding:0.5rem 1rem;background:var(--bg-glass);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:var(--radius-xs);">
          ${projects.map(p => `<option value="${p.id}" ${p.id === BrandingState.projectId ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="batchExportBrandedSlides()" style="background:var(--success);">📥 Export All Branded</button>
      </div>
    </div>
    
    ${BrandingState.tab === 'library' ? `
      <!-- Library View -->
      <div style="padding:1rem 0; display:flex; flex-direction:column; gap:2rem; height:calc(100% - 80px); overflow-y:auto;">
        <div style="background:var(--bg-glass); border:1px solid var(--border-glass); padding:2rem; border-radius:var(--radius); text-align:center;">
          <h3 style="margin-bottom:0.5rem;">Upload New Logo or Overlay</h3>
          <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:1rem;">Use transparent PNG files for best results.</p>
          <input type="file" accept="image/png, image/jpeg" onchange="handleLogoUpload(event)" style="font-size:0.9rem; padding:1rem; border:1px dashed var(--primary); border-radius:var(--radius-sm); cursor:pointer; width:100%; max-width:400px; margin:0 auto; display:block;">
        </div>
        
        <div>
          <h3 style="margin-bottom:1rem;">Your Logo Collection</h3>
          ${BrandingState.logos.length > 0 ? `
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:1.5rem;">
              ${BrandingState.logos.map((logo, idx) => `
                <div style="position:relative; aspect-ratio:1; border:3px solid ${idx === BrandingState.selectedLogoIndex ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}; border-radius:var(--radius); background:rgba(0,0,0,0.3); cursor:pointer; padding:1rem; transition:all 0.2s;" onclick="selectBrandLogo(${idx})">
                  <img src="${logo}" style="width:100%; height:100%; object-fit:contain; opacity:${idx === BrandingState.selectedLogoIndex ? '1' : '0.7'};">
                  ${idx === BrandingState.selectedLogoIndex ? '<div style="position:absolute; bottom:8px; left:50%; transform:translateX(-50%); background:var(--primary); color:white; font-size:0.65rem; padding:0.2rem 0.6rem; border-radius:12px; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.3);">Active Logo</div>' : ''}
                  <button onclick="removeBrandLogo(event, ${idx})" style="position:absolute; top:-10px; right:-10px; background:var(--danger); color:white; border:none; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 3px 6px rgba(0,0,0,0.4); z-index:2; transition:transform 0.1s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">✕</button>
                </div>
              `).join('')}
            </div>
          ` : '<div style="padding:3rem; text-align:center; color:var(--text-muted); background:rgba(0,0,0,0.1); border-radius:var(--radius);">No logos uploaded yet. Upload your first logo above.</div>'}
        </div>
      </div>
    ` : `
      <!-- Editor View -->
      <div class="branding-layout">
        <aside class="branding-sidebar">
          <h4 style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;">Watermark Settings</h4>
          
          ${BrandingState.logoUrl ? `
            <div style="margin-bottom:1.5rem; display:flex; align-items:center; gap:0.75rem; background:rgba(0,0,0,0.2); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--border-glass);">
              <div style="width:40px; height:40px; background:white; border-radius:4px; padding:2px;">
                <img src="${BrandingState.logoUrl}" style="width:100%; height:100%; object-fit:contain;">
              </div>
              <div style="flex:1;">
                <div style="font-size:0.75rem; font-weight:bold;">Active Logo</div>
                <div style="font-size:0.65rem; color:var(--text-primary); opacity:0.7; cursor:pointer; text-decoration:underline;" onclick="BrandingState.setTab('library')">Change in Library →</div>
              </div>
            </div>

            <div class="form-group" style="margin-top:1rem;">
              <label>Position</label>
              <div class="pos-grid">
                <button class="pos-btn ${BrandingState.position === 'wm-tl' ? 'active' : ''}" onclick="updateBrandPos('wm-tl')">↖</button>
                <button class="pos-btn ${BrandingState.position === 'wm-tc' ? 'active' : ''}" onclick="updateBrandPos('wm-tc')">⬆</button>
                <button class="pos-btn ${BrandingState.position === 'wm-tr' ? 'active' : ''}" onclick="updateBrandPos('wm-tr')">↗</button>
                <button class="pos-btn ${BrandingState.position === 'wm-cl' ? 'active' : ''}" onclick="updateBrandPos('wm-cl')">⬅</button>
                <button class="pos-btn ${BrandingState.position === 'wm-cc' ? 'active' : ''}" onclick="updateBrandPos('wm-cc')">⏺</button>
                <button class="pos-btn ${BrandingState.position === 'wm-cr' ? 'active' : ''}" onclick="updateBrandPos('wm-cr')">➡</button>
                <button class="pos-btn ${BrandingState.position === 'wm-bl' ? 'active' : ''}" onclick="updateBrandPos('wm-bl')">↙</button>
                <button class="pos-btn ${BrandingState.position === 'wm-bc' ? 'active' : ''}" onclick="updateBrandPos('wm-bc')">⬇</button>
                <button class="pos-btn ${BrandingState.position === 'wm-br' ? 'active' : ''}" onclick="updateBrandPos('wm-br')">↘</button>
              </div>
            </div>
            
            <div class="form-group" style="margin-top:1rem;">
              <label id="brand-size-label">Size (${BrandingState.size}%)</label>
              <input type="range" min="10" max="100" value="${BrandingState.size}" oninput="updateBrandSize(this.value)">
            </div>
            
            <div class="form-group" style="margin-top:1rem;">
              <label id="brand-opacity-label">Opacity (${BrandingState.opacity}%)</label>
              <input type="range" min="0" max="100" value="${BrandingState.opacity}" oninput="updateBrandOpacity(this.value)">
            </div>
          ` : `<div style="padding:1rem;text-align:center;font-size:0.7rem;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:4px;margin-top:1rem; cursor:pointer;" onclick="BrandingState.setTab('library')">Go to Logo Library to upload a logo.</div>`}

          <!-- ── TITLE SLIDE PANEL (MULTI-TEXT) ── -->
          <div style="margin-top:1.75rem; border-top:1px solid var(--border-glass); padding-top:1.25rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
              <h4 style="font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:0.4rem;">
                🏷️ Teks & Judul (Slide 1)
              </h4>
              <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.75rem;color:var(--text-secondary);">
                <input type="checkbox" id="title-toggle" ${BrandingState.titleEnabled ? 'checked' : ''} onchange="updateTitleEnabled(this.checked)" style="accent-color:var(--primary);width:14px;height:14px;">
                Aktif
              </label>
            </div>
            
            <div id="title-panel" style="${BrandingState.titleEnabled ? '' : 'opacity:0.4;pointer-events:none;'} display:flex;flex-direction:column;gap:1.25rem;">
              
              <!-- Layer Navigation / Tabs -->
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex; gap:0.25rem; overflow-x:auto; padding-bottom:4px; scrollbar-width:none;">
                  ${BrandingState.texts.map((t, i) => `
                    <button class="btn btn-sm ${i === BrandingState.activeTextIndex ? 'btn-primary' : 'btn-ghost'}" onclick="BrandingState.setActiveTextIndex(${i});renderBranding();" style="flex:none; padding:0.35rem 0.6rem; font-size:0.7rem; border:1px solid ${i === BrandingState.activeTextIndex ? 'var(--primary)' : 'var(--border-glass)'};">
                      Layer ${i + 1}
                    </button>
                  `).join('')}
                  <button class="btn btn-sm btn-ghost" onclick="BrandingState.addTextLayer();renderBranding();" style="flex:none; padding:0.35rem 0.6rem; font-size:0.7rem; color:var(--success); border:1px dashed rgba(16,185,129,0.4);">
                    + Tambah
                  </button>
                </div>
              </div>

              ${(() => {
                const activeText = BrandingState.getActiveText();
                if(!activeText) return '';
                return `
              <div style="display:flex;flex-direction:column;gap:1.25rem;">
                  <!-- SECTION: KONTEN -->
                  <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); border-radius:var(--radius-sm); padding:1rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                      <h5 style="font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin:0;">✍️ Konten Layer ${BrandingState.activeTextIndex + 1}</h5>
                      <button class="btn-ghost" style="color:var(--danger); font-size:0.75rem; padding:0.25rem; opacity:0.8;" onclick="BrandingState.removeTextLayer(${BrandingState.activeTextIndex});renderBranding();" title="Hapus Layer Ini">🗑️</button>
                    </div>
                    
                    <div class="form-group" style="margin-bottom:0.75rem;">
                      <textarea id="title-text-input" rows="2" placeholder="Teks..." oninput="updateTextProp('text', this.value)" style="width:100%;padding:0.75rem;background:var(--bg-deep);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:var(--radius-sm);font-family:inherit;font-size:0.85rem;resize:vertical;outline:none;line-height:1.5;">${activeText.text}</textarea>
                    </div>
                    <div class="form-group" style="display:flex;gap:0.5rem;align-items:center;">
                      <select id="title-font-select" onchange="updateTextProp('font', this.value)" style="flex:1;padding:0.6rem 0.75rem;background:var(--bg-deep);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:var(--radius-sm);font-family:inherit;font-size:0.8rem;outline:none;cursor:pointer;">
                        ${['Inter','Playfair Display','Montserrat','Raleway','Oswald','Lora','Pacifico','Dancing Script','Bebas Neue','Cinzel','Great Vibes','Josefin Sans','Poppins','Libre Baskerville','Nunito','Cherry Bomb One','Brown Sugar'].concat(BrandingState.customFonts.map(f => f.name)).map(f =>
                          `<option value="${f}" ${activeText.font === f ? 'selected' : ''}>${f}</option>`
                        ).join('')}
                      </select>
                      <label class="btn btn-ghost btn-sm" style="padding:0.6rem; margin:0; cursor:pointer;" title="Upload Custom Font (.TTF, .OTF, .WOFF)">
                        <input type="file" accept=".ttf,.otf,.woff,.woff2" style="display:none;" onchange="handleFontUpload(event)">
                        📤
                      </label>
                    </div>
                  </div>

                  <!-- SECTION: STYLE -->
                  <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); border-radius:var(--radius-sm); padding:1rem;">
                    <h5 style="margin-bottom:0.75rem;font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;font-weight:700;">🎨 Format Visual</h5>
                    
                    <div style="display:grid;grid-template-columns:1fr;gap:0.75rem;">
                      <div style="display:flex;align-items:center;gap:0.5rem;justify-content:space-between;">
                        <label id="title-size-label" style="font-size:0.75rem;color:var(--text-secondary);margin:0;">Ukuran (${activeText.size}px)</label>
                        <input type="range" min="10" max="150" value="${activeText.size}" oninput="updateTextProp('size', parseInt(this.value, 10)); document.getElementById('title-size-label').textContent = 'Ukuran ('+this.value+'px)';" style="width:120px;">
                      </div>
                      
                      <div style="display:flex;align-items:center;gap:0.5rem;justify-content:space-between;">
                        <label style="font-size:0.75rem;color:var(--text-secondary);margin:0;">Warna Teks</label>
                        <input type="color" value="${activeText.color}" oninput="updateTextProp('color', this.value)" style="width:36px;height:24px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:transparent;cursor:pointer;padding:0;">
                      </div>
                    </div>

                    <div style="display:flex;gap:4px;margin-top:0.75rem;">
                      <button class="format-btn ${activeText.weight==='700'?'active':''}" onclick="updateTextProp('weight', '${activeText.weight==='700'?'400':'700'}', true)" title="Bold">B</button>
                      <button class="format-btn ${activeText.style==='italic'?'active':''}" onclick="updateTextProp('style', '${activeText.style==='italic'?'normal':'italic'}', true)" style="font-style:italic;" title="Italic">I</button>
                      <button class="format-btn ${activeText.transform==='uppercase'?'active':''}" onclick="updateTextProp('transform', '${activeText.transform==='uppercase'?'none':'uppercase'}', true)" title="Uppercase">AA</button>
                    </div>
                  </div>

                  <!-- SECTION: TATA LETAK -->
                  <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); border-radius:var(--radius-sm); padding:1rem;">
                    <h5 style="margin-bottom:0.75rem;font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;font-weight:700;">📍 Tata Letak</h5>
                    
                    <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:0.75rem;">
                      <div style="background:rgba(56, 189, 248, 0.1); border:1px dashed var(--primary); padding:0.75rem; border-radius:4px;">
                        <p style="margin:0; font-size:0.7rem; color:var(--text-secondary); text-align:center;">
                           👆 Geser/Drag teks di atas Kanvas secara langsung. Atau atur X/Y:
                        </p>
                        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                          <div style="flex:1;">
                            <label style="font-size:0.6rem;color:var(--text-secondary);">Pos X (%)</label>
                            <input type="number" min="0" max="100" value="${Math.round(activeText.posX !== undefined ? activeText.posX : 50)}" onchange="updateTextProp('posX', parseInt(this.value,10), true)" style="width:100%;padding:4px;background:var(--bg-deep);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:4px;font-size:0.75rem;">
                          </div>
                          <div style="flex:1;">
                            <label style="font-size:0.6rem;color:var(--text-secondary);">Pos Y (%)</label>
                            <input type="number" min="0" max="100" value="${Math.round(activeText.posY !== undefined ? activeText.posY : 50)}" onchange="updateTextProp('posY', parseInt(this.value,10), true)" style="width:100%;padding:4px;background:var(--bg-deep);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:4px;font-size:0.75rem;">
                          </div>
                        </div>
                      </div>
                      <div>
                        <label style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Horizontal (Rata)</label>
                        <div style="display:flex;gap:2px;">
                          <button class="format-btn ${activeText.align==='left'?'active':''}" onclick="updateTextProp('align', 'left', true)" style="font-size:0.9rem;">◀</button>
                          <button class="format-btn ${activeText.align==='center'?'active':''}" onclick="updateTextProp('align', 'center', true)" style="font-size:0.9rem;">◼</button>
                          <button class="format-btn ${activeText.align==='right'?'active':''}" onclick="updateTextProp('align', 'right', true)" style="font-size:0.9rem;">▶</button>
                        </div>
                      </div>
                    </div>

                    <div class="form-group">
                      <label style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Latar Belakang Efek</label>
                      <select onchange="updateTextProp('bg', this.value)" style="width:100%;padding:0.55rem;background:var(--bg-deep);border:1px solid var(--border-glass);color:var(--text-primary);border-radius:4px;font-size:0.75rem;outline:none;cursor:pointer;">
                        <option value="transparent" ${activeText.bg==='transparent'?'selected':''}>Kosong (Seamless)</option>
                        <option value="gradient" ${activeText.bg==='gradient'?'selected':''}>Gradient Fade</option>
                        <option value="rgba(0,0,0,0.45)" ${activeText.bg==='rgba(0,0,0,0.45)'?'selected':''}>Hitam Soft</option>
                        <option value="rgba(0,0,0,0.85)" ${activeText.bg==='rgba(0,0,0,0.85)'?'selected':''}>Hitam Gelap</option>
                      </select>
                    </div>
                  </div>
              </div>
                `;
              })()}
            </div>
          </div>
          <!-- end title panel -->
          
        </aside>
        
        <!-- Main Canvas Area -->
        <main class="ig-main" style="flex:1; overflow-y:auto; padding-right:1rem;">
          <div class="ig-slides-container" id="branding-slides-container">
            <!-- Slides rendered here -->
          </div>
        </main>
      </div>
    `}
  </div>`;

  main.innerHTML = html;

  const newAside = document.querySelector('.branding-sidebar');
  if (newAside) newAside.scrollTop = scrollPos;

  const photos = Store.getPhotos(BrandingState.projectId);
  if (photos.length > 0 && !PhotoCache[BrandingState.projectId]) {
    PhotoDB.loadProjectPhotos(BrandingState.projectId, photos.map(p => p.id)).then(cache => {
      PhotoCache[BrandingState.projectId] = cache;
      renderBrandingSlides();
    });
  } else {
    renderBrandingSlides();
  }
}

function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    BrandingState.addLogo(ev.target.result);
    renderBranding();
  };
  reader.readAsDataURL(file);
}

window.selectBrandLogo = function (idx) {
  BrandingState.selectLogo(idx);
  renderBrandingSlides();
  renderBranding();
};

window.removeBrandLogo = function (e, idx) {
  e.stopPropagation();
  BrandingState.removeLogo(idx);
  renderBrandingSlides();
  renderBranding();
};

function updateBrandPos(pos) {
  BrandingState.position = pos;
  BrandingState.saveState();
  renderBrandingSlides();
  renderBranding();
}

function updateBrandSize(val) {
  BrandingState.size = parseInt(val, 10);
  BrandingState.saveState();
  document.querySelectorAll('.watermark-overlay').forEach(el => {
    el.style.width = val + '%';
  });
  document.getElementById('brand-size-label').innerText = `Size (${val}%)`;
}

function updateBrandOpacity(val) {
  BrandingState.opacity = parseInt(val, 10);
  BrandingState.saveState();
  document.querySelectorAll('.watermark-overlay').forEach(el => {
    el.style.opacity = val / 100;
  });
  document.getElementById('brand-opacity-label').innerText = `Opacity (${val}%)`;
}

// ══════════════════════════════════════
// Title Slide Functions
// ══════════════════════════════════════
function _loadGoogleFont(fontName) {
  if (fontName === 'Brown Sugar') return;
  const id = 'gf-' + fontName.replace(/\s+/g, '-');
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }
}

function _updateTitleOverlayDOM() {
  if (IGBuilderState.slides.length === 0) return;
  const slideEl = document.getElementById('brand-slide-' + IGBuilderState.slides[0].id);
  if (!slideEl) return;

  let overlayContainer = slideEl.querySelector('.title-overlay-container');
  
  if (!BrandingState.titleEnabled || BrandingState.texts.length === 0) {
    if (overlayContainer) overlayContainer.remove();
    return;
  }

  if (!overlayContainer) {
    overlayContainer = document.createElement('div');
    overlayContainer.className = 'title-overlay-container';
    overlayContainer.style.cssText = 'position:absolute; inset:0; z-index:30; pointer-events:none; overflow:hidden;';
    slideEl.appendChild(overlayContainer);
  } else {
    overlayContainer.innerHTML = '';
  }

  BrandingState.texts.forEach(t => {
    if (!t.text.trim()) return;
    const safeFont = t.font.replace(/'/g, '');
    _loadGoogleFont(t.font);

    let posCss = '';
    let bgCss = t.bg;
    let padCss = '1.5rem 1.25rem';
    let wrapperCss = 'position:absolute; left:0; right:0;';

    if (t.position === 'top') {
      wrapperCss += ' top:0;';
      if (bgCss === 'gradient') {
        bgCss = 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)';
        padCss = '2rem 1.25rem 3rem 1.25rem';
      }
    } else if (t.position === 'bottom') {
      wrapperCss += ' bottom:0;';
      if (bgCss === 'gradient') {
        bgCss = 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)';
        padCss = '3rem 1.25rem 2rem 1.25rem';
      }
    } else {
      wrapperCss += ' top:50%; transform:translateY(-50%);';
      if (bgCss === 'gradient') bgCss = 'radial-gradient(ellipse at center, rgba(0,0,0,0.75) 0%, transparent 70%)';
    }

    const layerDiv = document.createElement('div');
    layerDiv.style.cssText = `
      ${wrapperCss}
      background:${bgCss};
      padding: ${padCss};
      text-align:${t.align};
      pointer-events:none;
    `;
    layerDiv.innerHTML = `<div style="
      font-family:'${safeFont}','Inter',sans-serif;
      font-size:${t.size}px;
      color:${t.color};
      font-weight:${t.weight};
      font-style:${t.style};
      text-transform:${t.transform};
      line-height:1.3;
      letter-spacing:-0.01em;
      word-break:break-word;
      text-shadow:0 2px 8px rgba(0,0,0,0.6);
    ">${t.text.replace(/\n/g, '<br>')}</div>`;
    
    overlayContainer.appendChild(layerDiv);
  });
}

function updateTextProp(prop, val, renderForm = false) {
  BrandingState.updateActiveText(prop, val);
  if (renderForm) {
    renderBranding();
  } else {
    _updateTitleOverlayDOM();
  }
}

function updateTitleEnabled(val) {
  BrandingState.titleEnabled = val;
  BrandingState.saveState();
  const panel = document.getElementById('title-panel');
  if (panel) {
    panel.style.opacity = val ? '1' : '0.4';
    panel.style.pointerEvents = val ? 'auto' : 'none';
  }
  _updateTitleOverlayDOM();
}


window.brandDragStart = function(e, index) {
  e.dataTransfer.setData('text/plain', index);
  e.dataTransfer.effectAllowed = 'move';
};
window.brandDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.border = '2px dashed var(--primary)';
  e.currentTarget.style.opacity = '0.5';
};
window.brandDragLeave = function(e) {
  e.currentTarget.style.border = 'none';
  e.currentTarget.style.opacity = '1';
};
window.brandDrop = function(e, toIndex) {
  e.preventDefault();
  e.currentTarget.style.border = 'none';
  e.currentTarget.style.opacity = '1';
  const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
  if (!isNaN(fromIndex) && fromIndex !== toIndex) {
    const item = IGBuilderState.slides.splice(fromIndex, 1)[0];
    IGBuilderState.slides.splice(toIndex, 0, item);
    IGBuilderState.save();
    renderBrandingSlides();
  }
};

function renderBrandingSlides() {
  const container = document.getElementById('branding-slides-container');
  if (!container) return;
  const projectCache = PhotoCache[BrandingState.projectId] || {};

  container.innerHTML = IGBuilderState.slides.map((slide, idx) => {
    const topUrl = projectCache[slide.topId];
    const botUrl = projectCache[slide.bottomId];
    const isFirstSlide = idx === 0;

    let watermarkHtml = '';
    if (BrandingState.logoUrl) {
      watermarkHtml = `
        <div class="watermark-overlay ${BrandingState.position}" style="width: ${BrandingState.size}%; opacity: ${BrandingState.opacity / 100}; pointer-events:none;">
          <img src="${BrandingState.logoUrl}" alt="Watermark">
        </div>
      `;
    }

    // Title overlay: only on slide 1 if enabled
    let titleHtml = '';
    if (isFirstSlide && BrandingState.titleEnabled && BrandingState.texts.length > 0) {
      let layerDivsHtml = BrandingState.texts.map((t, i) => {
        if (!t.text.trim()) return '';
        const safeFont = t.font.replace(/'/g, '');
        
        let bgCss = t.bg;
        let padCss = '1.5rem 1.25rem';
        
        if (bgCss === 'gradient') {
           bgCss = 'radial-gradient(ellipse at center, rgba(0,0,0,0.75) 0%, transparent 70%)';
        }
        
        const wrapperCss = `position:absolute; left:${t.posX ?? 50}%; top:${t.posY ?? 50}%; transform:translate(-50%, -50%); width:100%;`;

        return `
          <div id="dragtext_${i}" style="
            ${wrapperCss}
            background:${bgCss};
            padding: ${padCss};
            text-align:${t.align};
            pointer-events:auto;
            cursor:grab;
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
            z-index:${50 + i};
          " onpointerdown="startTextDrag(event, ${i})">
            <div style="
              font-family:'${safeFont}', 'Inter', sans-serif;
              font-size:${t.size}px;
              color:${t.color};
              font-weight:${t.weight};
              font-style:${t.style};
              text-transform:${t.transform};
              line-height:1.3;
              letter-spacing:-0.01em;
              word-break:break-word;
              text-shadow: 0 2px 8px rgba(0,0,0,0.6);
            ">${t.text.replace(/\n/g, '<br>')}</div>
          </div>
        `;
      }).join('');
      
      if (layerDivsHtml) {
        titleHtml = `
          <div class="title-overlay-container" style="position:absolute; inset:0; z-index:30; pointer-events:none; overflow:hidden;">
            ${layerDivsHtml}
          </div>
        `;
      }
    }

    const slideAspectRatio = IGBuilderState.format === '9:16' ? '1080 / 1920' : '1080 / 1350';

    return `
      <div class="slide-wrap" draggable="true" ondragstart="brandDragStart(event, ${idx})" ondragover="brandDragOver(event)" ondragleave="brandDragLeave(event)" ondrop="brandDrop(event, ${idx})" style="transition:all 0.2s;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.5rem; display:flex; align-items:center; gap:0.5rem;">
          <span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; transform:scale(0.9); cursor:grab;">≡</span>
          ${isFirstSlide ? '<span style="background:linear-gradient(90deg,#2563EB,#38BDF8);color:white;font-size:0.65rem;padding:2px 7px;border-radius:999px;font-weight:700;">🏷️ TITLE</span>' : ''}
          Slide ${idx + 1}
        </div>
        <div class="slide-card layout-${slide.layout}" id="brand-slide-${slide.id}" style="position:relative; aspect-ratio: ${slideAspectRatio};">
          ${watermarkHtml}
          ${titleHtml}
          <div class="slide-slot ${topUrl ? 'has-photo' : ''}" style="cursor:default;">
            ${topUrl ? `
              <img src="${topUrl}" id="img-br-${slide.id}-top" onload="igImageLoadedBrand('${slide.id}', 'top')">
            ` : ''}
          </div>
          <div class="slide-slot ${botUrl ? 'has-photo' : ''}" style="cursor:default;">
            ${botUrl ? `
              <img src="${botUrl}" id="img-br-${slide.id}-bottom" onload="igImageLoadedBrand('${slide.id}', 'bottom')">
            ` : ''}
          </div>
        </div>
        <div class="slide-actions">
          <button class="btn btn-primary btn-sm" onclick="exportBrandedSlide('${slide.id}', ${idx + 1})">📥 Export Slide</button>
        </div>
      </div>
    `;
  }).join('');
}

function igImageLoadedBrand(slideId, slotPrefix) {
  const img = document.getElementById(`img-br-${slideId}-${slotPrefix}`);
  if (!img) return;
  const slotEl = img.parentElement;
  if (!slotEl) return;

  const rect = slotEl.getBoundingClientRect();
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;

  const slotRatio = rect.width / rect.height;
  const imgRatio = natW / natH;

  let baseW_pct = 100, baseH_pct = 100;
  if (imgRatio > slotRatio) {
    baseW_pct = 100 * (imgRatio / slotRatio);
  } else {
    baseH_pct = 100 * (slotRatio / imgRatio);
  }

  img.style.width = baseW_pct + '%';
  img.style.height = baseH_pct + '%';
  img.style.maxWidth = 'none';
  img.style.objectFit = 'fill';

  const slide = IGBuilderState.slides.find(s => s.id === slideId);
  if (!slide) return;
  const t = slide[slotPrefix + 'Transform'];

  img.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
}

async function exportBrandedSlide(slideId, index, customName = null) {
  const el = document.getElementById('brand-slide-' + slideId);
  if (!el) return;

  Toast.show(`Exporting Branded Slide ${index}...`, 'info', 2000);

  try {
    const canvas = await html2canvas(el, {
      scale: 2160 / el.offsetWidth,
      useCORS: true,
      backgroundColor: '#0A0F1C'
    });

    const link = document.createElement('a');
    const rootName = customName || 'BodaStudio_Branded';
    link.download = `${rootName}_${index}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    Toast.show(`Branded Slide ${index} Exported!`, 'success');
  } catch (err) {
    console.error(err);
    Toast.show('Export failed', 'error');
  }
}

async function batchExportBrandedSlides() {
  if (IGBuilderState.slides.length === 0) return;
  const project = Store.get(BrandingState.projectId);
  const folderName = project ? project.name.replace(/[^a-zA-Z0-9_-\s]/g, '').trim() : 'BodaStudio';
  
  if (IGBuilderState.slides.length === 1) {
    // Single slide bypasses ZIP
    await exportBrandedSlide(IGBuilderState.slides[0].id, 1, folderName);
    return;
  }

  if (typeof JSZip === 'undefined') {
    Toast.show('ZIP module not loaded yet! Ensure internet active.', 'error');
    return;
  }

  Toast.show(`Zipping ${IGBuilderState.slides.length} branded slides... \nPlease wait.`, 'info', 5000);
  
  try {
    const zip = new JSZip();
    for (let i = 0; i < IGBuilderState.slides.length; i++) {
      const slideId = IGBuilderState.slides[i].id;
      const el = document.getElementById('brand-slide-' + slideId);
      if (el) {
        const canvas = await html2canvas(el, {
          scale: 2160 / el.offsetWidth,
          useCORS: true,
          backgroundColor: '#0A0F1C'
        });
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const base64Data = dataUrl.split(',')[1];
        // Name properly inside ZIP: folderName_index.jpg
        zip.file(`${folderName}_${i + 1}.jpg`, base64Data, {base64: true});
      }
    }
    
    Toast.show('Compiling ZIP format...', 'info', 3000);
    const content = await zip.generateAsync({type: 'blob'});
    const link = document.createElement('a');
    link.download = `${folderName}_Export.zip`; // E.g., OSIS_Event_Export.zip
    link.href = URL.createObjectURL(content);
    link.click();
    
    Toast.show('Batch ZIP Export Complete!', 'success');
  } catch(e) {
    console.error(e);
    Toast.show('ZIP Batch Export failed!', 'error');
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

// ══════════════════════════════════════
// PHASE 5 — Cloud Settings & Uploader
// ══════════════════════════════════════

const SettingsState = {
  gasUrl: '',
  folderId: '',
  isLoaded: false,

  async load() {
    if (!fbDb) {
      this.gasUrl = localStorage.getItem('boda_gas_url') || '';
      this.folderId = localStorage.getItem('boda_folder_id') || '';
      this.isLoaded = true;
      return;
    }
    try {
      const doc = await fbDb.collection('settings').doc('cloud_sync').get();
      if (doc.exists) {
        const data = doc.data();
        this.gasUrl = data.gasUrl || '';
        this.folderId = data.folderId || '';
        localStorage.setItem('boda_gas_url', this.gasUrl);
        localStorage.setItem('boda_folder_id', this.folderId);
      } else {
        this.gasUrl = localStorage.getItem('boda_gas_url') || '';
        this.folderId = localStorage.getItem('boda_folder_id') || '';
      }
    } catch(e) {
      this.gasUrl = localStorage.getItem('boda_gas_url') || '';
      this.folderId = localStorage.getItem('boda_folder_id') || '';
      console.error("Firebase settings load error:", e);
    }
    this.isLoaded = true;
  },

  async save(url, folder) {
    this.gasUrl = url.trim();
    
    // Auto-sanitize Folder ID (remove ? queries and URL prefixes)
    let cleanFolder = folder.trim();
    if (cleanFolder.includes('?')) cleanFolder = cleanFolder.split('?')[0];
    if (cleanFolder.includes('/folders/')) cleanFolder = cleanFolder.split('/folders/')[1];
    if (cleanFolder.includes('/')) cleanFolder = cleanFolder.split('/').pop();
    
    this.folderId = cleanFolder.trim();
    localStorage.setItem('boda_gas_url', this.gasUrl);
    localStorage.setItem('boda_folder_id', this.folderId);

    if (fbDb) {
      try {
        await fbDb.collection('settings').doc('cloud_sync').set({
          gasUrl: this.gasUrl,
          folderId: this.folderId
        }, { merge: true });
      } catch(e) {
        console.error("Failed saving settings to Firebase:", e);
      }
    }
  }
};

async function renderSettings() {
  const main = document.getElementById('main-content');
  if (!SettingsState.isLoaded) {
    main.innerHTML = `<div style="padding:4rem 2rem;text-align:center;color:var(--text-muted);">☁️ Loading configs from Firebase...</div>`;
    await SettingsState.load();
  }

  main.innerHTML = `
    <div class="page-enter" style="height:100%;max-width:800px;margin:0 auto;padding-top:1rem;display:flex;flex-direction:column;gap:1.5rem;">
      <div class="page-header" style="margin-bottom:0;">
        <h2>Cloud Sync ☁️</h2>
        <p>Configure automatic Google Drive background syncing & view queue</p>
      </div>
      
      <div style="background:var(--bg-glass);border:1px solid var(--border-glass);padding:2rem;border-radius:var(--radius);display:flex;flex-direction:column;gap:1.5rem;">
        <h3 style="font-size:1.1rem;font-weight:700;">Configuration</h3>
        <div class="form-group" style="display:flex;flex-direction:column;gap:0.5rem;">
          <label style="font-weight:600;font-size:0.9rem;">Google Apps Script Web App URL</label>
          <input type="text" id="setting-gas" value="${SettingsState.gasUrl}" placeholder="https://script.google.com/macros/s/.../exec" style="padding:0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border-glass);background:rgba(0,0,0,0.3);color:white;">
          <small style="color:var(--text-muted);font-size:0.75rem;">Deploy google_apps_script.js to Google Drive as a Web App to get this URL.</small>
        </div>
        
        <div class="form-group" style="display:flex;flex-direction:column;gap:0.5rem;">
          <label style="font-weight:600;font-size:0.9rem;">Google Drive Target Folder ID</label>
          <input type="text" id="setting-folder" value="${SettingsState.folderId}" placeholder="e.g. 1A2b3c4D5e..." style="padding:0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border-glass);background:rgba(0,0,0,0.3);color:white;">
          <small style="color:var(--text-muted);font-size:0.75rem;">The long combination of letters/numbers in your Google Drive Folder URL.</small>
        </div>
        
        <div style="margin-top:0.5rem;">
          <button class="btn btn-primary" onclick="saveCloudSettings()">💾 Save Configurations</button>
        </div>
      </div>

      <!-- Sync Manager Panel -->
      <div style="background:var(--bg-glass);border:1px solid var(--border-glass);padding:1.5rem 2rem;border-radius:var(--radius);display:flex;flex-direction:column;gap:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
          <h3 style="font-size:1.1rem;font-weight:700;">Sync Manager Queue</h3>
          <div id="sync-manager-controls" style="display:flex;gap:0.5rem;"></div>
        </div>
        
        <div id="sync-manager-list" style="display:flex;flex-direction:column;gap:0.5rem;max-height:400px;overflow-y:auto;padding-right:0.5rem;">
           <!-- queue items rendered here -->
        </div>
      </div>
    </div>
  `;
  setTimeout(() => renderSyncManagerList(), 50);
}

function renderSyncManagerList() {
  const controlsGrid = document.getElementById('sync-manager-controls');
  const listGrid = document.getElementById('sync-manager-list');
  if (!controlsGrid || !listGrid) return; // not on settings page

  // Controls UI
  controlsGrid.innerHTML = `
    ${CloudUploader.isPaused
      ? `<button class="btn btn-primary btn-sm" onclick="CloudUploader.resume()">▶ Resume</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="CloudUploader.pause()">⏸ Pause</button>`
    }
    <button class="btn btn-ghost btn-sm" onclick="CloudUploader.clearCompleted()">Clear Finished</button>
  `;

  // List UI
  if (CloudUploader.queue.length === 0) {
    listGrid.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.9rem;">No active syncing tasks in queue.</div>`;
    return;
  }

  let html = '';
  // Traverse backwards or normally. Let's do newest at bottom, so normal loop.
  CloudUploader.queue.forEach((item, index) => {
    let statusColor, statusBadge, statusIcon;
    if (item.status === 'success') {
      statusColor = 'var(--success)';
      statusBadge = 'Success';
      statusIcon = '✅';
    } else if (item.status === 'failed') {
      statusColor = 'var(--danger)';
      statusBadge = 'Failed';
      statusIcon = '❌';
    } else if (item.status === 'uploading') {
      statusColor = 'var(--primary-light)';
      statusBadge = 'Uploading';
      statusIcon = '<div class="spinner" style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin-cloud 1s linear infinite;display:inline-block;"></div>';
    } else {
      statusColor = 'var(--warning)';
      statusBadge = CloudUploader.isPaused ? 'Paused' : 'Pending';
      statusIcon = '⏳';
    }

    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:rgba(0,0,0,0.2);border-radius:var(--radius-sm);border-left:3px solid ${statusColor};">
        <div style="display:flex;flex-direction:column;gap:0.2rem;overflow:hidden;">
          <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.projectName} - ${item.name}</div>
          ${item.error ? `<div style="color:var(--danger);font-size:0.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Error: ${item.error}</div>` : ''}
        </div>
        
        <div style="display:flex;align-items:center;gap:1rem;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.75rem;color:${statusColor};">
            ${statusIcon} ${statusBadge}
          </div>
          ${item.status === 'failed' ? `<button class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem;font-size:0.7rem;" onclick="CloudUploader.retry('${item.id}')">Retry</button>` : ''}
        </div>
      </div>
    `;
  });
  listGrid.innerHTML = html;
}

function saveCloudSettings() {
  const url = document.getElementById('setting-gas').value;
  const folder = document.getElementById('setting-folder').value;
  SettingsState.save(url, folder);
  Toast.show('Cloud Settings Saved!', 'success');
}

const CloudUploader = {
  queue: [], // { id, dataUrl, name, projectId, projectName, status, error }
  isPaused: false,
  _wasUploading: false,

  add(projectId, projectName, files) {
    if (!SettingsState.gasUrl || !SettingsState.folderId) return;
    const enriched = files.map(f => ({ ...f, projectId, projectName, status: 'pending', error: null }));
    this.queue.push(...enriched);
    this.updateUI();
    if (!this.isPaused) this.processNext();
  },

  pause() {
    this.isPaused = true;
    this.updateUI();
  },

  resume() {
    this.isPaused = false;
    this.updateUI();
    this.processNext();
  },

  retry(id) {
    const item = this.queue.find(q => q.id === id);
    if (item) {
      item.status = 'pending';
      item.error = null;
      this.updateUI();
      if (!this.isPaused) this.processNext();
    }
  },

  clearCompleted() {
    this.queue = this.queue.filter(q => q.status !== 'success');
    this.updateUI();
  },

  async processNext() {
    if (this.isPaused) return;

    const pendingItem = this.queue.find(q => q.status === 'pending');

    if (!pendingItem) {
      if (this._wasUploading) {
        const hasFailed = this.queue.some(q => q.status === 'failed');
        if (!hasFailed) {
          Toast.show('Semua foto berhasil di-upload ke Google Drive!', 'success');
        } else {
          Toast.show('Sync selesai, tapi ada foto yang gagal.', 'warning');
        }
        this._wasUploading = false;
        if (window.location.hash.startsWith('#linkboda')) renderLinkBoda();
      }
      this.updateUI();
      return;
    }

    this._wasUploading = true;
    pendingItem.status = 'uploading';
    this.updateUI();

    try {
      const parts = pendingItem.dataUrl.split(',');
      const meta = parts[0].match(/:(.*?);/);
      const mimeType = meta ? meta[1] : 'image/jpeg';
      const base64 = parts[1];

      const payload = {
        folderId: SettingsState.folderId,
        projectName: pendingItem.projectName,
        filename: pendingItem.name,
        mimeType: mimeType,
        base64: base64
      };

      const res = await fetch(SettingsState.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (result.status === 'success') {
        pendingItem.status = 'success';
        if (result.folderUrl) {
          const proj = Store.get(pendingItem.projectId);
          if (proj && proj.driveUrl !== result.folderUrl) {
            Store.update(pendingItem.projectId, { driveUrl: result.folderUrl });

            // Phase 6: Sync to Link Boda Firebase
            if (fbDb) {
              try {
                const snapshot = await fbDb.collection('links').where('name', '==', pendingItem.projectName).get();
                if (snapshot.empty) {
                  const allLinks = await fbDb.collection('links').get();
                  let maxOrder = -1;
                  allLinks.forEach(doc => {
                    if (doc.data().order > maxOrder) maxOrder = doc.data().order;
                  });
                  await fbDb.collection('links').add({
                    name: pendingItem.projectName,
                    url: result.folderUrl,
                    icon: 'fa-regular fa-folder-open',
                    category: 'Clients',
                    order: maxOrder + 1
                  });
                  console.log("Successfully synced to Link Boda Firebase");
                }
              } catch (fbe) {
                console.error("Failed to sync to Link Boda Firebase", fbe);
              }
            }
          }
        }
      } else {
        pendingItem.status = 'failed';
        pendingItem.error = result.message || 'Unknown error';
        console.error('GAS Error:', result.message);
      }
    } catch (err) {
      pendingItem.status = 'failed';
      pendingItem.error = err.message || 'Network error';
      console.error('Cloud Sync failed for', pendingItem.name, err);
    }

    // Process next immediately
    this.processNext();
  },

  updateUI() {
    let indicator = document.getElementById('cloud-sync-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'cloud-sync-indicator';
      indicator.style.position = 'fixed';
      indicator.style.bottom = '1.5rem';
      indicator.style.right = '1.5rem';
      indicator.style.background = 'var(--primary)';
      indicator.style.color = '#fff';
      indicator.style.padding = '0.75rem 1.25rem';
      indicator.style.borderRadius = 'var(--radius)';
      indicator.style.fontSize = '0.85rem';
      indicator.style.fontWeight = '600';
      indicator.style.zIndex = '9999';
      indicator.style.boxShadow = '0 8px 16px rgba(0,0,0,0.4)';
      indicator.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      indicator.style.display = 'flex';
      indicator.style.alignItems = 'center';
      indicator.style.gap = '0.5rem';
      document.body.appendChild(indicator);

      if (!document.getElementById('cloud-keyframes')) {
        const style = document.createElement('style');
        style.id = 'cloud-keyframes';
        style.textContent = `@keyframes spin-cloud { to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
      }
    }

    const pendingCount = this.queue.filter(q => q.status === 'pending' || q.status === 'uploading').length;

    if (pendingCount > 0 && !this.isPaused) {
      indicator.innerHTML = `<div class="spinner" style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin-cloud 1s linear infinite;"></div> ☁️ Syncing: ${pendingCount} left...`;
      indicator.style.background = 'var(--primary)';
      indicator.style.opacity = '1';
      indicator.style.transform = 'translateY(0)';
      indicator.style.pointerEvents = 'auto';
    } else if (this.isPaused && pendingCount > 0) {
      indicator.innerHTML = `⏸ Sync Paused (${pendingCount} left)`;
      indicator.style.background = 'var(--warning)';
      indicator.style.opacity = '1';
      indicator.style.transform = 'translateY(0)';
      indicator.style.pointerEvents = 'auto';
    } else {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(20px)';
      indicator.style.pointerEvents = 'none';
      setTimeout(() => { if (this.queue.filter(q => q.status === 'pending' || q.status === 'uploading').length === 0 && indicator.parentNode) indicator.remove(); }, 500);
    }

    // Refresh Sync Manager UI if open
    if (window.location.hash === '#settings' && typeof renderSyncManagerList === 'function') {
      renderSyncManagerList();
    }
  }
};

// ══════════════════════════════════════
// PHASE 6 — Link-Boda View
// ══════════════════════════════════════
function renderLinkBoda() {
  const main = document.getElementById('main-content');
  main.innerHTML = `<iframe src="link 6.html" style="width:100%;height:100%;border:none;border-radius:var(--radius-lg);background:linear-gradient(-45deg, #a2d2ff, #fefae0, #ffffff, #bde0fe);"></iframe>`;
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

function renderLiveView(sessionId) {
  const main = document.getElementById('main-content');
  if(!main) return;
  
  // Hide sidebar and header explicitly for this view
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.style.display = 'none';
  
  main.innerHTML = `<div style="height:100vh;width:100%;background:#0a0a0a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;position:fixed;top:0;left:0;z-index:9999;">
    <h3 style="color:#aaa;margin-bottom:1rem;font-family:Inter,sans-serif;">Menunggu sinyal PC...</h3>
    <div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.1);border-top:4px solid var(--primary);border-radius:50%;animation:spin 1s linear infinite;"></div>
  </div>`;

  if (!fbRealtime) {
    main.innerHTML = '<div style="padding:2rem;color:red;font-family:Inter,sans-serif;">Firebase Realtime tidak aktif.</div>';
    return;
  }

  fbRealtime.ref('ig_live_preview/' + sessionId).on('value', snap => {
    const data = snap.val();
    if (!data || !data.slides) {
      main.innerHTML = `<div style="height:100vh;width:100%;background:#0a0a0a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;position:fixed;top:0;left:0;z-index:9999;font-family:Inter,sans-serif;">
        <h3 style="color:#666;margin-bottom:1rem;">Koneksi PC terputus / dihentikan.</h3>
      </div>`;
      return;
    }
    
    const isHD = data.status === 'hd' && data.slidesHD;
    const slidesToRender = isHD ? data.slidesHD : data.slides;
    
    let html = `<div style="min-height:100vh;width:100vw;background:#050505;position:fixed;top:0;left:0;z-index:9999;overflow-y:auto;padding-bottom:5rem;font-family:Inter,sans-serif;">
      <div style="position:sticky;top:0;background:rgba(5,5,5,0.85);backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center;z-index:10000;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-weight:700;color:${isHD ? '#00e676' : '#ff3b3b'};display:flex;align-items:center;gap:0.5rem;letter-spacing:1px;font-size:0.9rem;">
           <span style="font-size:0.8rem;animation:pulse 1s infinite;">●</span> ${isHD ? 'HD READY' : 'LIVE PREVIEW'}
        </div>
        ${isHD ? `<div style="font-size:0.75rem;color:#aaa;background:rgba(255,255,255,0.1);padding:0.2rem 0.6rem;border-radius:12px;">Long-Press to Save</div>` : `<div style="font-size:0.75rem;color:#666;font-style:italic;">Low-res mode</div>`}
      </div>
      <div style="display:flex;flex-direction:column;gap:1.5rem;padding:1.5rem 1rem;max-width:600px;margin:0 auto;">
         ${slidesToRender.map(img => `
           <img src="${img}" style="width:100%;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.8);display:block;">
         `).join('')}
      </div>
    </div>`;
    main.innerHTML = html;
  });
}

// ══════════════════════════════════════
// FONT & DRAG HANDLERS
// ══════════════════════════════════════
window.handleFontUpload = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let fontName = file.name.split('.')[0];
    fontName = fontName.replace(/[^a-zA-Z0-9]/g, ' '); // sanitize
    const dataUrl = ev.target.result;
    
    // Check if custom font exists
    if (!BrandingState.customFonts.find(f => f.name === fontName)) {
      BrandingState.customFonts.push({ name: fontName, data: dataUrl });
      BrandingState.saveState();
      _injectCustomFonts();
      if(window.Toast) Toast.show(`Font '${fontName}' berhasil diinstal!`, 'success');
      
      // Auto apply to current text
      if (BrandingState.texts[BrandingState.activeTextIndex]) {
        BrandingState.updateActiveText('font', fontName);
      }
      renderBranding();
    }
  };
  reader.readAsDataURL(file);
};

window._injectCustomFonts = function() {
  let styleEl = document.getElementById('boda-custom-fonts');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'boda-custom-fonts';
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = BrandingState.customFonts.map(f => 
    `@font-face { font-family: "${f.name}"; src: url("${f.data}"); }`
  ).join('\n');
};

let _dragActiveTextIdx = -1;
let _dragStartX = 0;
let _dragStartY = 0;
let _dragInitPosX = 0;
let _dragInitPosY = 0;

window.startTextDrag = function(e, idx) {
  e.preventDefault();
  e.stopPropagation(); // prevent slide drag
  _dragActiveTextIdx = idx;
  
  BrandingState.setActiveTextIndex(idx);
  
  // Highlight active tab visually without full DOM destruction
  document.querySelectorAll('#title-panel .btn').forEach((btn, i) => {
     if(i === idx) {
       btn.classList.add('btn-primary');
       btn.classList.remove('btn-ghost');
       btn.style.border = '1px solid var(--primary)';
     } else if (!btn.textContent.includes('Tambah')) {
       btn.classList.remove('btn-primary');
       btn.classList.add('btn-ghost');
       btn.style.border = '1px solid var(--border-glass)';
     }
  });

  _dragStartX = e.clientX;
  _dragStartY = e.clientY;
  
  const textLayer = BrandingState.texts[idx];
  _dragInitPosX = textLayer.posX || 50;
  _dragInitPosY = textLayer.posY || 50;

  document.addEventListener('pointermove', onTextDrag);
  document.addEventListener('pointerup', stopTextDrag);
  document.addEventListener('pointercancel', stopTextDrag);
};

window.onTextDrag = function(e) {
  if (_dragActiveTextIdx === -1) return;
  e.preventDefault(); // prevents pull-to-refresh
  
  const dx = e.clientX - _dragStartX;
  const dy = e.clientY - _dragStartY;
  
  const container = document.querySelector('.title-overlay-container');
  if (!container) return;
  const rect = container.getBoundingClientRect();
  
  let pctX = _dragInitPosX + (dx / rect.width) * 100;
  let pctY = _dragInitPosY + (dy / rect.height) * 100;
  
  // Clamp boundaries
  pctX = Math.max(0, Math.min(100, pctX));
  pctY = Math.max(0, Math.min(100, pctY));
  
  BrandingState.texts[_dragActiveTextIdx].posX = pctX;
  BrandingState.texts[_dragActiveTextIdx].posY = pctY;
  
  const el = document.getElementById('dragtext_' + _dragActiveTextIdx);
  if(el) {
    el.style.left = pctX + '%';
    el.style.top = pctY + '%';
  }
};

window.stopTextDrag = function(e) {
  if (_dragActiveTextIdx !== -1) {
     BrandingState.saveState();
     document.removeEventListener('pointermove', onTextDrag);
     document.removeEventListener('pointerup', stopTextDrag);
     document.removeEventListener('pointercancel', stopTextDrag);
     _dragActiveTextIdx = -1;
     renderBranding(); // Update form sliders and UI
  }
};

// ── Initialize ──
function initApp() {
  if (window._bodaInitialized) return;
  window._bodaInitialized = true;

  try {
    Toast.init();
    
    // Perform migrations safely
    BrandingState.initMigrate();
    
    SettingsState.load(); // Load global config from Firebase

    // Preload title font if set
    if (BrandingState.titleFont && BrandingState.titleFont !== 'Inter') {
      _loadGoogleFont(BrandingState.titleFont);
    }

    // Register routes
    Router.register('#dashboard', () => { renderDashboard(); });
    Router.register('#project/:id', (id) => { renderProject(id); });
    Router.register('#ig-builder', () => { renderIGBuilder(); });
    Router.register('#branding', () => { renderBranding(); });
    Router.register('#settings', () => { renderSettings(); });
    Router.register('#linkboda', () => { renderLinkBoda(); });
    Router.register('#live/:id', (id) => { renderLiveView(id); });

    Router.init();

    // Close modal on overlay click
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
      });
    }

    // Close lightbox
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
      lightbox.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeLightbox();
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeModal(); closeLightbox(); }
    });
    
    console.log("Boda Studio AI initialized successfully.");
  } catch (err) {
    console.error("Critical Init Error:", err);
    window.onerror(err.message, 'app.js', 0, 0, err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

