// State
let eventSource = null;
let currentTarget = null;
let currentMetadata = null;

// Elements
const clientStatus = document.getElementById('client-status');
const statsDisplay = document.getElementById('stats-display');
// targetDisplay removed
const listingsFeed = document.getElementById('listings-feed');
const setTargetBtn = document.getElementById('set-target-btn');
const clearFeedBtn = document.getElementById('clear-feed-btn');
// const collectionSymbolInput = document.getElementById('collection-symbol'); // Removed
const priceMaxInput = document.getElementById('price-max');

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
  setTargetBtn.addEventListener('click', setTarget);
  clearFeedBtn.addEventListener('click', clearFeed);

  // Allow Enter key in inputs
  [priceMaxInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') setTarget();
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
    currentTarget = config.target;
    currentMetadata = config.metadata;
    renderTarget();
  } catch (error) {
    console.error('Error loading config:', error);
  }
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

// Render target (Updates Inputs & Button State)
function renderTarget() {
  const btnIcon = setTargetBtn.querySelector('.btn-icon');
  const btnText = setTargetBtn.querySelector('.btn-text');

  // Ensure Stop button exists
  let stopBtn = document.getElementById('stop-btn');
  if (!stopBtn) {
    stopBtn = document.createElement('button');
    stopBtn.id = 'stop-btn';
    stopBtn.className = 'btn-stop';
    stopBtn.innerHTML = '<span class="btn-icon">■</span><span class="btn-text">Stop</span>';
    stopBtn.onclick = removeTarget;
    stopBtn.style.display = 'none'; // Hidden by default

    // Append after start button
    setTargetBtn.parentNode.appendChild(stopBtn);
  }

  if (!currentTarget) {
    // No target active
    setTargetBtn.disabled = false;
    if (btnIcon) btnIcon.textContent = '▶';
    if (btnText) btnText.textContent = 'Start Sniping';
    stopBtn.style.display = 'none';

    return;
  }

  // Target active
  // collectionSymbolInput.value = currentTarget.symbol; // Removed
  priceMaxInput.value = currentTarget.priceMax;

  setTargetBtn.disabled = false;
  setTargetBtn.innerHTML = '<span class="btn-icon">⟳</span> Update Target';
  if (stopBtn) stopBtn.style.display = 'inline-flex';
}

// Set target
async function setTarget() {
  // const symbol = collectionSymbolInput.value.trim().toLowerCase(); // Removed
  const priceMax = parseFloat(priceMaxInput.value);

  if (isNaN(priceMax)) {
    alert('Please fill in all fields with valid values');
    return;
  }

  if (priceMax < 0) {
    alert('Invalid price');
    return;
  }

  const originalHTML = setTargetBtn.innerHTML;
  setTargetBtn.disabled = true;
  setTargetBtn.innerHTML = '<span class="btn-icon">⏳</span> Saving...';

  try {
    const response = await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceMax }) // Only sending priceMax
    });

    if (response.ok) {
      // Reload config
      await loadConfig();
    } else {
      alert('Failed to set target');
      setTargetBtn.disabled = false;
      setTargetBtn.innerHTML = originalHTML;
    }
  } catch (error) {
    console.error('Error setting target:', error);
    alert('Error setting target');
    setTargetBtn.disabled = false;
    setTargetBtn.innerHTML = originalHTML;
  }
}

// Remove target
async function removeTarget() {
  if (!confirm(`Stop sniping?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/target`, {
      method: 'DELETE'
    });

    if (response.ok) {
      // Clear local state
      currentTarget = null;
      currentMetadata = null;

      // Reset UI
      renderTarget();

      // Clear inputs
      // collectionSymbolInput.value = ''; // Removed
      priceMaxInput.value = '';
    } else {
      alert('Failed to stop sniping');
    }
  } catch (error) {
    console.error('Error stopping sniping:', error);
    alert('Error stopping sniping');
  }
}

// Handle new listing
function handleNewListing(listing) {
  console.log('[Listing]', listing);

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
  // Determine price color
  let priceClass = 'good';
  if (currentTarget && listing.price > currentTarget.priceMax * 0.9) {
    priceClass = 'medium';
  }

  const relativeTime = getRelativeTime(listing.timestamp);

  card.innerHTML = `
    <div class="listing-content">
      <div class="listing-image-wrapper">
        ${listing.imageUrl ? `<img src="${listing.imageUrl}" alt="${listing.name || 'NFT'}" class="listing-image" loading="lazy">` : '<div class="no-image"></div>'}
      </div>
      <div class="listing-info">
        <div class="listing-title">${listing.name || 'Unnamed NFT'}</div>
        <div class="listing-collection-name">${listing.collection}</div>
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
