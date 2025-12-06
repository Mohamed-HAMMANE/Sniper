// State
let eventSource = null;
let activeTargets = [];
let availableCollections = [];

// Elements
const clientStatus = document.getElementById('client-status');
const statsDisplay = document.getElementById('stats-display');
const listingsFeed = document.getElementById('listings-feed');
const clearFeedBtn = document.getElementById('clear-feed-btn');
const activeTargetsList = document.getElementById('active-targets-list');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.querySelector('.sidebar');
const addCollectionToggle = document.getElementById('add-collection-toggle');
const collectionListContainer = document.getElementById('collection-list-container');

// Audio for notifications
const alertSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz0IAyBx1tu+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lREzSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE=');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  connectSSE();
  setupEventListeners();
  loadStats();
});

// Setup event listeners
function setupEventListeners() {
  clearFeedBtn.addEventListener('click', clearFeed);

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  // Toggle Add Collection Widget
  if (addCollectionToggle) {
    addCollectionToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const widget = addCollectionToggle.parentElement;
      const list = document.getElementById('collection-list-container');
      widget.classList.toggle('open');
      list.classList.toggle('hidden');
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (addCollectionToggle && !addCollectionToggle.contains(e.target) && !collectionListContainer.contains(e.target)) {
      addCollectionToggle.parentElement.classList.remove('open');
      collectionListContainer.classList.add('hidden');
    }
  });
}

// Connect to SSE stream
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/listings-stream');

  eventSource.onopen = () => {
    clientStatus.textContent = 'Connected';
    clientStatus.className = 'status connected';
    console.log('[SSE] Connected to server');
  };

  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'connected') {
      console.log('[SSE] Connection confirmed, client ID:', message.clientId);
    } else if (message.type === 'listing') {
      handleNewListing(message.data);
    } else if (message.type === 'listing-update') {
      handleListingUpdate(message.data);
    } else if (message.type === 'floorPriceUpdate') {
      const { symbol, floorPrice } = message.data;
      // Update local state
      const colMeta = availableCollections.find(c => c.symbol === symbol);
      if (colMeta) {
        colMeta.floorPrice = floorPrice;
      }
      // Only re-render if we aren't currently editing (focus check could be added if needed)
      // For now, minimal interruption: just update text if element exists
      const fpEl = document.querySelector(`.target-tag[data-symbol="${symbol}"] .target-floor`);
      if (fpEl) {
        fpEl.textContent = `FP: ${Number(floorPrice).toFixed(3)} SOL`;
      }

      // Also update the dropdown list if it exists
      // The image is the first child, info div is second, inside info div span is second child
      // Simpler to find by text content or re-render, but let's try a robust selector if possible
      // Or just lookup by iterating since we don't have IDs there
      const collectionItems = document.querySelectorAll('.collection-item');
      collectionItems.forEach(item => {
        const nameEl = item.querySelector('.collection-name');
        if (nameEl && colMeta && nameEl.textContent === colMeta.name) { // Added colMeta check
          const fpSpan = item.querySelector('.collection-fp');
          if (fpSpan) fpSpan.textContent = `FP: ${Number(floorPrice).toFixed(2)}`;
        }
      });
    }
  };

  eventSource.onerror = (error) => {
    clientStatus.textContent = 'Disconnected';
    clientStatus.className = 'status disconnected';
    console.error('[SSE] Connection error:', error);
  };
}

// Load configuration
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    activeTargets = config.targets || [];
    availableCollections = config.collections || [];

    renderCollectionWidget();
    renderActiveTargets();
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

function renderCollectionWidget() {
  collectionListContainer.innerHTML = '';

  // Sort collections alphabetically
  availableCollections.sort((a, b) => a.name.localeCompare(b.name));

  availableCollections.forEach(col => {
    const item = document.createElement('div');
    item.className = 'collection-item';
    item.onclick = () => addTarget(col.symbol);

    item.innerHTML = `
        <img src="${col.image}" alt="${col.name}">
        <div class="collection-info">
            <span class="collection-name">${col.name}</span>
            <span class="collection-fp">FP: ${col.floorPrice ? col.floorPrice.toFixed(2) : '-.--'}</span>
        </div>
    `;
    collectionListContainer.appendChild(item);
  });
}

function renderActiveTargets() {
  activeTargetsList.innerHTML = '';

  activeTargets.forEach(target => {
    const colMeta = availableCollections.find(c => c.symbol === target.symbol);
    const name = colMeta ? colMeta.name : target.symbol;
    const image = colMeta ? colMeta.image : '';
    const floorPrice = colMeta && colMeta.floorPrice !== undefined ? colMeta.floorPrice : null;

    const tag = document.createElement('div');
    tag.className = 'target-tag';
    tag.dataset.symbol = target.symbol;

    let imageHTML = '';
    if (image) {
      imageHTML = `<img src="${image}" alt="${name}" class="target-image" />`;
    } else {
      imageHTML = `<div class="target-image-placeholder"></div>`;
    }

    let floorHTML = '';
    // Always render separate floor span for updates
    const initialFloor = floorPrice !== null ? `FP: ${Number(floorPrice).toFixed(3)} SOL` : 'FP: -.-';
    floorHTML = `<span class="target-floor">${initialFloor}</span>`;

    tag.innerHTML = `
      ${imageHTML}
      <div class="target-info">
        <div class="target-header">
            <span class="target-name">${name}</span>
            <button class="btn-remove-target" onclick="removeTarget('${target.symbol}')" title="Stop Watching">×</button>
        </div>
        <div class="target-details">
            ${floorHTML}
            <div class="edit-input-group" style="margin-left: auto;">
                <span class="edit-label"><</span>
                <input type="number" 
                    value="${target.priceMax}" 
                    class="inline-input" 
                    step="0.1" 
                    onchange="updateTarget('${target.symbol}', 'priceMax', this.value)"
                />
                <span class="edit-label">SOL</span>
            </div>
        </div>
        
        <!-- Inline Editing Row -->
        <div class="target-edit-row">
            <select class="inline-select rarity-select ${target.minRarity ? target.minRarity.toLowerCase() : 'common'}"
                style="flex: 1;"
                onchange="updateTarget('${target.symbol}', 'minRarity', this.value); this.className = 'inline-select rarity-select ' + this.value.toLowerCase();">
                <option value="COMMON" ${target.minRarity === 'COMMON' ? 'selected' : ''}>COMMON</option>
                <option value="UNCOMMON" ${target.minRarity === 'UNCOMMON' ? 'selected' : ''}>UNCOMMON</option>
                <option value="RARE" ${target.minRarity === 'RARE' ? 'selected' : ''}>RARE</option>
                <option value="EPIC" ${target.minRarity === 'EPIC' ? 'selected' : ''}>EPIC</option>
                <option value="LEGENDARY" ${target.minRarity === 'LEGENDARY' ? 'selected' : ''}>LEGENDARY</option>
                <option value="MYTHIC" ${target.minRarity === 'MYTHIC' ? 'selected' : ''}>MYTHIC</option>
            </select>

            <select class="inline-select" style="width: 70px;"
                onchange="updateTarget('${target.symbol}', 'rarityType', this.value)">
                <option value="statistical" ${target.rarityType === 'statistical' ? 'selected' : ''}>STAT</option>
                <option value="additive" ${target.rarityType === 'additive' ? 'selected' : ''}>ADD</option>
            </select>
        </div>
      </div>
    `;
    activeTargetsList.appendChild(tag);
  });
}

// Load stats
async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();
    statsDisplay.innerHTML = `<span title="Cached Listings">📦 ${stats.cacheSize}</span>`;
  } catch (error) {
    console.error('Error loading stats:', error);
  }

  setTimeout(loadStats, 5000);
}

// Add target with DEFAULTS
async function addTarget(symbol) {
  // Check if already active
  if (activeTargets.find(t => t.symbol === symbol)) {
    // Maybe flash the existing card?
    const card = document.querySelector(`.target-tag[data-symbol="${symbol}"]`);
    if (card) {
      card.style.borderColor = 'var(--color-success)';
      setTimeout(() => card.style.borderColor = '', 500);
    }
    return; // Do nothing if already added
  }

  // Defaults
  const priceMax = 1000;
  const minRarity = 'COMMON';
  const rarityType = 'statistical';

  try {
    const response = await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, priceMax, minRarity, rarityType })
    });

    if (response.ok) {
      const data = await response.json();
      activeTargets = data.targets;
      renderActiveTargets();
      // Hide dropdown after adding
      addCollectionToggle.parentElement.classList.remove('open');
      collectionListContainer.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error adding target:', error);
  }
}

// Update Target (Inline Edit)
window.updateTarget = async function (symbol, field, value) {
  const target = activeTargets.find(t => t.symbol === symbol);
  if (!target) return;

  // Update local immediately for responsiveness
  if (field === 'priceMax') target.priceMax = parseFloat(value);
  if (field === 'minRarity') target.minRarity = value;
  if (field === 'rarityType') target.rarityType = value;

  try {
    // Send full updated object
    const response = await fetch('/api/target', {
      method: 'POST', // Use POST as upsert
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: target.symbol,
        priceMax: target.priceMax,
        minRarity: target.minRarity,
        rarityType: target.rarityType
      })
    });

    if (!response.ok) {
      console.error('Failed to update target');
    }
  } catch (e) {
    console.error('Error updating target:', e);
  }
}

// Remove target
window.removeTarget = async function (symbol) {
  if (!confirm(`Stop watching this collection?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/target/${symbol}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      const data = await response.json();
      activeTargets = data.targets;
      renderActiveTargets();
    } else {
      alert('Failed to remove target');
    }
  } catch (error) {
    console.error('Error removing target:', error);
    alert('Error removing target');
  }
}

// Handle new listing
function handleNewListing(listing) {
  // Remove empty state if present
  const emptyState = listingsFeed.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  // Play alert sound
  try {
    alertSound.play().catch(e => console.log('Audio play failed:', e));
  } catch (e) {
    console.log('Audio not supported');
  }

  const card = createListingCard(listing);
  listingsFeed.insertBefore(card, listingsFeed.firstChild);

  // Limit feed to 50 items
  while (listingsFeed.children.length > 50) {
    listingsFeed.removeChild(listingsFeed.lastChild);
  }
}

// Handle listing update
function handleListingUpdate(update) {
  const card = listingsFeed.querySelector(`.listing-card[data-mint="${update.mint}"]`);

  if (card) {
    const titleEl = card.querySelector('.listing-title');
    if (titleEl) {
      titleEl.textContent = update.name;
      titleEl.classList.add('updated');
      setTimeout(() => titleEl.classList.remove('updated'), 1000);
    }
  }
}

// Get relative time string
function getRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// Create listing card
function createListingCard(listing) {
  const card = document.createElement('div');
  card.className = 'listing-card new';
  card.dataset.timestamp = listing.timestamp;
  card.dataset.mint = listing.mint;
  card.setAttribute('role', 'article');

  // Determine price color
  let priceClass = 'good';
  const target = activeTargets.find(t => listing.name && listing.name.toLowerCase().includes(t.symbol.toLowerCase()));
  if (target && listing.price) {
    const priceRatio = listing.price / target.priceMax;
    if (priceRatio > 0.8) priceClass = 'high';
    else if (priceRatio > 0.5) priceClass = 'medium';
  }

  const relativeTime = getRelativeTime(listing.timestamp);

  // Rarity Logic
  let rarityHTML = '';
  const primaryRank = listing.rank;
  const primaryTier = listing.rarity;

  // 1. Primary Badge: [TIER] [#RANK]
  if (primaryTier) {
    rarityHTML += `
      <div class="rarity-pill">
        <span class="rarity-name ${primaryTier.toLowerCase()}">${primaryTier}</span>
        <span class="rarity-rank">#${primaryRank}</span>
      </div>`;
  }

  // 2. Secondary Compact: "A: #123 U" or "S: #123 U"
  // Determine if primary is Statistical or Additive
  let isPrimaryStat = false;

  if (listing.rank_statistical && listing.rank === listing.rank_statistical) {
    isPrimaryStat = true;
  }

  let secondaryHTML = '';
  if (isPrimaryStat) {
    // Secondary is Additive
    if (listing.rank_additive) {
      const tierLetter = listing.tier_additive ? listing.tier_additive.charAt(0).toUpperCase() : '?';
      secondaryHTML = `<span class="rarity-compact" title="Additive Rarity"><span class="rarity-letter ${listing.tier_additive ? listing.tier_additive.toLowerCase() : ''}">#${listing.rank_additive} ${tierLetter}</span></span>`;
    }
  } else {
    // Secondary is Statistical
    if (listing.rank_statistical) {
      const tierLetter = listing.tier_statistical ? listing.tier_statistical.charAt(0).toUpperCase() : '?';
      secondaryHTML = `<span class="rarity-compact" title="Statistical Rarity"><span class="rarity-letter ${listing.tier_statistical ? listing.tier_statistical.toLowerCase() : ''}">#${listing.rank_statistical} ${tierLetter}</span></span>`;
    }
  }

  rarityHTML += secondaryHTML;

  card.innerHTML = `
    <div class="listing-image-wrapper">
      ${listing.imageUrl ?
      `<img src="${listing.imageUrl}" alt="${listing.name}" class="listing-image" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;no-image&quot;></div>';" />` :
      '<div class="no-image"></div>'}
    </div>
    <div class="listing-info">
      <div class="listing-title" title="${listing.name}">${escapeHtml(listing.name || 'Unnamed NFT')}</div>
      <div class="listing-meta">
        ${rarityHTML}
        <span>•</span>
        <span class="listing-time">${relativeTime}</span>
      </div>
    </div>
    <div class="listing-action-col">
      <div class="listing-price ${priceClass}">${listing.price.toFixed(3)} SOL</div>
      <a href="${listing.listingUrl}" target="_blank" class="listing-link">View</a>
    </div>
  `;

  setTimeout(() => card.classList.remove('new'), 600);
  setTimeout(() => card.classList.add('stale'), 2 * 60 * 1000);

  return card;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Update timestamps
setInterval(() => {
  document.querySelectorAll('.listing-card').forEach(card => {
    const timestamp = parseInt(card.dataset.timestamp);
    if (timestamp) {
      const timeSpan = card.querySelector('.listing-time');
      if (timeSpan) timeSpan.textContent = getRelativeTime(timestamp);
    }
  });
}, 10000);

async function clearFeed() {
  try {
    const response = await fetch('/api/feed/clear', { method: 'POST' });
    if (response.ok) {
      listingsFeed.innerHTML = `
        <div class="empty-state">
            <span class="empty-icon">📡</span>
            <p>Waiting for new listings...</p>
        </div>
      `;
    } else {
      console.error('Failed to clear feed history on server');
    }
  } catch (error) {
    console.error('Error clearing feed:', error);
  }
}
