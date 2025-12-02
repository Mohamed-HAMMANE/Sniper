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

    // EventSource will auto-reconnect
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
  // Save current selection if any
  const currentVal = collectionSelect.value;

  collectionSelect.innerHTML = '<option value="" disabled selected>Select Collection...</option>';

  availableCollections.forEach(col => {
    const option = document.createElement('option');
    option.value = col.symbol;
    option.textContent = col.name;
    collectionSelect.appendChild(option);
  });

  if (currentVal) collectionSelect.value = currentVal;
}

function renderActiveTargets() {
  activeTargetsList.innerHTML = '';

  activeTargets.forEach(target => {
    const colMeta = availableCollections.find(c => c.symbol === target.symbol);
    const name = colMeta ? colMeta.name : target.symbol;
    const rarityText = target.minRarity ? `(${target.minRarity}+)` : '';

    const tag = document.createElement('div');
    tag.className = 'target-tag';
    tag.innerHTML = `
      <span class="target-name">${name}</span>
      <span class="target-price">< ${target.priceMax} SOL</span>
      <span class="target-rarity">${rarityText}</span>
      <button class="btn-remove-target" onclick="removeTarget('${target.symbol}')">×</button>
    `;
    activeTargetsList.appendChild(tag);
  });
}

// Load stats
async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();
    statsDisplay.innerHTML = `<span title="Cache Size">📦 ${stats.cacheSize}</span> <span class="divider">|</span> <span title="Connected Clients">👥 ${stats.connectedClients}</span>`;
  } catch (error) {
    console.error('Error loading stats:', error);
  }

  // Refresh stats every 5 seconds
  setTimeout(loadStats, 5000);
}

// Render target (Updates Inputs & Button State) - REMOVED OLD FUNCTION
// function renderTarget() { ... }

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
  addTargetBtn.innerHTML = '<span class="btn-icon">⏳</span> Adding...';

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

      // Reset inputs
      // collectionSelect.value = ''; // Keep selected for ease of use?
      // priceMaxInput.value = '';
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
// Exposed globally for onclick handler
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

  // Create listing card
  const card = createListingCard(listing);

  // Prepend to feed
  listingsFeed.insertBefore(card, listingsFeed.firstChild);

  // Limit feed to 20 items (only show most recent)
  while (listingsFeed.children.length > 20) {
    listingsFeed.removeChild(listingsFeed.lastChild);
  }
}

// Handle listing update (metadata loaded)
function handleListingUpdate(update) {
  console.log('[Update]', update);
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

  // Determine price color
  let priceClass = 'good';
  // Check against the specific target for this collection
  // Since we don't have the target info attached to the listing easily here without looking it up,
  // we can just default to 'good' or try to find the target.
  const target = activeTargets.find(t => listing.name && listing.name.includes(t.symbol)); // Approximate or need better matching
  // Actually, we don't have collection symbol in listing anymore, but we have name.
  // Let's just leave it green for now as it passed the filter.

  const relativeTime = getRelativeTime(listing.timestamp);

  card.innerHTML = `
    <div class="listing-content">
      <div class="listing-image-wrapper">
        ${listing.imageUrl ? `<img src="${listing.imageUrl}" alt="${listing.name || 'NFT'}" class="listing-image" loading="lazy">` : '<div class="no-image"></div>'}
      </div>
      <div class="listing-info">
        <div class="listing-title">${listing.name || 'Unnamed NFT'}</div>
        <div class="listing-source">${listing.source}</div>
        <div class="listing-rarity-info">
            ${listing.rarity ? `<span class="rarity-badge ${listing.rarity.toLowerCase()}">${listing.rarity}</span>` : ''}
            ${listing.rank ? `<span class="rank-badge">Rank #${listing.rank}</span>` : ''}
        </div>
        <div class="listing-mint-id">Mint: ${listing.mint.substring(0, 6)}...${listing.mint.substring(listing.mint.length - 4)}</div>
        <div class="listing-timestamp" data-timestamp="${listing.timestamp}">⚡ ${relativeTime}</div>
      </div>
      <div class="listing-action-col">
        <div class="listing-price ${priceClass}">${listing.price.toFixed(3)} SOL</div>
        <a href="${listing.listingUrl}" target="_blank" class="listing-link">View →</a>
      </div>
    </div>
  `;

  // Remove 'new' class after animation
  setTimeout(() => {
    card.classList.remove('new');
  }, 1000);

  // Mark as potentially stale after 2 minutes
  setTimeout(() => {
    card.classList.add('stale');
  }, 2 * 60 * 1000);

  return card;
}

// Update all timestamps every 10 seconds
setInterval(() => {
  document.querySelectorAll('.listing-timestamp').forEach(el => {
    const timestamp = parseInt(el.dataset.timestamp);
    if (timestamp) {
      el.textContent = '⚡ ' + getRelativeTime(timestamp);
    }
  });
}, 10000);

// Clear feed
function clearFeed() {
  listingsFeed.innerHTML = '<p class="empty-state">Waiting for listings...</p>';
}
