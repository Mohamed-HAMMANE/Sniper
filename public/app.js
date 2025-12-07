// ==================== STATE ====================
let eventSource = null;
let activeTargets = [];
let availableCollections = [];
let soundEnabled = true;

// ==================== DOM ELEMENTS ====================
const clientStatus = document.getElementById('client-status');
const cacheCount = document.getElementById('cache-count');
const listingsFeed = document.getElementById('listings-feed');
const clearFeedBtn = document.getElementById('clear-feed-btn');
const activeTargetsList = document.getElementById('active-targets-list');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const addCollectionToggle = document.getElementById('add-collection-toggle');
const collectionListContainer = document.getElementById('collection-list-container');
const watchCount = document.getElementById('watch-count');
const soundToggle = document.getElementById('sound-toggle');

// ==================== AUDIO ====================
const alertSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz0IAyBx1tu+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lREzSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE=');

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  connectSSE();
  setupEventListeners();
  loadStats();
});

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  clearFeedBtn?.addEventListener('click', clearFeed);

  sidebarToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  soundToggle?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggle.classList.toggle('muted', !soundEnabled);
    showToast(soundEnabled ? 'Sound enabled' : 'Sound muted', 'success');
  });

  addCollectionToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrapper = addCollectionToggle.closest('.add-collection-wrapper');
    wrapper.classList.toggle('open');
    collectionListContainer.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    const wrapper = document.querySelector('.add-collection-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      wrapper.classList.remove('open');
      collectionListContainer.classList.add('hidden');
    }
  });
}

// ==================== SSE ====================
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/listings-stream');

  eventSource.onopen = () => {
    clientStatus.className = 'connection-status connected';
    clientStatus.innerHTML = '<span class="status-dot"></span><span class="status-label">Connected</span>';
  };

  eventSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'listing') handleNewListing(msg.data);
    else if (msg.type === 'listing-update') handleListingUpdate(msg.data);
    else if (msg.type === 'floorPriceUpdate') handleFloorPriceUpdate(msg.data);
  };

  eventSource.onerror = () => {
    clientStatus.className = 'connection-status disconnected';
    clientStatus.innerHTML = '<span class="status-dot"></span><span class="status-label">Disconnected</span>';
  };
}

// ==================== DATA LOADING ====================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    activeTargets = config.targets || [];
    availableCollections = config.collections || [];
    renderCollectionWidget();
    renderActiveTargets();
    updateWatchCount();
  } catch (e) {
    console.error('Error loading config:', e);
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    if (cacheCount) cacheCount.textContent = stats.cacheSize || 0;
  } catch (e) { }
  setTimeout(loadStats, 5000);
}

function updateWatchCount() {
  if (watchCount) watchCount.textContent = activeTargets.length;
}

function handleFloorPriceUpdate({ symbol, floorPrice }) {
  const col = availableCollections.find(c => c.symbol === symbol);
  if (col) col.floorPrice = floorPrice;

  const fpEl = document.querySelector(`.target-tag[data-symbol="${symbol}"] .target-floor`);
  if (fpEl) fpEl.textContent = `FP: ${Number(floorPrice).toFixed(3)} SOL`;
}

// ==================== COLLECTION WIDGET ====================
function renderCollectionWidget() {
  collectionListContainer.innerHTML = '';
  availableCollections.sort((a, b) => a.name.localeCompare(b.name));

  availableCollections.forEach(col => {
    const item = document.createElement('div');
    item.className = 'collection-item';
    item.onclick = () => addTarget(col.symbol);
    item.innerHTML = `
      <img src="${col.image}" alt="${col.name}" onerror="this.style.display='none'">
      <div class="collection-info">
        <span class="collection-name">${col.name}</span>
        <span class="collection-fp">FP: ${col.floorPrice ? col.floorPrice.toFixed(2) : '-.--'} SOL</span>
      </div>
    `;
    collectionListContainer.appendChild(item);
  });
}

// ==================== ACTIVE TARGETS ====================
function renderActiveTargets() {
  activeTargetsList.innerHTML = '';

  if (activeTargets.length === 0) {
    activeTargetsList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">No active watches</div>';
    return;
  }

  activeTargets.forEach(target => {
    const col = availableCollections.find(c => c.symbol === target.symbol);
    const name = col ? col.name : target.symbol;
    const image = col?.image || '';
    const fp = col?.floorPrice;

    const tag = document.createElement('div');
    tag.className = 'target-tag';
    tag.dataset.symbol = target.symbol;

    tag.innerHTML = `
      ${image ? `<img src="${image}" class="target-image" alt="${name}">` : `<div class="target-image-placeholder">🎯</div>`}
      <div class="target-info">
        <div class="target-header">
          <span class="target-name">${name}</span>
          <button class="btn-remove-target" onclick="removeTarget('${target.symbol}')" title="Remove">×</button>
        </div>
        <div class="target-details">
          <span class="target-floor">FP: ${fp ? fp.toFixed(3) : '-.---'} SOL</span>
          <div class="edit-input-group">
            <span class="edit-label">&lt;</span>
            <input type="number" class="inline-input" value="${target.priceMax}" step="0.1" onchange="updateTarget('${target.symbol}', 'priceMax', this.value)">
            <span class="edit-label">SOL</span>
          </div>
        </div>
        <div class="target-edit-row">
          <select class="inline-select rarity-select ${(target.minRarity || 'common').toLowerCase()}" 
            onchange="updateTarget('${target.symbol}', 'minRarity', this.value); this.className='inline-select rarity-select '+this.value.toLowerCase();">
            ${['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'].map(r =>
      `<option value="${r}" ${target.minRarity === r ? 'selected' : ''}>${r}</option>`
    ).join('')}
          </select>
          <select class="inline-select" onchange="updateTarget('${target.symbol}', 'rarityType', this.value)">
            <option value="statistical" ${target.rarityType === 'statistical' ? 'selected' : ''}>STAT</option>
            <option value="additive" ${target.rarityType === 'additive' ? 'selected' : ''}>ADD</option>
          </select>
        </div>
      </div>
    `;
    activeTargetsList.appendChild(tag);
  });
}

// ==================== TARGET ACTIONS ====================
async function addTarget(symbol) {
  if (activeTargets.find(t => t.symbol === symbol)) {
    showToast('Already watching', 'error');
    return;
  }

  try {
    const res = await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, priceMax: 1000, minRarity: 'COMMON', rarityType: 'statistical' })
    });
    if (res.ok) {
      const data = await res.json();
      activeTargets = data.targets;
      renderActiveTargets();
      updateWatchCount();
      document.querySelector('.add-collection-wrapper')?.classList.remove('open');
      collectionListContainer.classList.add('hidden');
      showToast(`Watching ${symbol}`, 'success');
    }
  } catch (e) {
    showToast('Failed to add', 'error');
  }
}

window.updateTarget = async function (symbol, field, value) {
  const target = activeTargets.find(t => t.symbol === symbol);
  if (!target) return;

  if (field === 'priceMax') target.priceMax = parseFloat(value);
  else target[field] = value;

  try {
    const res = await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target)
    });
    if (res.ok) showToast('Saved', 'success');
  } catch (e) {
    showToast('Error saving', 'error');
  }
};

window.removeTarget = async function (symbol) {
  if (!confirm('Stop watching?')) return;
  try {
    const res = await fetch(`/api/target/${symbol}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      activeTargets = data.targets;
      renderActiveTargets();
      updateWatchCount();
      showToast('Removed', 'success');
    }
  } catch (e) {
    showToast('Error', 'error');
  }
};

// ==================== LISTINGS ====================
function handleNewListing(listing) {
  const empty = listingsFeed.querySelector('.empty-state');
  if (empty) empty.remove();

  if (soundEnabled) alertSound.play().catch(() => { });

  const card = createListingCard(listing);
  listingsFeed.insertBefore(card, listingsFeed.firstChild);

  while (listingsFeed.children.length > 50) {
    listingsFeed.removeChild(listingsFeed.lastChild);
  }
}

function handleListingUpdate(update) {
  const card = listingsFeed.querySelector(`.listing-card[data-mint="${update.mint}"]`);
  if (card) {
    const title = card.querySelector('.listing-title');
    if (title) title.textContent = update.name;
  }
}

function getRelativeTime(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function createListingCard(listing) {
  const card = document.createElement('article');
  card.className = 'listing-card new';
  card.dataset.timestamp = listing.timestamp;
  card.dataset.mint = listing.mint;

  let priceClass = 'good';
  let fpStr = '';

  const target = listing.symbol
    ? activeTargets.find(t => t.symbol === listing.symbol)
    : activeTargets.find(t => listing.name?.toLowerCase().includes(t.symbol.toLowerCase()));

  if (target) {
    const col = availableCollections.find(c => c.symbol === target.symbol);
    if (col?.floorPrice) {
      const diff = listing.price - col.floorPrice;
      const isZero = Math.abs(diff) < 0.0005;
      let diffStr = isZero ? '0.000' : (diff > 0 ? '+' : '') + diff.toFixed(3);
      let diffClass = isZero ? 'diff-neutral' : (diff < 0 ? 'diff-good' : 'diff-bad');
      fpStr = `<span class="fp-diff ${diffClass}">${diffStr}</span>`;
    }
    const ratio = listing.price / target.priceMax;
    if (ratio > 0.8) priceClass = 'high';
    else if (ratio > 0.5) priceClass = 'medium';
  }

  let rarityHTML = '';
  if (listing.rarity) {
    rarityHTML = `<div class="rarity-pill"><span class="rarity-name ${listing.rarity.toLowerCase()}">${listing.rarity}</span><span class="rarity-rank">#${listing.rank}</span></div>`;
  }

  let secHTML = '';
  const isPrimStat = listing.rank_statistical && listing.rank === listing.rank_statistical;
  if (isPrimStat && listing.rank_additive) {
    const t = listing.tier_additive?.charAt(0) || '?';
    secHTML = `<span class="rarity-compact"><span class="rarity-letter ${listing.tier_additive?.toLowerCase() || ''}">#${listing.rank_additive} ${t}</span></span>`;
  } else if (listing.rank_statistical) {
    const t = listing.tier_statistical?.charAt(0) || '?';
    secHTML = `<span class="rarity-compact"><span class="rarity-letter ${listing.tier_statistical?.toLowerCase() || ''}">#${listing.rank_statistical} ${t}</span></span>`;
  }

  card.innerHTML = `
    <div class="listing-image-wrapper">
      ${listing.imageUrl
      ? `<img src="${listing.imageUrl}" class="listing-image" alt="" onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'>🖼</div>'">`
      : '<div class="no-image">🖼</div>'}
    </div>
    <div class="listing-info">
      <div class="listing-title">${escapeHtml(listing.name || 'Unnamed')}</div>
      <div class="listing-meta">
        ${rarityHTML}${secHTML}
        <span>•</span>
        <span class="listing-time">${getRelativeTime(listing.timestamp)}</span>
      </div>
    </div>
    <div class="listing-action-col">
      <div class="listing-prices-row">
        ${fpStr}
        <span class="listing-price ${priceClass}">${listing.price.toFixed(3)} SOL</span>
      </div>
      <a href="${listing.listingUrl}" target="_blank" class="listing-link">View</a>
    </div>
  `;

  setTimeout(() => card.classList.remove('new'), 600);
  return card;
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

setInterval(() => {
  document.querySelectorAll('.listing-card').forEach(card => {
    const ts = parseInt(card.dataset.timestamp);
    if (ts) {
      const el = card.querySelector('.listing-time');
      if (el) el.textContent = getRelativeTime(ts);
    }
  });
}, 10000);

// ==================== CLEAR FEED ====================
async function clearFeed() {
  try {
    const res = await fetch('/api/feed/clear', { method: 'POST' });
    if (res.ok) {
      listingsFeed.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <h3>Waiting for Listings</h3>
          <p>New NFT listings will appear here in real-time</p>
        </div>
      `;
      showToast('Feed cleared', 'success');
    }
  } catch (e) {
    showToast('Error clearing', 'error');
  }
}

// ==================== TOAST ====================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  toast.innerHTML = `<div class="toast-icon">${icon}</div><span class="toast-message">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastFadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
