// State
let eventSource = null;
let activeTargets = [];
let availableCollections = [];

// Elements
const clientStatus = document.getElementById('client-status');
const statsDisplay = document.getElementById('stats-display');
const listingsFeed = document.getElementById('listings-feed');
const addTargetBtn = document.getElementById('add-target-btn');
const clearFeedBtn = document.getElementById('clear-feed-btn');
const collectionSelect = document.getElementById('collection-select');
const priceMaxInput = document.getElementById('price-max');
const raritySelect = document.getElementById('rarity-select');
const activeTargetsList = document.getElementById('active-targets-list');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.querySelector('.sidebar');



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
  addTargetBtn.addEventListener('click', addTarget);
  clearFeedBtn.addEventListener('click', clearFeed);

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }



  // Allow Enter key in inputs
  [priceMaxInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addTarget();
    });
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

    renderCollectionOptions();
    renderActiveTargets();
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

function renderCollectionOptions() {
  const currentVal = collectionSelect.value;
  collectionSelect.innerHTML = '<option value="" disabled selected>Select Collection...</option>';

  // Sort collections alphabetically
  availableCollections.sort((a, b) => a.name.localeCompare(b.name));

  availableCollections.forEach(col => {
    const option = document.createElement('option');
    option.value = col.symbol;
    option.textContent = col.name;
    collectionSelect.appendChild(option);
  });

  if (currentVal) {
    collectionSelect.value = currentVal;
  }
}

function renderActiveTargets() {
  activeTargetsList.innerHTML = '';

  activeTargets.forEach(target => {
    const colMeta = availableCollections.find(c => c.symbol === target.symbol);
    const name = colMeta ? colMeta.name : target.symbol;
    const image = colMeta ? colMeta.image : '';
    const floorPrice = colMeta && colMeta.floorPrice !== undefined ? colMeta.floorPrice : null;
    const rarityBadge = target.minRarity ?
      `<span class="rarity-badge ${target.minRarity.toLowerCase()}">${target.minRarity}</span>` : '';

    const tag = document.createElement('div');
    tag.className = 'target-tag';

    let imageHTML = '';
    if (image) {
      imageHTML = `<img src="${image}" alt="${name}" class="target-image" />`;
    } else {
      imageHTML = `<div class="target-image-placeholder"></div>`;
    }

    let floorHTML = '';
    if (floorPrice !== null) {
      floorHTML = `<span class="target-floor">FP: ${floorPrice} SOL</span>`;
    }

    tag.innerHTML = `
      ${imageHTML}
      <div class="target-info">
        <div class="target-header">
            <span class="target-name">${name}</span>
            ${rarityBadge}
        </div>
        <div class="target-details">
            <span class="target-price">< ${target.priceMax} SOL</span>
            ${floorHTML}
        </div>
      </div>
      <button class="btn-remove-target" onclick="removeTarget('${target.symbol}')" title="Stop Watching">×</button>
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

// Add target
async function addTarget() {
  const symbol = collectionSelect.value;
  const priceMax = parseFloat(priceMaxInput.value);
  const minRarity = raritySelect.value;

  if (!symbol || isNaN(priceMax)) {
    alert('Please select a collection and enter a valid max price');
    return;
  }

  const originalHTML = addTargetBtn.innerHTML;
  addTargetBtn.disabled = true;
  addTargetBtn.innerHTML = 'Adding...';

  try {
    const response = await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, priceMax, minRarity })
    });

    if (response.ok) {
      const data = await response.json();
      activeTargets = data.targets;
      renderActiveTargets();
    } else {
      alert('Failed to add target');
    }
  } catch (error) {
    console.error('Error adding target:', error);
    alert('Error adding target');
  } finally {
    addTargetBtn.disabled = false;
    addTargetBtn.innerHTML = originalHTML;
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

  // Rarity Badges
  let rarityHTML = '';
  if (listing.rarity) {
    rarityHTML += `<span class="rarity-badge ${listing.rarity.toLowerCase()}">${listing.rarity}</span>`;
  }
  if (listing.rank) {
    rarityHTML += `<span class="rarity-badge common">#${listing.rank}</span>`;
  }

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
        <span>${relativeTime}</span>
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
      const timeSpan = card.querySelector('.listing-meta span:last-child');
      if (timeSpan) timeSpan.textContent = getRelativeTime(timestamp);
    }
  });
}, 10000);

function clearFeed() {
  listingsFeed.innerHTML = `
    <div class="empty-state">
        <span class="empty-icon">📡</span>
        <p>Waiting for new listings...</p>
    </div>
  `;
}
