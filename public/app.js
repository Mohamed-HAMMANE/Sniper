// ==================== STATE ====================
let eventSource = null;
let activeTargets = [];
let availableCollections = [];
let soundEnabled = true;

// ==================== DOM ELEMENTS ====================
let clientStatus;
let cacheCount;
let listingsFeed;
let clearFeedBtn;
let activeTargetsList;
let sidebarToggle;
let sidebar;
let addCollectionToggle;
let collectionListContainer;
let watchCount;
let soundToggle;

// ==================== AUDIO ====================
const alertSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz0IAyBx1tu+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lREzSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE0i9n0xnIpBSh+zPLaizsIGGS57OihUxELTKXh8bllHAU2jtHz1IAyBx1su+3nmVERNIvZ9MZyKQUofszy2os7CBhkuezoQVMRC0yl4fG5ZRwFNo7R89SAMgcdbLvt55lRETSL2fTGcikFKH7M8tqLOwgYZLns6KFTEQtMpeHxuWUcBTaO0fPUgDIHHWy77eeZURE=');

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initDOMElements();
  loadConfig();
  connectSSE();
  setupEventListeners();
  loadStats();
});

function initDOMElements() {
  clientStatus = document.getElementById('client-status');
  cacheCount = document.getElementById('cache-count');
  listingsFeed = document.getElementById('listings-feed');
  clearFeedBtn = document.getElementById('clear-feed-btn');
  activeTargetsList = document.getElementById('active-targets-list');
  sidebarToggle = document.getElementById('sidebar-toggle');
  sidebar = document.getElementById('sidebar');
  addCollectionToggle = document.getElementById('add-collection-toggle');
  collectionListContainer = document.getElementById('collection-list-container');
  watchCount = document.getElementById('watch-count');
  soundToggle = document.getElementById('sound-toggle');
}

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
    collectionListContainer.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (addCollectionToggle && collectionListContainer) {
      if (!addCollectionToggle.contains(e.target) && !collectionListContainer.contains(e.target)) {
        collectionListContainer.classList.add('hidden');
      }
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
    else if (msg.type === 'config_update') {
      activeTargets = msg.data;
      renderActiveTargets();
      updateWatchCount();
    }
    else if (msg.type === 'setup_progress') handleSetupProgress(msg.data);
    else if (msg.type === 'setup_complete') handleSetupComplete(msg.data);
    else if (msg.type === 'setup_error') handleSetupError(msg.data);
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
    managerCollections = config.collections || [];
    window.defaultPriorityFee = config.defaultPriorityFee; // Store globally for UI
    renderCollectionWidget();
    renderActiveTargets();
    updateWatchCount();

    // Refresh manager table if modal is currently open
    const managerModal = document.getElementById('manager-modal');
    if (managerModal && !managerModal.classList.contains('hidden')) {
      renderManagerTable();
    }
  } catch (e) {
    console.error('Error loading config:', e);
    showToast(`Config Load Error: ${e.message}`, 'error');
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    if (cacheCount) cacheCount.textContent = stats.cacheSize || 0;

    // Update connected count if we are currently connected
    if (clientStatus && clientStatus.classList.contains('connected')) {
      const count = stats.connectedClients || 1;
      clientStatus.innerHTML = `<span class="status-dot"></span><span class="status-label">${count} Connected</span>`;
    }

    // Store wallet address
    if (stats.walletAddress) walletAddress = stats.walletAddress;
  } catch (e) { }
  setTimeout(loadStats, 5000);
}

function updateWatchCount() {
  if (watchCount) watchCount.textContent = activeTargets.length;
}

window.openSetup = function () {
  document.getElementById('setup-modal').classList.remove('hidden');
  document.getElementById('setup-form').classList.remove('hidden');
  document.getElementById('setup-progress-container').classList.add('hidden');
}

function handleFloorPriceUpdate({ symbol, floorPrice }) {
  const col = availableCollections.find(c => c.symbol === symbol);
  if (col) col.floorPrice = floorPrice;

  const fpEl = document.querySelector(`.target-tag[data-symbol="${symbol}"] .target-floor`);
  if (fpEl) fpEl.textContent = `FP: ${Number(floorPrice).toFixed(3)} SOL`;
}

// ==================== COPY WALLET ====================
let walletAddress = '';

function setupCopyListener() {
  const copyBtn = document.getElementById('copy-address-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!walletAddress) {
        showToast('Address not loaded yet', 'error');
        return;
      }
      navigator.clipboard.writeText(walletAddress).then(() => {
        showToast('Address copied to clipboard!', 'success');
      }).catch(err => {
        console.error('Failed to copy: ', err);
        showToast('Failed to copy address', 'error');
      });
    });
  }
}
document.addEventListener('DOMContentLoaded', setupCopyListener);

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
  try {
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

      const isCollapsed = target.collapsed === true;

      const card = document.createElement('div');
      card.className = `target-card ${isCollapsed ? 'collapsed' : ''}`;
      card.dataset.symbol = target.symbol;

      const filtersHtml = (target.filters || []).map((filter, idx) => {
        const rarityClass = (filter.minRarity || 'common').toLowerCase();
        const traitCount = filter.traitFilters ? Object.keys(filter.traitFilters).length : 0;
        return `
          <div class="filter-block" data-filter-id="${filter.id}">
            <div class="filter-header">
              <span class="filter-index">Filter ${idx + 1}</span>
              <label class="auto-toggle ${filter.autoBuy ? 'active' : ''}" title="Auto Buy">
                <input type="checkbox" ${filter.autoBuy ? 'checked' : ''} 
                  onchange="updateFilter('${target.symbol}', '${filter.id}', 'autoBuy', this.checked); this.parentElement.classList.toggle('active', this.checked);">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            
            <!-- Vertical layout: one field per row -->
            <div class="filter-row">
              <span class="filter-row-label">MAX PRICE</span>
              <div class="filter-row-input">
                <input type="number" class="control-input" value="${filter.priceMax}" step="0.1" 
                  onchange="updateFilter('${target.symbol}', '${filter.id}', 'priceMax', this.value)">
                <span class="input-suffix-inline">◎</span>
              </div>
            </div>

            <div class="filter-row">
              <span class="filter-row-label">MAX RANK</span>
              <div class="filter-row-input">
                <input type="number" class="control-input" value="${filter.maxRank || ''}" placeholder="Any" step="1" 
                  onchange="updateFilter('${target.symbol}', '${filter.id}', 'maxRank', this.value)">
                <span class="input-suffix-inline">#</span>
              </div>
            </div>

            
            <div class="filter-row">
              <span class="filter-row-label">MIN RARITY</span>
              <div class="filter-row-input rarity-indicator ${rarityClass}">
                <select class="rarity-dropdown" 
                  onchange="updateFilter('${target.symbol}', '${filter.id}', 'minRarity', this.value); this.parentElement.className='filter-row-input rarity-indicator '+this.value.toLowerCase();">
                  ${['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'].map(r =>
          `<option value="${r}" ${filter.minRarity === r ? 'selected' : ''}>${r}</option>`
        ).join('')}
                </select>
              </div>
            </div>
            
            <div class="filter-row">
              <span class="filter-row-label">RARITY TYPE</span>
              <div class="filter-row-input">
                <select class="type-dropdown" 
                  onchange="updateFilter('${target.symbol}', '${filter.id}', 'rarityType', this.value)">
                  <option value="statistical" ${filter.rarityType === 'statistical' ? 'selected' : ''}>Statistical</option>
                  <option value="additive" ${filter.rarityType === 'additive' ? 'selected' : ''}>Additive</option>
                </select>
              </div>
            </div>
            
            <div class="filter-row">
              <span class="filter-row-label">ATTRIBUTES</span>
              <button class="btn-attrs ${traitCount > 0 ? 'has-selection' : ''}" 
                onclick="openTraitFiltersForFilter('${target.symbol}', '${filter.id}')">
                ${traitCount > 0 ? traitCount + ' selected' : '0 selected'}
              </button>
            </div>

            <div class="filter-row">
              <span class="filter-row-label">BUY LIMIT</span>
              <div class="stepper-control">
                <button class="stepper-btn" onclick="decrementLimit('${target.symbol}', '${filter.id}')">−</button>
                <div class="stepper-value ${!filter.buyLimit ? 'infinite' : ''}" 
                  onclick="resetBuyCount('${target.symbol}', '${filter.id}')" 
                  title="Click to Reset Count">
                  ${!filter.buyLimit ? '∞' : (filter.buyCount || 0) + ' / ' + filter.buyLimit}
                </div>
                <button class="stepper-btn" onclick="incrementLimit('${target.symbol}', '${filter.id}')">+</button>
              </div>
            </div>

            <div class="filter-row">
              <span class="filter-row-label">JITO FEE (SOL)</span>
              <div class="filter-row-input">
                <input type="number" class="control-input" value="${filter.priorityFee || ''}" step="0.0001" placeholder="${window.defaultPriorityFee || '0.0005'}"
                  onchange="updateFilter('${target.symbol}', '${filter.id}', 'priorityFee', this.value)">
                <span class="input-suffix-inline">◎</span>
              </div>
            </div>
            
            <button class="btn-delete-filter" onclick="deleteFilter('${target.symbol}', '${filter.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>
              DELETE FILTER
            </button>
          </div>
        `;
      }).join('');

      card.innerHTML = `
        <button class="btn-close-float" onclick="event.stopPropagation(); removeTarget('${target.symbol}')" title="Stop Watching">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div class="target-card-header" onclick="toggleCardCollapse('${target.symbol}')">
          ${image
          ? `<img src="${image}" class="target-thumb" alt="${name}" onclick="event.stopPropagation(); openExplorer('${target.symbol}')">`
          : `<div class="target-thumb-placeholder" onclick="event.stopPropagation(); openExplorer('${target.symbol}')">🎯</div>`
        }
          <div class="target-title-group">
            <span class="target-name" onclick="event.stopPropagation(); openExplorer('${target.symbol}')">${name}</span>
            <span class="target-floor-price">FP: ${fp ? fp.toFixed(3) : '—'}</span>
          </div>
          <div class="target-header-actions">
            <button class="btn-explore" onclick="event.stopPropagation(); openChart('${target.symbol}')" title="Price Chart">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 20V10M12 20V4M6 20v-6"></path>
              </svg>
            </button>
            <button class="btn-collapse" title="${isCollapsed ? 'Expand' : 'Collapse'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="${isCollapsed ? 'M6 9l6 6 6-6' : 'M18 15l-6-6-6 6'}"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="filters-container ${isCollapsed ? 'hidden' : ''}">
          ${filtersHtml}
          <button class="btn-add-filter" onclick="addFilter('${target.symbol}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Add filter
          </button>
        </div>
      `;
      activeTargetsList.appendChild(card);
    });

  } catch (e) {
    console.error(e);
    showToast(`Render Error: ${e.message}`, 'error');
  }
}

// Toggle card collapse state and persist to server
window.toggleCardCollapse = async function (symbol) {
  const target = activeTargets.find(t => t.symbol === symbol);
  if (!target) return;

  // Optimistic update
  const newState = !target.collapsed;
  target.collapsed = newState;
  renderActiveTargets();

  try {
    await fetch(`/api/target/${symbol}/collapse`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapsed: newState })
    });
  } catch (e) {
    console.error('Failed to save state', e);
    // revert on failure?
  }
};


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
      collectionListContainer.classList.add('hidden');
      showToast(`Watching ${symbol}`, 'success');
    }
  } catch (e) {
    showToast('Failed to add', 'error');
  }
}

// Add a new filter to existing collection
window.addFilter = async function (symbol) {
  try {
    const res = await fetch(`/api/target/${symbol}/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceMax: 1000, minRarity: 'COMMON', rarityType: 'statistical', autoBuy: false })
    });
    if (res.ok) {
      const data = await res.json();
      activeTargets = data.targets;
      renderActiveTargets();
      showToast('Filter added', 'success');
    }
  } catch (e) {
    showToast('Error adding filter', 'error');
  }
};

// Update a specific filter
window.updateFilter = async function (symbol, filterId, field, value) {
  const target = activeTargets.find(t => t.symbol === symbol);
  if (!target) return;

  const filter = target.filters?.find(f => f.id === filterId);
  if (!filter) return;

  // Update local state
  if (field === 'priceMax' || field === 'priorityFee') filter[field] = parseFloat(value) || undefined;
  else if (field === 'maxRank' || field === 'buyLimit') filter[field] = value ? parseInt(value) : undefined;
  else filter[field] = value;

  try {
    const payload = {};
    if (field === 'priceMax' || field === 'priorityFee') payload[field] = parseFloat(value) || null;
    else if (field === 'maxRank' || field === 'buyLimit') payload[field] = value ? parseInt(value) : null;
    else payload[field] = value;

    const res = await fetch(`/api/target/${symbol}/filter/${filterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      activeTargets = data.targets;
      renderActiveTargets();
      showToast('Saved', 'success');
    }
  } catch (e) {
    showToast('Error saving', 'error');
  }
};

// Delete a specific filter
window.deleteFilter = async function (symbol, filterId) {
  const target = activeTargets.find(t => t.symbol === symbol);
  // const filterCount = target?.filters?.length || 0;

  // Confirmation removed by user request


  try {
    const res = await fetch(`/api/target/${symbol}/filter/${filterId}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      activeTargets = data.targets;
      renderActiveTargets();
      updateWatchCount();
      showToast(data.collectionRemoved ? 'Collection removed' : 'Filter deleted', 'success');
    }
  } catch (e) {
    showToast('Error', 'error');
  }
};

// ==================== STEPPER LOGIC ====================
window.incrementLimit = function (symbol, filterId) {
  const target = activeTargets.find(t => t.symbol === symbol);
  const filter = target?.filters.find(f => f.id === filterId);
  const currentLimit = filter?.buyLimit || 0;

  // If 0 (Infinite), go to 1. Else increment.
  const newVal = currentLimit === 0 ? 1 : currentLimit + 1;
  updateFilter(symbol, filterId, 'buyLimit', newVal);
};

window.decrementLimit = function (symbol, filterId) {
  const target = activeTargets.find(t => t.symbol === symbol);
  const filter = target?.filters.find(f => f.id === filterId);
  const currentLimit = filter?.buyLimit || 0;

  // If 0 (Infinite), do nothing or loop? SolRarity logic usually: 
  // If 1, go to 0 (Infinite). If > 1, decrement.
  if (currentLimit === 0) return;
  const newVal = currentLimit === 1 ? 0 : currentLimit - 1;
  updateFilter(symbol, filterId, 'buyLimit', newVal === 0 ? '' : newVal);
};

window.resetBuyCount = function (symbol, filterId) {
  if (confirm('Reset buy count to 0?')) {
    updateFilter(symbol, filterId, 'buyCount', 0);
  }
};


// Legacy update target (for backward compatibility during migration)
window.updateTarget = async function (symbol, field, value) {
  const target = activeTargets.find(t => t.symbol === symbol);
  if (!target || !target.filters || target.filters.length === 0) return;

  // Update first filter for legacy compatibility
  const filterId = target.filters[0].id;
  await updateFilter(symbol, filterId, field, value);
};

window.removeTarget = async function (symbol) {
  // Confirmation removed by user request

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


// ==================== SETUP MODAL (MANUAL) ====================
window.closeSetup = function () {
  document.getElementById('setup-modal').classList.add('hidden');
}

window.startInitialization = async function () {
  const symbol = document.getElementById('setup-symbol').value.trim();
  const address = document.getElementById('setup-address').value.trim();
  const name = document.getElementById('setup-name').value.trim();
  const image = document.getElementById('setup-image').value.trim();
  const type = document.getElementById('setup-type').value;
  // minRarity removed (Stage 2)

  if (!symbol || !address || !name || !image) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  const btn = document.getElementById('btn-init-start');
  btn.disabled = true;

  document.getElementById('setup-form').classList.add('hidden');
  document.getElementById('setup-progress-container').classList.remove('hidden');

  try {
    const res = await fetch('/api/setup/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        address,
        name,
        image,
        type
      })
    });

    if (!res.ok) throw new Error('Init failed');

  } catch (e) {
    showToast('Failed to start initialization', 'error');
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('setup-progress-container').classList.add('hidden');
    btn.disabled = false;
  }
}

// Add these to SSE handler in connectSSE()
function handleSetupProgress(data) {
  // Check if we are in the flow
  const modal = document.getElementById('setup-modal');
  if (modal.classList.contains('hidden')) return;

  const bar = document.getElementById('setup-progress-fill');
  const text = document.getElementById('setup-status-text');
  const pct = document.getElementById('setup-percent');

  if (bar && text && pct) {
    bar.style.width = `${data.percent}%`;
    text.textContent = data.message;
    pct.textContent = `${data.percent}%`;
  }
}

function handleSetupComplete(data) {
  showToast(`Setup Complete! Found ${data.count} items.`, 'success');
  closeSetup();
  // Automatically open Sync Config for the new collection
  if (data.symbol) {
    openSyncConfig(data.symbol, 'COMMON', '');
  }
  loadConfig();
}

function handleSetupError(data) {
  showToast(`Setup Failed: ${data.error}`, 'error');
  closeSetup();
}

// ==================== TRAIT FILTERS ====================
let currentTraitSymbol = null;
let currentTraitFilterId = null; // NEW: Track which filter we're editing
let currentTraits = {}; // Raw trait data from API { Type: { Value: Count } }
let activeFilters = {}; // Current work-in-progress filters
let currentCategory = null; // Currently selected category
let totalItems = 0; // Total items in collection for percentage calculation

// Open trait filters for a specific filter
window.openTraitFiltersForFilter = async function (symbol, filterId) {
  currentTraitSymbol = symbol;
  currentTraitFilterId = filterId; // if null, we are in Sync Modal mode
  const modal = document.getElementById('trait-modal');

  // Reset state
  modal.classList.remove('hidden');
  document.getElementById('trait-sidebar').innerHTML = '<div style="padding:16px;color:var(--text-muted);">Loading...</div>';
  document.getElementById('trait-options').innerHTML = '';
  document.getElementById('trait-search').value = '';

  if (filterId) {
    // Normal Mode: Get current active filters from the specific target/filter
    const target = activeTargets.find(t => t.symbol === symbol);
    const filter = target?.filters?.find(f => f.id === filterId);
    activeFilters = filter?.traitFilters ? JSON.parse(JSON.stringify(filter.traitFilters)) : {};
  } else {
    // Sync Modal Mode: Use the dedicated global
    activeFilters = JSON.parse(JSON.stringify(syncTraitFilters));
  }

  try {
    const res = await fetch(`/api/traits/${symbol}`);
    const data = await res.json();

    if (data.success) {
      currentTraits = data.traits;
      // Calculate total items (use first category's total as proxy)
      const firstCat = Object.keys(currentTraits)[0];
      if (firstCat) {
        totalItems = Object.values(currentTraits[firstCat]).reduce((a, b) => a + b, 0);
      }
      renderTraitSidebar();
      updateTraitSummary();
    } else {
      document.getElementById('trait-sidebar').innerHTML = '<div style="padding:16px;color:var(--danger);">Error loading traits</div>';
    }
  } catch (e) {
    console.error(e);
    document.getElementById('trait-sidebar').innerHTML = '<div style="padding:16px;color:var(--danger);">Error loading traits</div>';
  }
}

// Legacy: open trait filters for first filter (backward compatibility)
window.openTraitFilters = async function (symbol) {
  const target = activeTargets.find(t => t.symbol === symbol);
  if (target?.filters?.length > 0) {
    await openTraitFiltersForFilter(symbol, target.filters[0].id);
  }
}

function renderTraitSidebar() {
  const sidebar = document.getElementById('trait-sidebar');
  sidebar.innerHTML = '';

  const categories = Object.keys(currentTraits).sort();

  categories.forEach((cat, index) => {
    // Count how many are selected in this category
    const selectedCount = activeFilters[cat] ? activeFilters[cat].length : 0;

    const div = document.createElement('div');
    div.className = 'trait-category';
    div.dataset.category = cat;
    div.innerHTML = `
      <span>${cat}</span>
      <span class="trait-category-count">${selectedCount}</span>
    `;
    div.onclick = () => selectTraitCategory(cat, div);

    // Select first one by default
    if (index === 0) {
      currentCategory = cat;
      setTimeout(() => selectTraitCategory(cat, div), 0);
    }

    sidebar.appendChild(div);
  });
}

function updateCategoryBadge(category) {
  const el = document.querySelector(`.trait-category[data-category="${category}"]`);
  if (el) {
    const count = activeFilters[category] ? activeFilters[category].length : 0;
    el.querySelector('.trait-category-count').textContent = count;
  }
}

function selectTraitCategory(category, element) {
  currentCategory = category;

  // UI Update
  document.querySelectorAll('.trait-category').forEach(el => el.classList.remove('active'));
  element.classList.add('active');

  // Clear search
  document.getElementById('trait-search').value = '';

  // Render Options
  renderTraitOptions(category);
}

function renderTraitOptions(category, searchFilter = '') {
  const container = document.getElementById('trait-options');
  container.innerHTML = '';

  const values = currentTraits[category];
  if (!values) return;

  // Sort by count descending (most common first, like ME)
  let sortedValues = Object.entries(values).sort((a, b) => b[1] - a[1]);

  // Apply search filter
  if (searchFilter) {
    const lowerFilter = searchFilter.toLowerCase();
    sortedValues = sortedValues.filter(([val]) => val.toLowerCase().includes(lowerFilter));
  }

  sortedValues.forEach(([val, count]) => {
    const isSelected = activeFilters[category] && activeFilters[category].includes(val);
    const pct = totalItems > 0 ? ((count / totalItems) * 100).toFixed(2) : '0.00';

    const row = document.createElement('div');
    row.className = `trait-option ${isSelected ? 'selected' : ''}`;
    row.dataset.value = val;
    row.onclick = () => toggleTraitFilter(category, val, row);

    row.innerHTML = `
      <div class="trait-checkbox"></div>
      <div class="trait-option-name">${val}</div>
      <div class="trait-option-stats">
        <span class="trait-option-count">${count}</span>
        <span class="trait-option-pct">●${pct}%</span>
      </div>
    `;

    container.appendChild(row);
  });
}

window.filterTraitOptions = function (query) {
  if (currentCategory) {
    renderTraitOptions(currentCategory, query);
  }
}

window.selectAllVisible = function () {
  if (!currentCategory) return;

  const container = document.getElementById('trait-options');
  const rows = container.querySelectorAll('.trait-option');

  rows.forEach(row => {
    const val = row.dataset.value;
    if (!activeFilters[currentCategory]) activeFilters[currentCategory] = [];
    if (!activeFilters[currentCategory].includes(val)) {
      activeFilters[currentCategory].push(val);
      row.classList.add('selected');
    }
  });

  updateCategoryBadge(currentCategory);
  updateTraitSummary();
}

function toggleTraitFilter(category, value, element) {
  if (!activeFilters[category]) activeFilters[category] = [];

  const idx = activeFilters[category].indexOf(value);
  if (idx > -1) {
    // Remove
    activeFilters[category].splice(idx, 1);
    element.classList.remove('selected');
    if (activeFilters[category].length === 0) delete activeFilters[category];
  } else {
    // Add
    activeFilters[category].push(value);
    element.classList.add('selected');
  }

  updateCategoryBadge(category);
  updateTraitSummary();
}

function updateTraitSummary() {
  const count = Object.values(activeFilters).reduce((acc, arr) => acc + arr.length, 0);
  document.getElementById('trait-summary').textContent = `${count} traits selected`;
}

window.saveTraitFilters = async function () {
  if (!currentTraitSymbol) return;

  const traitFilters = JSON.parse(JSON.stringify(activeFilters));

  if (currentTraitFilterId) {
    // Normal mode: Update specific filter
    await updateFilter(currentTraitSymbol, currentTraitFilterId, 'traitFilters', traitFilters);
  } else {
    // Sync Modal mode: Save to temporary global and update UI
    syncTraitFilters = traitFilters;
    updateSyncTraitSummary();
  }

  closeTraitFilters();
  renderActiveTargets();
}

function updateSyncTraitSummary() {
  const summaryEl = document.getElementById('sync-traits-summary');
  if (!summaryEl) return;

  const categories = Object.keys(syncTraitFilters).filter(cat => syncTraitFilters[cat] && syncTraitFilters[cat].length > 0);
  if (categories.length === 0) {
    summaryEl.innerHTML = 'No attributes selected';
    return;
  }

  let html = '';
  categories.forEach(cat => {
    html += `<div><strong>${cat}:</strong> ${syncTraitFilters[cat].join(', ')}</div>`;
  });
  summaryEl.innerHTML = html;
}

window.openTraitPickerForSync = function () {
  const symbol = document.getElementById('sync-symbol').value;
  if (!symbol) return;
  openTraitFiltersForFilter(symbol, null);
}

window.closeTraitFilters = function () {
  document.getElementById('trait-modal').classList.add('hidden');
  currentTraitSymbol = null;
  currentTraitFilterId = null;
  currentTraits = {};
  activeFilters = {};
  currentCategory = null;
}

// Close on background click
document.getElementById('trait-modal').addEventListener('click', (e) => {
  if (e.target.id === 'trait-modal') window.closeTraitFilters();
});


// ==================== COLLECTION MANAGER ====================
let managerCollections = [];
let syncTraitFilters = {}; // Temporary trait filters for the Sync Modal

window.openCollectionManager = async function () {
  const modal = document.getElementById('manager-modal');
  modal.classList.remove('hidden');

  const tbody = document.getElementById('manager-table-body');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Loading...</td></tr>';

  try {
    const res = await fetch('/api/setup/manager');
    const data = await res.json();
    if (data.success) {
      managerCollections = data.collections;
      renderManagerTable();
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger);">Error loading data</td></tr>';
  }
}

window.closeCollectionManager = function () {
  document.getElementById('manager-modal').classList.add('hidden');
}

function renderManagerTable() {
  const tbody = document.getElementById('manager-table-body');
  tbody.innerHTML = '';

  if (managerCollections.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No collections found</td></tr>';
    return;
  }

  managerCollections.forEach(col => {
    const isSynced = col.isSynced;
    const filters = col.filters || {};
    const rarityBadge = !isSynced
      ? '<span style="color:var(--text-muted);font-size:10px;">-</span>'
      : (filters.minRarity && filters.minRarity !== 'COMMON'
        ? `<span class="inline-rarity-pill ${filters.minRarity.toLowerCase()}">${filters.minRarity}</span>`
        : '<span style="color:var(--text-muted);font-size:10px;">All</span>');

    // Handle traits display and serialization
    let traitsCount = 0;
    let safeTraits = '';

    if (filters.traits && typeof filters.traits === 'object' && !Array.isArray(filters.traits)) {
      // New format: Object
      traitsCount = Object.values(filters.traits).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      safeTraits = JSON.stringify(filters.traits).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    } else {
      // Legacy format: String or Array
      let traitsStr = filters.traits || '';
      if (Array.isArray(traitsStr)) traitsStr = traitsStr.join(',');
      traitsCount = typeof traitsStr === 'string' ? traitsStr.split(',').filter(t => t.trim()).length : 0;
      safeTraits = traitsStr.replace(/'/g, "\\'");
    }

    const traitsBadge = traitsCount > 0
      ? `<span style="font-size:10px;color:var(--accent);">+${traitsCount} traits</span>`
      : '';

    const tr = document.createElement('tr');
    tr.style.cursor = 'default';
    tr.innerHTML = `
      <td>
        <div class="col-info" onclick="openExplorer('${col.symbol}')" style="cursor: pointer;">
          <img src="${col.image}" class="col-thumb" onerror="this.style.display='none'">
          <div style="display:flex;flex-direction:column;">
            <span style="font-weight:600;font-size:12px;">${col.name}</span>
            <span style="font-size:10px;color:var(--text-muted);">${col.symbol}</span>
          </div>
        </div>
      </td>
      <td><span style="font-family:'JetBrains Mono'">${col.count}</span></td>
      <td><span style="font-family:'JetBrains Mono'">${isSynced ? col.countWatched : '-'}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          ${rarityBadge}
          ${traitsBadge}
        </div>
      </td>
      <td>
        <span class="status-badge ${isSynced ? 'synced' : 'unsynced'}">
          ${isSynced ? 'Active' : 'Not Active'}
        </span>
      </td>
      <td>
        <div class="action-btn-group">
          <button class="btn-action-icon" title="Configure & Sync" onclick="openSyncConfig('${col.symbol}', '${filters.minRarity || 'COMMON'}', '${safeTraits}', '${filters.logicMode || 'AND'}')">
            ⚙️ Setup
          </button>
          <button class="btn-action-icon danger" title="Delete" onclick="deleteCollection('${col.symbol}')">
            🗑️
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.deleteCollection = async function (symbol) {
  if (!confirm(`Are you sure you want to delete ${symbol}? This will remove it from Helius and local storage.`)) return;

  try {
    const res = await fetch(`/api/collection/${symbol}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      showToast('Collection deleted', 'success');
      activeTargets = data.targets || [];
      renderActiveTargets();
      updateWatchCount();
      loadConfig(); // Refresh full state to be safe
      setTimeout(openCollectionManager, 500);
    } else {
      showToast('Error deleting', 'error');
    }
  } catch (e) {
    showToast('Error deleting', 'error');
  }
}

// ==================== SYNC CONFIG ====================
window.openSyncConfig = function (symbol, currentRarity, currentTraits, currentLogicMode) {
  const modal = document.getElementById('sync-modal');
  modal.classList.remove('hidden');

  document.getElementById('sync-symbol').value = symbol;
  document.getElementById('sync-modal-title').textContent = `Configure ${symbol}`;
  document.getElementById('sync-rarity').value = currentRarity || 'COMMON';

  // Handle traits: could be JSON string or legacy text
  syncTraitFilters = {};
  if (currentTraits) {
    try {
      if (typeof currentTraits === 'string' && currentTraits.startsWith('{')) {
        syncTraitFilters = JSON.parse(currentTraits);
      } else if (typeof currentTraits === 'object') {
        syncTraitFilters = currentTraits;
      } else if (typeof currentTraits === 'string' && currentTraits.trim().length > 0) {
        // Parse legacy string "K1: V1, K2: V2"
        currentTraits.split(',').forEach(p => {
          if (p.includes(':')) {
            const [k, v] = p.split(':');
            const cat = k.trim();
            if (!syncTraitFilters[cat]) syncTraitFilters[cat] = [];
            syncTraitFilters[cat].push(v.trim());
          }
        });
      }
    } catch (e) { console.warn('Error parsing traits:', e); }
  }
  updateSyncTraitSummary();

  // Set Logic Toggle
  const logicMode = currentLogicMode || 'AND';
  document.querySelectorAll('.logic-toggle-option').forEach(el => {
    if (el.dataset.value === logicMode) el.classList.add('active');
    else el.classList.remove('active');
  });
  updateLogicHelperText(logicMode);
}

window.closeSyncModal = function () {
  document.getElementById('sync-modal').classList.add('hidden');
}

window.startSync = async function () {
  const symbol = document.getElementById('sync-symbol').value;
  const minRarity = document.getElementById('sync-rarity').value;
  const btn = document.getElementById('btn-sync-start');

  btn.disabled = true;
  btn.textContent = 'Syncing...';

  try {
    // Get Logic Mode
    const logicMode = document.querySelector('.logic-toggle-option.active').dataset.value;

    const res = await fetch('/api/setup/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, minRarity, traits: syncTraitFilters, logicMode })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Synced! Watching ${data.count} items.`, 'success');
      closeSyncModal();

      // Refresh manager if open
      if (!document.getElementById('manager-modal').classList.contains('hidden')) {
        openCollectionManager();
      }

      // Refresh sidebar
      loadConfig();
    } else {
      showToast('Sync failed: ' + data.error, 'error');
    }
  } catch (e) {
    showToast('Sync error', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Webhook';
  }
}

// Modal Background Listeners
document.getElementById('manager-modal').addEventListener('click', (e) => {
  if (e.target.id === 'manager-modal') closeCollectionManager();
});
document.getElementById('sync-modal').addEventListener('click', (e) => {
  if (e.target.id === 'sync-modal') closeSyncModal();
});

// Logic Toggle Handler
document.getElementById('logic-toggle').addEventListener('click', (e) => {
  if (e.target.classList.contains('logic-toggle-option')) {
    document.querySelectorAll('.logic-toggle-option').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');
    updateLogicHelperText(e.target.dataset.value);
  }
});

function updateLogicHelperText(mode) {
  const el = document.getElementById('logic-helper-text');
  if (mode === 'OR') {
    el.innerHTML = 'Matches Min Rarity <b>OR</b> Selected Traits (Inclusive).';
  } else {
    el.innerHTML = 'Matches Min Rarity <b>AND</b> Selected Traits (Restrictive).';
  }
}

// ==================== COLLECTION EXPLORER ====================
let explorerData = {
  symbol: '',
  allItems: [],
  filteredItems: [],
  displayCount: 50,
  sortMode: 'stat', // 'stat' or 'add'
  traits: {}, // Full trait map for counts
  activeFilters: {
    search: '',
    traits: {}, // cat -> [val1, val2]
    traitCount: [] // [count1, count2]
  }
};

window.openExplorer = async function (symbol) {
  const modal = document.getElementById('explorer-modal');
  const col = availableCollections.find(c => c.symbol === symbol);
  if (!col) return;

  // Reset State
  explorerData = {
    symbol: symbol,
    allItems: [],
    filteredItems: [],
    displayCount: 50,
    sortMode: 'stat',
    traits: {},
    activeFilters: { search: '', traits: {}, traitCount: [] }
  };

  // UI Feedback
  document.getElementById('explorer-header-image').src = col.image;
  document.getElementById('explorer-header-title').textContent = col.name;
  document.getElementById('explorer-header-count').textContent = 'Loading...';
  document.getElementById('explorer-grid').innerHTML = '<div class="loader">Loading Collection Database...</div>';
  document.getElementById('explorer-search').value = '';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/collection/${symbol}/items`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const items = Object.entries(data.items).map(([mint, meta]) => ({ mint, ...meta }));
    explorerData.allItems = items;

    // Prepare Traits Map
    const traitMap = {};
    const traitCountMap = {};
    items.forEach(item => {
      const attrs = item.attributes || {};
      const activeCount = Object.keys(attrs).length;
      traitCountMap[activeCount] = (traitCountMap[activeCount] || 0) + 1;

      Object.entries(attrs).forEach(([cat, val]) => {
        if (!traitMap[cat]) traitMap[cat] = {};
        traitMap[cat][val] = (traitMap[cat][val] || 0) + 1;
      });
    });

    explorerData.traits = traitMap;
    explorerData.traitItemCounts = traitCountMap;

    renderExplorerSidebar();
    updateExplorerFilters();
    initExplorerInfiniteScroll();

  } catch (e) {
    showToast(`Explorer Error: ${e.message}`, 'error');
    closeExplorer();
  }
};

window.closeExplorer = function () {
  document.getElementById('explorer-modal').classList.add('hidden');
};

function renderExplorerSidebar() {
  const container = document.getElementById('explorer-traits-container');
  const ctList = document.getElementById('explorer-trait-count-list');
  container.innerHTML = '';
  ctList.innerHTML = '';

  // Render Trait Count Filters
  Object.keys(explorerData.traitItemCounts).sort((a, b) => a - b).forEach(count => {
    const div = document.createElement('label');
    div.className = 'explorer-trait-item';
    div.innerHTML = `
            <input type="checkbox" onchange="toggleExplorerTraitCount(${count}, this.checked)">
            <span>${count} Traits</span>
            <span class="explorer-trait-count-badge">${explorerData.traitItemCounts[count]}</span>
        `;
    ctList.appendChild(div);
  });

  // Render Attribute Filters
  Object.entries(explorerData.traits).sort((a, b) => a[0].localeCompare(b[0])).forEach(([cat, vals]) => {
    const catDiv = document.createElement('div');
    catDiv.className = 'explorer-trait-cat';

    const header = document.createElement('div');
    header.className = 'explorer-trait-cat-header';
    header.innerHTML = `<span>${cat.toUpperCase()}</span> <span>▼</span>`;
    header.onclick = () => catDiv.classList.toggle('collapsed');

    const list = document.createElement('div');
    list.className = 'explorer-trait-list';

    Object.entries(vals).sort((a, b) => b[1] - a[1]).forEach(([val, count]) => {
      const item = document.createElement('label');
      item.className = 'explorer-trait-item';
      item.innerHTML = `
                <input type="checkbox" onchange="toggleExplorerTrait('${cat}', '${val}', this.checked)">
                <span>${val}</span>
                <span class="explorer-trait-count-badge">${count}</span>
            `;
      list.appendChild(item);
    });

    catDiv.appendChild(header);
    catDiv.appendChild(list);
    container.appendChild(catDiv);
  });
}

window.toggleExplorerTrait = function (cat, val, checked) {
  if (!explorerData.activeFilters.traits[cat]) explorerData.activeFilters.traits[cat] = [];
  if (checked) explorerData.activeFilters.traits[cat].push(val);
  else explorerData.activeFilters.traits[cat] = explorerData.activeFilters.traits[cat].filter(v => v !== val);

  if (explorerData.activeFilters.traits[cat].length === 0) delete explorerData.activeFilters.traits[cat];
  updateExplorerFilters();
};

window.toggleExplorerTraitCount = function (count, checked) {
  if (checked) explorerData.activeFilters.traitCount.push(count);
  else explorerData.activeFilters.traitCount = explorerData.activeFilters.traitCount.filter(v => v !== count);
  updateExplorerFilters();
};

window.setExplorerSort = function (mode) {
  explorerData.sortMode = mode;
  document.getElementById('sort-stat').classList.toggle('active', mode === 'stat');
  document.getElementById('sort-add').classList.toggle('active', mode === 'add');
  updateExplorerFilters();
};

window.updateExplorerFilters = function () {
  const search = document.getElementById('explorer-search').value.toLowerCase();
  const activeTraits = explorerData.activeFilters.traits;
  const activeCounts = explorerData.activeFilters.traitCount;

  let filtered = explorerData.allItems.filter(item => {
    // Search
    if (search && !(item.name.toLowerCase().includes(search) || item.mint.toLowerCase().includes(search))) return false;

    // Trait Count
    const itemTraitCount = Object.keys(item.attributes || {}).length;
    if (activeCounts.length > 0 && !activeCounts.includes(itemTraitCount)) return false;

    // Attributes
    for (const [cat, vals] of Object.entries(activeTraits)) {
      const itemVal = item.attributes ? item.attributes[cat] : null;
      if (!itemVal || !vals.includes(itemVal)) return false;
    }

    return true;
  });

  // Sort
  const rankKey = explorerData.sortMode === 'stat' ? 'rank_statistical' : 'rank_additive';
  filtered.sort((a, b) => (a[rankKey] || 99999) - (b[rankKey] || 99999));

  explorerData.filteredItems = filtered;
  explorerData.displayCount = 50;

  document.getElementById('explorer-header-count').textContent = `${filtered.length.toLocaleString()} items`;
  renderExplorerGrid();
};

function renderExplorerGrid() {
  const container = document.getElementById('explorer-grid');
  const loadMore = document.getElementById('explorer-load-more');
  const items = explorerData.filteredItems.slice(0, explorerData.displayCount);

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-explorer">No NFTs match your filters.</div>';
    loadMore.classList.add('hidden');
    return;
  }

  const rankKey = explorerData.sortMode === 'stat' ? 'rank_statistical' : 'rank_additive';
  const tierKey = explorerData.sortMode === 'stat' ? 'tier_statistical' : 'tier_additive';

  container.innerHTML = items.map(item => {
    const rank = item[rankKey] || '???';
    const tier = item[tierKey] || 'Common';
    const score = explorerData.sortMode === 'stat' ? item.score_statistical : item.score_additive;
    const scoreDisplay = explorerData.sortMode === 'stat' ? (score * 100).toFixed(4) + '%' : score.toFixed(2);

    // Detect "Hidden Gems" (High rank diff)
    const diff = Math.abs((item.rank_statistical || 0) - (item.rank_additive || 0));
    const isHiddenGem = diff > (explorerData.allItems.length * 0.1); // Top 10% diff

    return `
            <div class="explorer-card ${isHiddenGem ? 'rank-glow-high' : ''}" title="Rank Dist: ${diff}" onclick="window.open('https://magiceden.io/item-details/${item.mint}', '_blank')">
                <div class="explorer-card-img-wrap">
                    <img src="${item.image}" loading="lazy" onerror="this.src='favicon.png'">
                    <div class="explorer-card-badge ${tier.toLowerCase()}">${tier}</div>
                    <span class="explorer-card-rank">#${rank}</span>
                </div>
                <div class="explorer-card-info">
                    <div class="explorer-card-name">${item.name}</div>
                    <div class="explorer-card-address-row">
                        <span class="explorer-card-mint">${item.mint.slice(0, 4)}...${item.mint.slice(-4)}</span>
                        <button class="btn-copy-address" onclick="event.stopPropagation(); copyAddress('${item.mint}')" title="Copy Address">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
  }).join('');

  loadMore.classList.toggle('hidden', explorerData.displayCount >= explorerData.filteredItems.length);
}

window.loadMoreExplorerItems = function () {
  explorerData.displayCount += 50;
  renderExplorerGrid();
};

// --- Infinite Scroll Implementation ---
let explorerObserver = null;
function initExplorerInfiniteScroll() {
  const sentinel = document.getElementById('explorer-load-more');
  if (!sentinel) return;

  if (explorerObserver) explorerObserver.disconnect();

  explorerObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      if (explorerData.displayCount < explorerData.filteredItems.length) {
        window.loadMoreExplorerItems();
      }
    }
  }, {
    root: document.querySelector('.explorer-main'),
    rootMargin: '200px', // Start loading earlier
    threshold: 0.1
  });

  explorerObserver.observe(sentinel);
}

// Close on background click
document.getElementById('explorer-modal').addEventListener('click', (e) => {
  if (e.target.id === 'explorer-modal') closeExplorer();
});

window.copyAddress = function (text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Address copied!', 'success');
  }).catch(err => {
    console.error('Failed to copy: ', err);
  });
};
