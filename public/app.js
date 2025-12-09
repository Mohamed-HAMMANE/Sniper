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
    else if (msg.type === 'tx_confirmed') {
      showToast(`✅ Transaction Confirmed!`, 'success');
      if (soundEnabled) try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz0IAyBx1tu+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lREzSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE=').play().catch(e => { }); } catch (e) { }
    }
    else if (msg.type === 'tx_failed') {
      showToast(`❌ Transaction Failed: ${JSON.stringify(msg.data.error)}`, 'error');
    }
    else if (msg.type === 'tx_timeout') {
      showToast(`⚠️ Transaction Timeout (Check Solscan)`, 'error');
    }
    else if (msg.type === 'balanceUpdate') {
      updateBalanceDisplay(msg.data.balance);
    }
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

// ==================== CHART MODAL ====================
let chartInstance = null;

window.openChart = async function (symbol) {
  const modal = document.getElementById('chart-modal');
  const modalImage = document.getElementById('modal-image');
  const modalTitle = document.getElementById('modal-title');
  const modalStats = document.getElementById('modal-stats');
  const ctx = document.getElementById('priceChart').getContext('2d');

  // Find collection info
  const col = availableCollections.find(c => c.symbol === symbol);
  const name = col ? col.name : symbol;
  const image = col?.image || '';

  // Set header info
  modalImage.src = image;
  modalImage.style.display = image ? 'block' : 'none';
  modalTitle.textContent = name;
  modalStats.textContent = 'Loading history...';

  // Show modal
  modal.classList.remove('hidden');

  try {
    // Fetch Data
    const res = await fetch(`/api/history/${symbol}`);
    const data = await res.json();
    const history = data.history || []; // [{t, p}, ...]

    if (history.length === 0) {
      modalStats.textContent = 'No history data available';
      if (chartInstance) chartInstance.destroy();
      return;
    }

    // Process Data for Chart
    // Sort by time just in case
    history.sort((a, b) => a.t - b.t);

    const labels = history.map(h => new Date(h.t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    const prices = history.map(h => h.p);

    // Calculate stats
    const currentPrice = prices[prices.length - 1];
    const startPrice = prices[0];
    const change = currentPrice - startPrice;
    const changePct = ((change / startPrice) * 100).toFixed(2);
    const color = change >= 0 ? '#22c55e' : '#ef4444'; // Green or Red

    modalStats.innerHTML = `Current: <span style="color:${color}">${currentPrice.toFixed(3)} SOL</span> • Change: <span style="color:${color}">${change > 0 ? '+' : ''}${changePct}%</span>`;

    // specific gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, change >= 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    // Destroy old chart
    if (chartInstance) chartInstance.destroy();

    // Create Chart
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Floor Price (SOL)',
          data: prices,
          borderColor: color,
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(20, 20, 30, 0.9)',
            titleColor: '#94a3b8',
            bodyColor: '#fff',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(3)} SOL`
            }
          }
        },
        scales: {
          x: {
            display: false,
            grid: { display: false }
          },
          y: {
            position: 'right',
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 10 },
              callback: (val) => val.toFixed(2)
            }
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    });

  } catch (e) {
    console.error(e);
    modalStats.textContent = 'Error loading chart data';
  }
};

window.closeChart = function () {
  document.getElementById('chart-modal').classList.add('hidden');
};

// Close on background click
document.getElementById('chart-modal').addEventListener('click', (e) => {
  if (e.target.id === 'chart-modal') window.closeChart();
});

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
    const rarityShort = (target.minRarity || 'COMMON').substring(0, 3);
    const rarityClass = (target.minRarity || 'common').toLowerCase();

    const tag = document.createElement('div');
    tag.className = 'target-card';
    tag.dataset.symbol = target.symbol;

    tag.innerHTML = `
      <div class="target-card-header">
        ${image
        ? `<img src="${image}" class="target-thumb" alt="${name}" onclick="openChart('${target.symbol}')">`
        : `<div class="target-thumb-placeholder" onclick="openChart('${target.symbol}')">🎯</div>`
      }
        <div class="target-title-group">
          <span class="target-name" onclick="openChart('${target.symbol}')">${name}</span>
          <span class="target-floor-price">FP: ${fp ? fp.toFixed(3) : '—'}</span>
        </div>
        <div class="target-header-actions">
          <label class="auto-toggle ${target.autoBuy ? 'active' : ''}" title="Auto Buy">
            <input type="checkbox" ${target.autoBuy ? 'checked' : ''} onchange="updateTarget('${target.symbol}', 'autoBuy', this.checked); this.parentElement.classList.toggle('active', this.checked);">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
          <button class="btn-remove" onclick="removeTarget('${target.symbol}')" title="Remove">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="target-card-controls">
        <div class="control-group">
          <span class="control-label">Max</span>
          <input type="number" class="control-input" value="${target.priceMax}" step="0.1" onchange="updateTarget('${target.symbol}', 'priceMax', this.value)">
        </div>
        <div class="control-group">
          <span class="control-label">Min</span>
          <div class="rarity-indicator ${rarityClass}">
            <select class="rarity-dropdown" onchange="updateTarget('${target.symbol}', 'minRarity', this.value); this.parentElement.className='rarity-indicator '+this.value.toLowerCase();">
              ${['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'].map(r =>
        `<option value="${r}" ${target.minRarity === r ? 'selected' : ''}>${r.substring(0, 3)}</option>`
      ).join('')}
            </select>
          </div>
        </div>
        <div class="control-group">
          <span class="control-label">Type</span>
          <select class="type-dropdown" onchange="updateTarget('${target.symbol}', 'rarityType', this.value)">
            <option value="statistical" ${target.rarityType === 'statistical' ? 'selected' : ''}>Stat</option>
            <option value="additive" ${target.rarityType === 'additive' ? 'selected' : ''}>Add</option>
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

  // Update card creation to pass seller
  card.innerHTML = `
    <a href="${listing.listingUrl}" target="_blank" class="listing-image-wrapper" title="View on Magic Eden">
      ${listing.imageUrl
      ? `<img src="${listing.imageUrl}" class="listing-image" alt="" onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'>🖼</div>'">`
      : '<div class="no-image">🖼</div>'}
    </a>
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
      <button class="btn-buy-now-inline" onclick="buyListing('${listing.mint}', ${listing.price}, '${listing.seller}', '${listing.auctionHouse || ''}', ${listing.sellerExpiry || 0}, this)">Buy Now</button>
    </div>`;

  setTimeout(() => card.classList.remove('new'), 600);
  return card;
}

window.buyListing = async function (mint, price, seller, auctionHouse, sellerExpiry, btn) {
  if (btn.disabled) return;

  if (!confirm(`Confirm BUY for ${price} SOL?`)) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mint, price, seller, auctionHouse, sellerExpiry })
    });

    const data = await res.json();

    if (res.ok) {
      btn.textContent = 'SNIPED';
      btn.classList.add('success');
      showToast(`SNIPED! TX: ${data.signature.slice(0, 8)}...`, 'success');
      new Audio('data:audio/wav;base64,UklGRiQA...'); // TODO: Add better sound
    } else {
      throw new Error(data.error || 'Failed');
    }
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    showToast(`Buy Failed: ${e.message}`, 'error');
  }
};

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

// Balance Refresh
document.getElementById('refresh-balance-btn')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/balance/refresh', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateBalanceDisplay(data.balance);
      showToast('Balance updated', 'success');
    }
  } catch (e) {
    console.error('Balance error', e);
  }
});

function updateBalanceDisplay(solAmount) {
  const el = document.getElementById('balance-display');
  if (el) {
    el.textContent = `${Number(solAmount).toFixed(3)} SOL`;
    if (solAmount < 0.1) el.style.color = '#ff4d4d'; // Red warning
    else el.style.color = '#00ff9d'; // Green
  }
}

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
