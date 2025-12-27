import 'dotenv/config';
import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { CollectionService } from './services/collectionService';
import { TargetCollection, CollectionMetadata, Listing } from './types';
import { decodeBase58 } from './utils/base58';
import bs58 from 'bs58';
import { FloorPriceManager } from './services/floorPriceManager';
import { HistoryService } from './services/historyService';
import { Keypair, Connection, VersionedTransaction, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { JitoService } from './services/jitoService';
import { Agent, setGlobalDispatcher } from 'undici';
import { logger } from './utils/logger';

// 1. GLOBAL HTTP OPTIMIZATION
// This forces ALL fetch calls in the app to share this persistent connection pool.
const agent = new Agent({
  connect: {
    keepAlive: true,
    timeout: 60000
  },
  pipelining: 1,
  connections: 100
});
setGlobalDispatcher(agent);

// Now your existing 'startConnectionWarmer' will actually warm the pool 
// that 'executeBuyTransaction' uses.
import { BlockhashManager } from './services/blockhashManager';
import { ConfirmationService } from './services/confirmationService';
import { BalanceMonitor } from './services/balanceMonitor';
import { SetupManager } from './services/setupManager';

// Concurrency Control
const ActiveMints = new Set<string>();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🛡️ SECURITY MIDDLEWARE (Dual-Gate)
// ==========================================
app.use((req, res, next) => {
  // 1. High-Speed Gate: Helius Webhooks
  if (req.path === '/webhook') {
    const heliusSecret = process.env.HELIUS_AUTH_SECRET;

    // If no secret is set in .env, warn but allow (or fail safe: block)
    // Here we fail safe: if logic demands security, we block if not configured.
    // But for ease of setup, if env is missing, we might skip. 
    // SAFEST: Block if secret exists and doesn't match.
    if (heliusSecret) {
      const authHeader = req.headers['authorization'];
      if (authHeader !== heliusSecret) {
        logger.warn(`Blocked unauthorized webhook request from ${req.ip}`);
        return res.status(403).send('Forbidden');
      }
    }
    return next(); // Fast pass for valid webhooks
  }

  // 2. Restricted Gate: UI & API (Basic Auth)
  const authUser = process.env.AUTH_USER;
  const authPass = process.env.AUTH_PASSWORD;

  if (authUser && authPass) {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === authUser && password === authPass) {
      return next(); // Access Granted
    }

    // Force Browser Login Popup
    res.set('WWW-Authenticate', 'Basic realm="NFT Sniper PRO Access"');
    return res.status(401).send('Authentication required.');
  }

  // If no auth configured in .env, proceed (Development mode)
  next();
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const RPC_URL = process.env.RPC_URL || '';
const PUBLIC_RPC_URL = process.env.PUBLIC_RPC_URL || '';

// User guaranteed these are not empty, but we keep the warn just in case
if (!RPC_URL) {
  logger.warn('RPC_URL is not defined in .env. Some features may not work.');
}

const configManager = new ConfigManager();
const cache = new ListingCache(60); // Cache for 60 minutes
const collectionService = new CollectionService();
const broadcaster = new SSEBroadcaster();
const jitoService = new JitoService(RPC_URL, PUBLIC_RPC_URL);

// Start Jito Tip Warmer (Always Active)
if (process.env.BURNER_WALLET_PRIVATE_KEY) {
  try {
    const BURNER_KEY_RAW = process.env.BURNER_WALLET_PRIVATE_KEY;
    let secretKey: Uint8Array;
    if (BURNER_KEY_RAW.trim().startsWith('[')) secretKey = Uint8Array.from(JSON.parse(BURNER_KEY_RAW));
    else secretKey = decodeBase58(BURNER_KEY_RAW);
    const burnerWallet = Keypair.fromSecretKey(secretKey);

    // Use env priority fee or default 0.0005 SOL
    const tip = parseInt(process.env.PRIORITY_FEE_LAMPORTS || '500000', 10);
    jitoService.startTipWarmer(burnerWallet, tip);
  } catch (e) {
    console.warn('[Server] Failed to start Jito Tip Warmer:', e);
  }
}

// Start Connection Warmer (ME API)
startConnectionWarmer();

const blockhashManager = new BlockhashManager(RPC_URL, PUBLIC_RPC_URL);
const confirmationService = new ConfirmationService(RPC_URL, broadcaster, PUBLIC_RPC_URL);
const balanceMonitor = new BalanceMonitor(RPC_URL, broadcaster, PUBLIC_RPC_URL);
const setupManager = new SetupManager(collectionService, broadcaster);

// SSE endpoint
app.get('/api/listings-stream', (req, res) => {
  broadcaster.addClient(res);
});

// Get config
app.get('/api/config', (req, res) => {
  const defaultPrioLamports = process.env.PRIORITY_FEE_LAMPORTS || '500000';
  const defaultPrioSol = parseInt(defaultPrioLamports) / 1_000_000_000;

  res.json({
    targets: configManager.getTargets(),
    collections: collectionService.getCollections(),
    balance: balanceMonitor.getBalance(),
    defaultPriorityFee: defaultPrioSol
  });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.getCacheSize(),
    connectedClients: broadcaster.getClientCount(),
    activeTargets: configManager.getTargets().length,
    balance: balanceMonitor.getBalance(),
    walletAddress: balanceMonitor.getWalletAddress()
  });
});

app.post('/api/balance/refresh', async (req, res) => {
  await balanceMonitor.refreshBalance();
  res.json({ success: true, balance: balanceMonitor.getBalance() });
});

// Add target collection (with first filter)
app.post('/api/target', async (req, res) => {
  const { symbol, priceMax, minRarity, maxRank, rarityType, autoBuy, buyLimit, traitFilters, filters } = req.body;

  // Support both old format (single filter params) and new format (filters array)
  if (filters && Array.isArray(filters)) {
    // New format: full target with filters array
    const target: TargetCollection = { symbol, filters };
    await configManager.addTarget(target);
    res.json({ success: true, targets: configManager.getTargets() });
    return;
  }

  // Old format: single filter params - convert to new format
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required field: symbol' });
  }

  const target: TargetCollection = {
    symbol: symbol,
    filters: [{
      id: 'f_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      priceMax: Number(priceMax) || 1000,
      maxRank: maxRank ? Number(maxRank) : undefined,
      minRarity: minRarity || 'COMMON',
      rarityType: rarityType || 'statistical',
      traitFilters: traitFilters,
      autoBuy: autoBuy === true,
      buyLimit: buyLimit ? Number(buyLimit) : undefined,
      buyCount: 0
    }]
  };

  await configManager.addTarget(target);

  // SMART RESTORE: If collection exists but is unsynced (removed from Helius), try to re-sync using saved filters
  const colMeta = collectionService.getCollection(symbol);
  if (colMeta && !colMeta.isSynced && colMeta.filters && colMeta.filters.minRarity) {
    console.log(`[SmartRestore] Restoring Helius sync for ${symbol} using saved filters...`);
    // Run in background to not block UI? Or await to ensure it works? 
    // Await is safer to ensure webhooks are ready before we say "Success"
    try {
      await setupManager.syncCollection(symbol, colMeta.filters.minRarity, colMeta.filters.traits, colMeta.filters.logicMode || 'AND');
      console.log(`[SmartRestore] ${symbol} re-synced successfully.`);
    } catch (e) {
      console.error(`[SmartRestore] Failed to re-sync ${symbol}:`, e);
      // We still return success for the "Watch" action, but maybe include a warning?
    }
  }

  res.json({ success: true, targets: configManager.getTargets() });
});

// Add filter to existing collection
app.post('/api/target/:symbol/filter', async (req, res) => {
  const { symbol } = req.params;
  const { priceMax, maxRank, minRarity, rarityType, autoBuy, buyLimit, traitFilters, priorityFee } = req.body;

  const filter = await configManager.addFilter(symbol, {
    priceMax: Number(priceMax) || 1000,
    maxRank: maxRank ? Number(maxRank) : undefined,
    minRarity: minRarity || 'COMMON',
    rarityType: rarityType || 'statistical',
    traitFilters,
    priorityFee: priorityFee ? Number(priorityFee) : undefined,
    autoBuy: autoBuy === true,
    buyLimit: buyLimit ? Number(buyLimit) : undefined,
    buyCount: 0
  });

  if (!filter) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  res.json({ success: true, filter, targets: configManager.getTargets() });
});

// Update specific filter
app.put('/api/target/:symbol/filter/:filterId', async (req, res) => {
  const { symbol, filterId } = req.params;
  const updates = req.body;

  // Convert numeric fields
  if (updates.priceMax !== undefined) updates.priceMax = Number(updates.priceMax);
  if (updates.maxRank !== undefined) updates.maxRank = updates.maxRank ? Number(updates.maxRank) : undefined;
  if (updates.priorityFee !== undefined) updates.priorityFee = updates.priorityFee ? Number(updates.priorityFee) : undefined;
  if (updates.buyLimit !== undefined) updates.buyLimit = updates.buyLimit ? Number(updates.buyLimit) : undefined;
  if (updates.buyCount !== undefined) updates.buyCount = updates.buyCount ? Number(updates.buyCount) : 0;

  const success = await configManager.updateFilter(symbol, filterId, updates);

  if (!success) {
    return res.status(404).json({ error: 'Filter not found' });
  }

  res.json({ success: true, targets: configManager.getTargets() });
  broadcaster.broadcastMessage('config_update', configManager.getTargets());
});

// Remove specific filter
app.delete('/api/target/:symbol/filter/:filterId', async (req, res) => {
  const { symbol, filterId } = req.params;
  const result = await configManager.removeFilter(symbol, filterId);

  if (!result.removed) {
    return res.status(404).json({ error: 'Filter not found' });
  }

  res.json({
    success: true,
    collectionRemoved: result.collectionRemoved,
    targets: configManager.getTargets()
  });
});

// Clear feed history
app.post('/api/feed/clear', (req, res) => {
  broadcaster.clearHistory();
  res.json({ success: true, message: 'Feed history cleared' });
});

// Remove entire target collection
// Stop Watching (Remove from Webhook, keep local data)
app.delete('/api/target/:symbol', async (req, res) => {
  const { symbol } = req.params;
  await configManager.removeTarget(symbol);
  await setupManager.markAsUnsynced(symbol);
  res.json({ success: true, targets: configManager.getTargets() });
});

// Full Delete (Remove from Webhook + Delete local data)
app.delete('/api/collection/:symbol', async (req, res) => {
  const { symbol } = req.params;
  await configManager.removeTarget(symbol);
  await setupManager.deleteCollectionData(symbol); // Deletes files
  res.json({ success: true, targets: configManager.getTargets() });
});

// Toggle collapse state
app.put('/api/target/:symbol/collapse', async (req, res) => {
  const { symbol } = req.params;
  const { collapsed } = req.body;

  const success = await configManager.setTargetCollapsed(symbol, collapsed);
  if (!success) {
    return res.status(404).json({ error: 'Target not found' });
  }

  res.json({ success: true });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.getCacheSize(),
    connectedClients: broadcaster.getClientCount(),
    activeTargets: configManager.getTargets().length
  });
});



// Setup: Init
// Setup: Manager Stats
app.get('/api/setup/manager', (req, res) => {
  const stats = setupManager.getManagerStats();
  res.json({ success: true, collections: stats });
});

// Setup: Init (Download only)
app.post('/api/setup/init', async (req, res) => {
  const { symbol, address, name, image, type } = req.body;
  if (!symbol || !address) return res.status(400).json({ error: 'Missing required fields' });

  // Fire and forget - client listens to SSE
  setupManager.downloadAndAnalyze(symbol, address, name, image, type || 'standard');
  res.json({ success: true, message: 'Download started' });
});

// Setup: Sync (Update Webhook)
app.post('/api/setup/sync', async (req, res) => {
  const { symbol, minRarity, traits, logicMode } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    const result = await setupManager.syncCollection(symbol, minRarity || 'COMMON', traits || '', logicMode || 'AND');

    // Auto-add to sidebar if not already present
    const existing = configManager.getTargets().find(t => t.symbol === symbol);
    if (!existing) {
      console.log(`[AutoAdd] Adding ${symbol} to sidebar after sync...`);
      await configManager.addTarget({
        symbol,
        filters: [{
          id: 'default',
          priceMax: 1000,
          minRarity: 'COMMON',
          rarityType: "statistical",
          //traitFilters: typeof traits === 'object' ? traits : undefined, // Rudimentary trait mapping
          autoBuy: false
        }]
      });
    }

    res.json({ success: true, count: result.count });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Get Traits for Collection
app.get('/api/traits/:symbol', (req, res) => {
  const { symbol } = req.params;
  const traits = collectionService.getTraits(symbol);
  res.json({ success: true, traits });
});

// Get Full Collection Database (Explorer)
app.get('/api/collection/:symbol/items', (req, res) => {
  const { symbol } = req.params;
  const db = collectionService.getFullDatabase(symbol);
  if (!db) return res.status(404).json({ error: 'Collection database not found' });
  res.json({ success: true, items: db });
});

// Webhook Endpoint for Helius
app.post('/webhook', (req, res) => {
  // Acknowledge immediately
  res.status(200).send('OK');

  try {
    const notifications = req.body;
    if (!Array.isArray(notifications)) return;

    const targets = configManager.getTargets();
    if (targets.length === 0) return;

    // Rarity Mapping for comparison
    const rarityOrder: Record<string, number> = {
      'COMMON': 0,
      'UNCOMMON': 1,
      'RARE': 2,
      'EPIC': 3,
      'LEGENDARY': 4,
      'MYTHIC': 5
    };

    for (const event of notifications) {
      if (event.type === 'NFT_LISTING') {
        const eventData = event.events.nft;
        const mint = eventData.nfts[0].mint;
        const priceLamports = eventData.amount;
        const priceSol = priceLamports / 1_000_000_000;

        if (priceSol <= 0) continue;

        // Latency Check
        /*if (event.timestamp) {
          const latency = Date.now() - (event.timestamp * 1000);
          console.log(`[Latency] ${latency}ms delay from Chain to Localhost (Type: ${event.type})`);
        }*/

        /*/ Internal Processing Check
        const start = process.hrtime();*/

        const seller = eventData.seller;
        let auctionHouse = '';
        const expiry = eventData.expiration;

        // Extract Auction House from Instructions if M2
        if (event.instructions) {
          const ME_M2_PROGRAM = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K';
          const CANONICAL_AH = 'E8cU1WiRWjanGxmn96ewBgk9vPTcL6AEZ1t6F6fkgUWe';

          const m2Ix = event.instructions.find((ix: any) => ix.programId === ME_M2_PROGRAM);
          if (m2Ix && m2Ix.accounts) {
            // 1. Prefer Canonical AH if present in accounts
            if (m2Ix.accounts.includes(CANONICAL_AH)) {
              auctionHouse = CANONICAL_AH;
            }
            // 2. Fallback to index 6 (observed in logs)
            else if (m2Ix.accounts.length > 6) {
              auctionHouse = m2Ix.accounts[6];
            }
            // 3. Fallback to index 1 (original logic, likely wrong but kept as last resort)
            else if (m2Ix.accounts.length > 1) {
              auctionHouse = m2Ix.accounts[1];
            }
          }
        }

        // Check against active targets (now with nested filters)
        for (const target of targets) {
          const itemMeta = collectionService.getItem(target.symbol, mint);

          if (!itemMeta) continue;

          // Get item rarity info once (needed for filter checks)
          const itemRankStat = itemMeta.rank_statistical || itemMeta.rank || 0;
          const itemRankAdd = itemMeta.rank_additive || itemMeta.rank || 0;
          const itemTierStat = itemMeta.tier_statistical || itemMeta.tier || 'COMMON';
          const itemTierAdd = itemMeta.tier_additive || itemMeta.tier || 'COMMON';

          let matchesAnyFilter = false;
          let shouldAutoBuy = false;

          // We'll use these for the listing object, prioritizing the first match's preference or defaulting to statistical
          let itemRankMax = itemRankStat;
          let itemTierMax = itemTierStat;

          let maxPriorityFee: number | undefined = undefined;
          let matchingFilterId: string | undefined = undefined;

          // Check each filter
          for (const filter of target.filters) {
            // Price Check
            if (priceSol > filter.priceMax) continue;

            // Rarity Check
            const rarityType = filter.rarityType || 'statistical';
            let itemTier = rarityType === 'additive' ? itemTierAdd : itemTierStat;
            let itemRank = rarityType === 'additive' ? itemRankAdd : itemRankStat;

            // Max Rank Check (if set)
            if (filter.maxRank && itemRank > filter.maxRank) continue;

            // Min Rarity Tier Check (if set)
            if (filter.minRarity && itemTier) {
              const itemRarityVal = rarityOrder[itemTier.toUpperCase()] || 0;
              const targetRarityVal = rarityOrder[filter.minRarity.toUpperCase()] || 0;
              if (itemRarityVal < targetRarityVal) continue;
            }

            // Trait Filtering
            if (filter.traitFilters) {
              let matchesTraits = true;
              for (const [traitType, allowedValues] of Object.entries(filter.traitFilters)) {
                const traitKey = traitType.toLowerCase();
                // Treat missing traits as "none"
                const itemValue = itemMeta.attributes ? (itemMeta.attributes[traitKey] || 'none') : 'none';

                const allowedArr = allowedValues as string[];
                const itemValLower = itemValue.toLowerCase();
                const allowedLower = allowedArr.map((v: string) => v.toLowerCase());

                if (!allowedLower.includes(itemValLower)) {
                  matchesTraits = false;
                  break;
                }
              }
              if (!matchesTraits) continue;
            }

            // All checks passed - this filter matches!
            matchesAnyFilter = true;

            // Set Display Rank based on the filter that matched
            if (filter.rarityType === 'additive') {
              itemRankMax = itemRankAdd;
              itemTierMax = itemTierAdd;
            } else {
              itemRankMax = itemRankStat;
              itemTierMax = itemTierStat;
            }

            // Upgrade to AutoBuy if this specific filter has it enabled
            if (filter.autoBuy) {
              // NEW: Check Limit
              const limit = filter.buyLimit || 0;
              const count = filter.buyCount || 0;
              if (limit > 0 && count >= limit) {
                // console.log(`[Limit] Filter ${filter.id} for ${target.symbol} reached limit (${count}/${limit}). Skipping auto-buy.`);
                continue;
              }

              shouldAutoBuy = true;
              if (!matchingFilterId) matchingFilterId = filter.id;

              // Capture max priority fee from any matching auto-buy filter
              if (filter.priorityFee) {
                if (maxPriorityFee === undefined || filter.priorityFee > maxPriorityFee) {
                  maxPriorityFee = filter.priorityFee;
                }
              }
            }
          }

          if (matchesAnyFilter) {
            const listing: Listing = {
              source: event.source || 'Unknown',
              mint: mint,
              price: priceSol,
              listingUrl: `https://magiceden.io/item-details/${mint}`,
              timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
              seller: seller,
              name: itemMeta.name,
              symbol: target.symbol,
              imageUrl: itemMeta.image,
              rank: itemRankMax, // Default to statistical for display if mixed
              rarity: itemTierMax,
              rank_additive: itemMeta.rank_additive,
              tier_additive: itemMeta.tier_additive,
              score_additive: itemMeta.score_statistical,
              rank_statistical: itemMeta.rank_statistical,
              tier_statistical: itemMeta.tier_statistical,
              score_statistical: itemMeta.score_statistical,
              auctionHouse: auctionHouse,
              sellerExpiry: expiry
            };

            broadcaster.broadcastListing(listing);

            if (shouldAutoBuy) {
              logger.info(`AutoBuy Triggered for ${itemMeta.name} @ ${priceSol} SOL. Sending...`);
              executeBuyTransaction(mint, priceSol, seller, undefined, auctionHouse, expiry, maxPriorityFee)
                .then(async sig => {
                  if (sig === 'SKIPPED_DUPLICATE') return;
                  logger.info(`AutoBuy CONFIRMED! Sig: ${sig}`);
                  if (matchingFilterId) {
                    await configManager.incrementBuyCount(target.symbol, matchingFilterId);
                    broadcaster.broadcastMessage('config_update', configManager.getTargets());
                  }
                })
                .catch(err => {
                  if (err === 'SKIPPED_DUPLICATE') return;
                  logger.error(`AutoBuy FAILED: ${err.message}`)
                });
            }
          }
        }

        /*const end = process.hrtime(start);
        const procTime = (end[0] * 1000 + end[1] / 1e6).toFixed(3);
        console.log(`[Processing] Logic took ${procTime}ms`);*/
      } else if ((event.type === 'UNKNOWN' || event.type === 'TRANSACTION') && event.accountData) {

        // Latency Check for UNKNOWN/RAW events
        /*if (event.timestamp) {
          const latency = Date.now() - (event.timestamp * 1000);
          console.log(`[Latency] (${event.type}) ${latency}ms delay from Chain to Localhost`);
        }*/

        /*/ Internal Processing Check
        const start = process.hrtime();*/

        // Handle UNKNOWN events (often unparsed listings)
        let price = 0;
        let isMagicEdenListing = false;

        // Try to parse Magic Eden V2 instruction
        if (event.instructions) {
          const ME_V2_PROGRAM_ID = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K';
          const SELL_DISCRIMINATOR = '1ff3f73b8653a5da'; // First 8 bytes of sighash

          for (const ix of event.instructions) {
            if (ix.programId === ME_V2_PROGRAM_ID && ix.data) {
              try {
                const decodedData = decodeBase58(ix.data);
                const hexData = Buffer.from(decodedData).toString('hex');

                if (hexData.startsWith(SELL_DISCRIMINATOR)) {
                  // Next 8 bytes are price (little endian uint64)
                  // Discriminator is 8 bytes (16 hex chars)
                  // Price starts at index 16
                  const priceHex = hexData.substring(16, 32);
                  if (priceHex.length === 16) {
                    // Convert little endian hex to number
                    // e.g. 20beec1b00000000 -> 1becbe20 -> 468483616
                    const buffer = Buffer.from(priceHex, 'hex');
                    const priceLamports = Number(buffer.readBigUInt64LE(0));
                    price = priceLamports / 1_000_000_000;
                    isMagicEdenListing = true;
                    // console.log(`[Webhook] Decoded ME V2 Price: ${price} SOL`);
                    break;
                  }
                }
              } catch (e) {
                console.error('Error decoding instruction data:', e);
              }
            }
          }
        }

        for (const accountInfo of event.accountData) {
          const potentialMint = accountInfo.account;

          for (const target of targets) {
            const collectionSymbol = target.symbol;
            const itemMeta = collectionService.getItem(collectionSymbol, potentialMint);

            if (itemMeta) {
              // Get item rarity info once
              const itemRankStat = itemMeta.rank_statistical || itemMeta.rank || 0;
              const itemRankAdd = itemMeta.rank_additive || itemMeta.rank || 0;
              const itemTierStat = itemMeta.tier_statistical || itemMeta.tier || 'COMMON';
              const itemTierAdd = itemMeta.tier_additive || itemMeta.tier || 'COMMON';

              let matchesAnyFilter = false;
              let shouldAutoBuy = false;

              // We'll use these for the listing object
              let itemRankMax = itemRankStat;
              let itemTierMax = itemTierStat;
              let maxPriorityFee: number | undefined = undefined;
              let matchingFilterId: string | undefined = undefined;

              // Check each filter
              for (const filter of target.filters) {
                // Rarity Check
                const rarityType = filter.rarityType || 'statistical';
                let itemTier = rarityType === 'additive' ? itemTierAdd : itemTierStat;
                let itemRank = rarityType === 'additive' ? itemRankAdd : itemRankStat;

                // Max Rank Check
                if (filter.maxRank && itemRank > filter.maxRank) continue;

                // Min Rarity Tier Check
                if (filter.minRarity) {
                  const itemRarityVal = rarityOrder[itemTier.toUpperCase()] || 0;
                  const targetRarityVal = rarityOrder[filter.minRarity.toUpperCase()] || 0;
                  if (itemRarityVal < targetRarityVal) continue;
                }

                // Trait Filtering
                if (filter.traitFilters) {
                  let matchesTraits = true;
                  for (const [traitType, allowedValues] of Object.entries(filter.traitFilters)) {
                    const traitKey = traitType.toLowerCase();
                    const itemValue = itemMeta.attributes ? itemMeta.attributes[traitKey] : undefined;

                    if (!itemValue) {
                      matchesTraits = false;
                      break;
                    }

                    const allowedArr = allowedValues as string[];
                    const itemValLower = itemValue.toLowerCase();
                    const allowedLower = allowedArr.map((v: string) => v.toLowerCase());
                    if (!allowedLower.includes(itemValLower)) {
                      matchesTraits = false;
                      break;
                    }
                  }
                  if (!matchesTraits) continue;
                }

                // Price Check
                if (price <= 0 || price > filter.priceMax) continue;

                // Filter matched!
                matchesAnyFilter = true;
                if (filter.autoBuy) {
                  const limit = filter.buyLimit || 0;
                  const count = filter.buyCount || 0;
                  if (limit > 0 && count >= limit) continue;

                  shouldAutoBuy = true;
                  if (!matchingFilterId) matchingFilterId = filter.id;

                  // Capture max priority fee
                  if (filter.priorityFee) {
                    if (maxPriorityFee === undefined || filter.priorityFee > maxPriorityFee) {
                      maxPriorityFee = filter.priorityFee;
                    }
                  }
                }
              }

              if (matchesAnyFilter) {
                const listing: Listing = {
                  source: isMagicEdenListing ? 'MagicEden' : (event.source || 'Unknown'),
                  mint: potentialMint,
                  price: price,
                  listingUrl: `https://magiceden.io/item-details/${potentialMint}`,
                  timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
                  seller: event.feePayer || 'Unknown',
                  name: itemMeta.name,
                  symbol: collectionSymbol,
                  imageUrl: itemMeta.image,
                  rank: itemRankMax, // Using captured max values
                  rarity: itemTierMax,
                  rank_additive: itemMeta.rank_additive,
                  tier_additive: itemMeta.tier_additive,
                  score_additive: itemMeta.score_statistical,
                  rank_statistical: itemMeta.rank_statistical,
                  tier_statistical: itemMeta.tier_statistical,
                  score_statistical: itemMeta.score_statistical
                };

                broadcaster.broadcastListing(listing);

                // Auto Buy (per filter)
                if (shouldAutoBuy) {
                  logger.info(`AutoBuy Triggered for ${itemMeta.name} @ ${price} SOL (via UNKNOWN parsing). Sending...`);
                  executeBuyTransaction(potentialMint, price, listing.seller || 'Unknown', undefined, undefined, 0, maxPriorityFee, true)
                    .then(async sig => {
                      if (sig === 'SKIPPED_DUPLICATE') return;
                      logger.info(`AutoBuy CONFIRMED! Sig: ${sig}`);
                      if (matchingFilterId) {
                        await configManager.incrementBuyCount(collectionSymbol, matchingFilterId);
                        broadcaster.broadcastMessage('config_update', configManager.getTargets());
                      }
                    })
                    .catch(err => {
                      if (err === 'SKIPPED_DUPLICATE') return;
                      logger.error(`AutoBuy FAILED: ${err.message}`)
                    });
                }
                break; // Found matching listing, break potentialMint loop (since mint found)
              }
              break; // Found item in collection
            }
          }
        }

        /*const end = process.hrtime(start);
        const procTime = (end[0] * 1000 + end[1] / 1e6).toFixed(3);
        console.log(`[Processing] (UNKNOWN) Logic took ${procTime}ms`);*/
      } else if (event.version !== undefined || event.transaction) {
        // Handle RAW Helius/RPC Transaction
        //const latency = Date.now() - ((event.blockTime || event.timestamp || (Date.now() / 1000)) * 1000);
        //console.log(`[Latency] (RAW) ${latency.toFixed(0)}ms`);

        // Normalization
        let instructions: any[] = [];
        let accountKeys: string[] = [];

        try {
          // 1. Build Account List
          // Check if Legacy or V0
          const msg = event.transaction.message;
          const meta = event.meta;

          if (Array.isArray(msg.accountKeys)) {
            // Likely Legacy or simplified
            accountKeys = msg.accountKeys.map((k: any) => typeof k === 'string' ? k : k.pubkey);
          } else if (msg.staticAccountKeys) {
            // V0
            accountKeys = [...msg.staticAccountKeys];
            if (meta && meta.loadedAddresses) {
              accountKeys.push(...(meta.loadedAddresses.writable || []));
              accountKeys.push(...(meta.loadedAddresses.readonly || []));
            }
          }

          // 2. Normalize Instructions
          const rawIxs = msg.instructions || msg.compiledInstructions || [];
          instructions = rawIxs.map((ix: any) => {
            const programId = accountKeys[ix.programIdIndex];
            const data = ix.data; // usually base58
            const accounts = ix.accounts || ix.accountKeyIndexes?.map((idx: number) => accountKeys[idx]);
            return { programId, data, accounts };
          });

          //console.log('[RawParser] Programs:', instructions.map(ix => ix.programId));

        } catch (e) {
          console.error('[RawParser] Warning: Could not parse raw tx structure', e);
          continue;
        }

        // Reuse parsing logic
        const ME_V2_PROGRAM_ID = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K';
        //const SELL_DISCRIMINATOR = '1ff3f73b8653a5da';

        let price = 0;
        let isMagicEdenListing = false;
        let seller = '';
        let expiry = 0;
        let auctionHouse = '';

        for (const ix of instructions) {
          if (ix.programId === ME_V2_PROGRAM_ID && ix.data) {
            try {
              const decodedData = decodeBase58(ix.data);
              const hexData = Buffer.from(decodedData).toString('hex');

              /*console.log(`[RawParser] Found ME Instruction! Data: ${ix.data}`);
              console.log(`[RawParser] Hex: ${hexData}`);*/

              const SELL_DISC_1 = '1ff3f73b8653a5da';
              const SELL_DISC_2 = '3a32ac6fa697165e'; // New one

              if (hexData.startsWith(SELL_DISC_1) || hexData.startsWith(SELL_DISC_2)) {
                const priceHex = hexData.substring(16, 32);
                if (priceHex.length === 16) {
                  const buffer = Buffer.from(priceHex, 'hex');
                  price = Number(buffer.readBigUInt64LE(0)) / 1_000_000_000;
                  isMagicEdenListing = true;

                  // Try to find seller in accounts (Signer / Index 0 usually)
                  if (ix.accounts && ix.accounts.length > 0) {
                    seller = ix.accounts[0]; // First account in Sell instruction is usually seller/signer
                  }

                  // Fallback: If seller not found in instruction, use fee payer (usually logic is: seller pays fee to list/update)
                  if (!seller && event.feePayer) {
                    seller = event.feePayer;
                  }

                  // Extra Fallback: Check accountKeys for signer if available in legacy
                  if (!seller && accountKeys.length > 0) {
                    seller = accountKeys[0];
                  }

                  // Extract Auction House - Check instruction first, then global keys
                  const CANONICAL_AH = 'E8cU1WiRWjanGxmn96ewBgk9vPTcL6AEZ1t6F6fkgUWe';
                  if (ix.accounts && ix.accounts.includes(CANONICAL_AH)) {
                    auctionHouse = CANONICAL_AH;
                  } else if (accountKeys.includes(CANONICAL_AH)) {
                    auctionHouse = CANONICAL_AH;
                  }

                  /*/ LOGGING MATCH ATTEMPTS
                  console.log(`[RawParser] Listing Confirmed for ${price} SOL. Checking match against ${targets.length} targets...`);*/

                  // Expiry
                  const expiryHex = hexData.substring(32, 48);
                  if (expiryHex.length === 16) {
                    const buf = Buffer.from(expiryHex, 'hex');
                    const val = Number(buf.readBigInt64LE(0));
                    expiry = val === -1 ? 0 : val;
                  }
                  break;
                }
              }
            } catch (e) { }
          }
        }

        if (isMagicEdenListing && price > 0) {
          // Find Mint (Account that is NOT seller, NOT program, NOT system...)
          // Easier: Check all accounts against our watchlist
          for (const potentialMint of accountKeys) {
            for (const target of targets) {
              const itemMeta = collectionService.getItem(target.symbol, potentialMint);

              if (itemMeta) {
                //console.log(`[RawParser] MATCH FOUND! ${itemMeta.name} is in ${target.symbol}`);

                // Get item rarity info once
                const itemRankStat = itemMeta.rank_statistical || itemMeta.rank || 0;
                const itemRankAdd = itemMeta.rank_additive || itemMeta.rank || 0;
                const itemTierStat = itemMeta.tier_statistical || itemMeta.tier || 'COMMON';
                const itemTierAdd = itemMeta.tier_additive || itemMeta.tier || 'COMMON';

                let matchesAnyFilter = false;
                let shouldAutoBuy = false;

                // We'll use these for the listing object
                let itemRankMax = itemRankStat;
                let itemTierMax = itemTierStat;

                // Check each filter
                let maxPriorityFee: number | undefined = undefined;
                let matchingFilterId: string | undefined = undefined;

                for (const filter of target.filters) {
                  // Price Check
                  if (price > filter.priceMax) continue;

                  // Rarity Check
                  const rarityType = filter.rarityType || 'statistical';
                  let itemTier = rarityType === 'additive' ? itemTierAdd : itemTierStat;
                  let itemRank = rarityType === 'additive' ? itemRankAdd : itemRankStat;

                  // Max Rank Check
                  if (filter.maxRank && itemRank > filter.maxRank) continue;

                  // Min Rarity Tier Check
                  if (filter.minRarity) {
                    const itemRarityVal = rarityOrder[itemTier.toUpperCase()] || 0;
                    const targetRarityVal = rarityOrder[filter.minRarity.toUpperCase()] || 0;
                    if (itemRarityVal < targetRarityVal) continue;
                  }

                  // Trait Filtering
                  if (filter.traitFilters) {
                    let matchesTraits = true;
                    for (const [traitType, allowedValues] of Object.entries(filter.traitFilters)) {
                      const traitKey = traitType.toLowerCase();
                      // Treat missing traits as "none"
                      const itemValue = itemMeta.attributes ? (itemMeta.attributes[traitKey] || 'none') : 'none';

                      const allowedArr = allowedValues as string[];
                      const itemValLower = itemValue.toLowerCase();
                      const allowedLower = allowedArr.map((v: string) => v.toLowerCase());

                      if (!allowedLower.includes(itemValLower)) {
                        matchesTraits = false;
                        break;
                      }
                    }
                    if (!matchesTraits) continue;
                  }

                  // Filter matched!
                  matchesAnyFilter = true;

                  // Set Display Rank based on the filter that matched
                  if (filter.rarityType === 'additive') {
                    itemRankMax = itemRankAdd;
                    itemTierMax = itemTierAdd;
                  } else {
                    itemRankMax = itemRankStat;
                    itemTierMax = itemTierStat;
                  }

                  if (filter.autoBuy) {
                    const limit = filter.buyLimit || 0;
                    const count = filter.buyCount || 0;
                    if (limit > 0 && count >= limit) continue;

                    shouldAutoBuy = true;
                    if (!matchingFilterId) matchingFilterId = filter.id;

                    // Capture max priority fee from any matching auto-buy filter
                    if (filter.priorityFee) {
                      if (maxPriorityFee === undefined || filter.priorityFee > maxPriorityFee) {
                        maxPriorityFee = filter.priorityFee;
                      }
                    }
                  }
                }

                if (matchesAnyFilter) {
                  const listing: Listing = {
                    source: 'MagicEden',
                    mint: potentialMint,
                    price: price,
                    listingUrl: `https://magiceden.io/item-details/${potentialMint}`,
                    timestamp: (event.blockTime || Date.now() / 1000) * 1000,
                    seller: seller || 'Unknown',
                    name: itemMeta.name,
                    symbol: target.symbol,
                    imageUrl: itemMeta.image,
                    rank: itemRankMax, // Using captured max values
                    rarity: itemTierMax,
                    rank_additive: itemMeta.rank_additive,
                    tier_additive: itemMeta.tier_additive,
                    score_additive: itemMeta.score_statistical,
                    rank_statistical: itemMeta.rank_statistical,
                    tier_statistical: itemMeta.tier_statistical,
                    score_statistical: itemMeta.score_statistical,
                    sellerExpiry: expiry,
                    auctionHouse: auctionHouse
                  };

                  broadcaster.broadcastListing(listing);

                  // Auto Buy (per filter)
                  if (shouldAutoBuy) {
                    logger.info(`AutoBuy Triggered for ${itemMeta.name} @ ${price} SOL (via RAW parsing). Sending...`);
                    executeBuyTransaction(potentialMint, price, listing.seller || 'Unknown', undefined, auctionHouse, expiry, maxPriorityFee)
                      .then(async sig => {
                        if (sig === 'SKIPPED_DUPLICATE') return;
                        logger.info(`AutoBuy CONFIRMED! Sig: ${sig}`);
                        if (matchingFilterId) {
                          await configManager.incrementBuyCount(target.symbol, matchingFilterId);
                          broadcaster.broadcastMessage('config_update', configManager.getTargets());
                        }
                      })
                      .catch(err => {
                        if (err === 'SKIPPED_DUPLICATE') return;
                        logger.error(`AutoBuy FAILED: ${err.message}`)
                      });
                  }
                  break; // Found matching listing, break potentialMint loop (since mint found)
                }
                break; // Found item in collection
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[Webhook] Error processing payload:', error);
  }
});

// Background Floor Price
const floorPriceManager = new FloorPriceManager();
const historyService = new HistoryService();

app.get('/api/history/:symbol', (req, res) => {
  const symbol = req.params.symbol;
  const history = historyService.getHistory(symbol);
  res.json({ symbol, history });
});

// Background Interval
setInterval(async () => {
  const targets = configManager.getTargets();
  if (targets.length === 0) return;

  const CONCURRENCY = 3;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (target) => {
      try {
        const newFloor = await floorPriceManager.fetchFloorPrice(target.symbol);
        if (newFloor !== null) {
          // Check if changed
          const current = collectionService.getCollection(target.symbol);
          if (current && Math.abs((current.floorPrice || 0) - newFloor) > 0.000001) {
            await historyService.addPoint(target.symbol, newFloor);
            collectionService.updateCollection(target.symbol, { floorPrice: newFloor });
            broadcaster.broadcastMessage('floorPriceUpdate', { symbol: target.symbol, floorPrice: newFloor });
          }
        }
      } catch (err) {
        console.error(`Error updating floor for ${target.symbol}:`, err);
      }
    }));
    if (i + CONCURRENCY < targets.length) await new Promise(r => setTimeout(r, 1000));
  }
}, 60 * 1000);

// Connection Warmer: Pings ME every 5s to keep TLS connection hot
function startConnectionWarmer() {
  logger.info('Starting Magic Eden Connection Warmer (TLS Keep-Alive)...');
  setInterval(async () => {
    try {
      // Use a cheap endpoint just to keep the handshake valid.
      // Instructions endpoint is what we care about most.
      // We pass a dummy parameter to avoid fetching real data.
      await fetch('https://api-mainnet.magiceden.dev/v2/instructions/buy_now?buyer=11111111111111111111111111111111&seller=11111111111111111111111111111111&price=0&tokenMint=11111111111111111111111111111111&tokenATA=11111111111111111111111111111111', {
        headers: { 'Authorization': `Bearer ${process.env.ME_API_KEY}` }
      });
      logger.debug('Warmer Ping');
    } catch {
      // Ignore errors, it's just a warmer
    }
  }, 4000); // 4 seconds (ME timeout might be around 5s or 10s)
}



// Start Server
app.listen(PORT, () => {
  logger.info(`NFT Sniper running on port ${PORT}`);
  logger.info(`M2 Support Enabled (fresh build)`);
});

// Shutdown
const shutdown = async (signal: string) => {
  logger.info(`Shutting down (${signal})...`);
  await collectionService.stopAutoSave();
  blockhashManager.stop();
  balanceMonitor.stop();
  logger.info('Shutdown complete. Exiting.');
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Buy Feature
let heliusConnection: Connection | null = null;
if (RPC_URL) heliusConnection = new Connection(RPC_URL, 'confirmed');

async function executeBuyTransaction(mint: string, price: number, seller: string, tokenATA?: string, auctionHouse?: string, sellerExpiry?: number, priorityFeeSol?: number, verifyPrice: boolean = false): Promise<string> {
  if (ActiveMints.has(mint)) return 'SKIPPED_DUPLICATE';
  ActiveMints.add(mint);

  try {
    // 0. Balance Check (Safety First)
    const balance = balanceMonitor.getBalance();
    // Allow a small buffer (0.02 SOL) for fees themselves
    if (balance < price + 0.02) {
      throw new Error(`Insufficient funds: ${balance.toFixed(3)} SOL < ${price} + 0.02 SOL`);
    }

    // Optimistic Balance Deduction (Prevent Race Conditions)
    balanceMonitor.decreaseBalance(price);

    const ME_API_KEY = process.env.ME_API_KEY;
    const BURNER_KEY_RAW = process.env.BURNER_WALLET_PRIVATE_KEY;
    const BURNER_ADDRESS = process.env.BURNER_WALLET_ADDRESS;

    if (!ME_API_KEY || !BURNER_KEY_RAW || !BURNER_ADDRESS) throw new Error('Server misconfigured');

    let secretKey: Uint8Array;
    if (BURNER_KEY_RAW.trim().startsWith('[')) secretKey = Uint8Array.from(JSON.parse(BURNER_KEY_RAW));
    else secretKey = decodeBase58(BURNER_KEY_RAW);

    const burnerWallet = Keypair.fromSecretKey(secretKey);

    // 1. OPTIMISTIC DEFAULTS (The "Speed Hacks")
    // If AH is missing, assume Canonical (Standard ME V2) to avoid API fetch
    const CANONICAL_AH = 'E8cU1WiRWjanGxmn96ewBgk9vPTcL6AEZ1t6F6fkgUWe';
    let authAuctionHouse = auctionHouse || CANONICAL_AH;

    // If we have seller + price, FORCE SKIP verification unless explicitly told otherwise
    const needsVerification = verifyPrice || !seller || seller === 'Unknown';

    let authSeller = seller;
    let authPrice = price;
    let authExpiry = sellerExpiry || 0;
    let authTokenATA = tokenATA;

    // 2. VERIFICATION (Only run if we are blind)
    if (needsVerification) {
      logger.info(`⚠️ Data missing. Fetching from ME (Cost: ~500ms)...`);

      const detailsUrl = `https://api-mainnet.magiceden.dev/v2/tokens/${mint}/listings`;
      const detailsResp = await fetch(detailsUrl, {
        headers: { 'Authorization': `Bearer ${ME_API_KEY}` }
      });

      if (!detailsResp.ok) throw new Error(`Failed to fetch listing details: ${detailsResp.status}`);

      const listings = await detailsResp.json() as any[];
      if (!listings || listings.length === 0) throw new Error('No active listings found');

      // Sort by price
      listings.sort((a, b) => a.price - b.price);
      const best = listings[0];

      authSeller = best.seller;
      authExpiry = (best.expiry === -1) ? 0 : (best.expiry || 0);
      authTokenATA = best.tokenAddress || undefined;
      authPrice = best.price;
      authAuctionHouse = best.auctionHouse || authAuctionHouse;

      // Safety check
      if (authPrice > price + 0.000001) {
        throw new Error(`Price Mismatch! Expected ${price} SOL, but Real Price is ${authPrice} SOL.`);
      }
    }

    // 3. PRIORITY FEE CORRECTION
    // User Input: SOL (e.g. 0.0005)
    // Jito Tip: Lamports (e.g. 500,000)
    // ME Priority Fee: MicroLamports/CU (e.g. 100,000)

    // Default Jito Tip: 0.0005 SOL
    const jitoTipLamports = priorityFeeSol
      ? Math.floor(priorityFeeSol * 1_000_000_000)
      : parseInt(process.env.PRIORITY_FEE_LAMPORTS || '500000', 10);

    // Default ME Priority Fee: 100,000 MicroLamports (Standard High)
    // We don't map this 1:1 to Jito Tip because they are different units.
    const meMicroLamports = '100000';

    // 4. DERIVE ATA (Local Calculation - Fast)
    if (!authTokenATA && authSeller && authSeller !== 'Unknown') {
      const symbol = collectionService.findCollectionForMint(mint);
      const col = symbol ? collectionService.getCollection(symbol) : null;

      if (col?.type === 'core') {
        authTokenATA = authSeller; // MPL Core
      } else {
        // SPL Token
        const sellerPubkey = new PublicKey(authSeller);
        const mintPubkey = new PublicKey(mint);
        authTokenATA = (await getAssociatedTokenAddress(mintPubkey, sellerPubkey)).toBase58();
      }
    }

    // 5. FETCH TRANSACTION (Hot Connection)
    const query = new URLSearchParams({
      buyer: BURNER_ADDRESS!,
      seller: authSeller,
      tokenMint: mint,
      tokenATA: authTokenATA!,
      price: authPrice.toString(),
      sellerExpiry: authExpiry.toString(),
      prioFeeMicroLamports: meMicroLamports, // Correct unit
      auctionHouseAddress: authAuctionHouse
    });

    const meUrl = `https://api-mainnet.magiceden.dev/v2/instructions/buy_now?${query.toString()}`;
    // console.log(`[Buy] Fetching...`); 

    // No explicit agent needed here if setGlobalDispatcher is used!
    const meResp = await fetch(meUrl, {
      headers: { 'Authorization': `Bearer ${ME_API_KEY}` },
      signal: AbortSignal.timeout(10000) // 10s Timeout to prevent ActiveMints lockout
    });

    if (!meResp.ok) {
      throw new Error(`ME API Failed: ${await meResp.text()}`);
    }

    const data: any = await meResp.json();
    let txBuffer: Uint8Array;

    // Handle v0 response
    if (data.v0) {
      if (data.v0.txSigned && data.v0.txSigned.data) txBuffer = Uint8Array.from(data.v0.txSigned.data);
      else if (typeof data.v0 === 'string') txBuffer = Buffer.from(data.v0, 'base64');
      else if (data.v0.tx && data.v0.tx.data) txBuffer = Uint8Array.from(data.v0.tx.data);
      else if (data.v0.data) txBuffer = Uint8Array.from(data.v0.data);
      else if (Array.isArray(data.v0)) txBuffer = Uint8Array.from(data.v0);
      else throw new Error('Unknown v0 format');
    } else if (data.txSigned && data.txSigned.data) {
      txBuffer = Uint8Array.from(data.txSigned.data);
    } else if (data.tx && typeof data.tx === 'string') {
      txBuffer = Buffer.from(data.tx, 'base64');
    } else {
      throw new Error('Invalid response from ME API');
    }

    const transaction = VersionedTransaction.deserialize(txBuffer);

    // Blockhash
    let blockhashToUse = '';
    if (data.blockhashData && data.blockhashData.blockhash) {
      blockhashToUse = data.blockhashData.blockhash;
    } else {
      const latestBlockhashObj = blockhashManager.getLatestBlockhash();
      if (!latestBlockhashObj) throw new Error('Blockhash not yet available');
      blockhashToUse = latestBlockhashObj.blockhash;
    }

    transaction.message.recentBlockhash = blockhashToUse;
    transaction.sign([burnerWallet]);

    const signature = bs58.encode(transaction.signatures[0]);
    console.log(`[Buy] Transaction Signature: ${signature} (Jito Tip: ${jitoTipLamports})`);

    // JITO EXECUTION
    try {
      console.log(`[Buy] Sending via Jito Bundle (Tip: ${jitoTipLamports})...`);
      const bundleId = await jitoService.sendBundle(transaction, burnerWallet, jitoTipLamports, blockhashToUse);
      logger.debug(`Jito Bundle ID: ${bundleId}`);
    } catch (error: any) {
      logger.error('Jito failed:', error.message);
      logger.info('Falling back to Standard RPC...');

      const serializedTx = transaction.serialize();
      if (heliusConnection) {
        await heliusConnection.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          maxRetries: 0,
          preflightCommitment: 'confirmed'
        });
      } else {
        throw new Error('Helius Connection not initialized for fallback');
      }
    }

    // 6. MONITOR & CONFIRM (The "Reliability Hack")
    const isConfirmed = await confirmationService.monitor(signature, 'Buy Now');

    if (!isConfirmed) {
      throw new Error('Transaction failed to confirm on-chain (Timeout or Error)');
    }

    return signature;

  } catch (error) {
    // REFUND on Failure
    // If we deducted but failed to complete the logic, give it back.
    // Note: If the error came AFTER broadcast (e.g. monitoring), we might want to be careful.
    // But this catch wraps the whole function.
    balanceMonitor.increaseBalance(price);
    throw error;
  } finally {
    ActiveMints.delete(mint);
  }
}

app.post('/api/buy', async (req, res) => {
  try {
    const { mint, price, seller, auctionHouse, sellerExpiry } = req.body;
    if (!mint || !price || !seller) return res.status(400).json({ error: 'Missing mint, price, or seller' });

    // Manual buy also benefits from Jito if configured
    const signature = await executeBuyTransaction(mint, price, seller, undefined, auctionHouse, sellerExpiry);
    res.json({ success: true, signature });
  } catch (err: any) {
    if (err === 'SKIPPED_DUPLICATE') {
      res.status(409).json({ error: 'Transaction already in progress for this mint' });
    } else {
      console.error(`[Manual Buy] Error:`, err);
      res.status(500).json({ error: err.message });
    }
  }
});

// Global Error Handling
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
  // Optionally shutdown on fatal
  // shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});
