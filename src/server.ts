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
import { BlockhashManager } from './services/blockhashManager';
import { ConfirmationService } from './services/confirmationService';
import { BalanceMonitor } from './services/balanceMonitor';
import { SetupManager } from './services/setupManager';

// Concurrency Control
const ActiveMints = new Set<string>();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const RPC_URL = process.env.RPC_URL || '';
if (!RPC_URL) {
  console.warn('⚠️ Warning: RPC_URL is not defined in .env. Some features may not work.');
}

const configManager = new ConfigManager();
const cache = new ListingCache(60); // Cache for 60 minutes
const collectionService = new CollectionService();
const broadcaster = new SSEBroadcaster();
const jitoService = new JitoService(RPC_URL);
const PUBLIC_RPC_URL = process.env.PUBLIC_RPC_URL;
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
    balance: balanceMonitor.getBalance()
  });
});

app.post('/api/balance/refresh', async (req, res) => {
  await balanceMonitor.refreshBalance();
  res.json({ success: true, balance: balanceMonitor.getBalance() });
});

// Add target collection (with first filter)
app.post('/api/target', async (req, res) => {
  const { symbol, priceMax, minRarity, maxRank, rarityType, autoBuy, traitFilters, filters } = req.body;

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
      autoBuy: autoBuy === true
    }]
  };

  await configManager.addTarget(target);
  res.json({ success: true, targets: configManager.getTargets() });
});

// Add filter to existing collection
app.post('/api/target/:symbol/filter', async (req, res) => {
  const { symbol } = req.params;
  const { priceMax, maxRank, minRarity, rarityType, autoBuy, traitFilters, priorityFee } = req.body;

  const filter = await configManager.addFilter(symbol, {
    priceMax: Number(priceMax) || 1000,
    maxRank: maxRank ? Number(maxRank) : undefined,
    minRarity: minRarity || 'COMMON',
    rarityType: rarityType || 'statistical',
    traitFilters,
    priorityFee: priorityFee ? Number(priorityFee) : undefined,
    autoBuy: autoBuy === true
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

  const success = await configManager.updateFilter(symbol, filterId, updates);

  if (!success) {
    return res.status(404).json({ error: 'Filter not found' });
  }

  res.json({ success: true, targets: configManager.getTargets() });
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
app.delete('/api/target/:symbol', async (req, res) => {
  const { symbol } = req.params;
  await configManager.removeTarget(symbol);
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

// Setup: Preview
app.post('/api/setup/preview', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'Missing address' });
    const data = await setupManager.previewCollection(address);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Setup: Init
app.post('/api/setup/init', async (req, res) => {
  const { symbol, address, name, image, type, minRarity } = req.body;
  if (!symbol || !address) return res.status(400).json({ error: 'Missing required fields' });

  // Fire and forget - client listens to SSE
  setupManager.initializeCollection(symbol, address, name, image, type, minRarity || 'COMMON');
  res.json({ success: true, message: 'Initialization started' });
});

// Get Traits for Collection
app.get('/api/traits/:symbol', (req, res) => {
  const { symbol } = req.params;
  const traits = collectionService.getTraits(symbol);
  res.json({ success: true, traits });
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
        if (event.timestamp) {
          const latency = Date.now() - (event.timestamp * 1000);
          console.log(`[Latency] ${latency}ms delay from Chain to Localhost (Type: ${event.type})`);
        }

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
                const itemValue = itemMeta.attributes ? itemMeta.attributes[traitKey] : undefined;

                if (!itemValue) {
                  matchesTraits = false;
                  break;
                }

                const allowedArr = allowedValues as string[];
                if (!allowedArr.includes(itemValue) && !allowedArr.includes(itemValue.toLowerCase()) && !allowedArr.map((v: string) => v.toLowerCase()).includes(itemValue.toLowerCase())) {
                  matchesTraits = false;
                  break;
                }
              }
              if (!matchesTraits) continue;
            }

            // All checks passed - this filter matches!
            matchesAnyFilter = true;

            // Upgrade to AutoBuy if this specific filter has it enabled
            if (filter.autoBuy) {
              shouldAutoBuy = true;
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
              console.log(`[AutoBuy] Triggered for ${itemMeta.name} @ ${priceSol} SOL`);
              executeBuyTransaction(mint, priceSol, seller, undefined, auctionHouse, expiry, maxPriorityFee)
                .then(sig => console.log(`[AutoBuy] SUCCESS! Sig: ${sig}`))
                .catch(err => {
                  if (err === 'SKIPPED_DUPLICATE') return;
                  console.error(`[AutoBuy] FAILED: ${err.message}`)
                });
            }
          }
        }

        /*const end = process.hrtime(start);
        const procTime = (end[0] * 1000 + end[1] / 1e6).toFixed(3);
        console.log(`[Processing] Logic took ${procTime}ms`);*/
      } else if ((event.type === 'UNKNOWN' || event.type === 'TRANSACTION') && event.accountData) {

        // Latency Check for UNKNOWN/RAW events
        if (event.timestamp) {
          const latency = Date.now() - (event.timestamp * 1000);
          console.log(`[Latency] (${event.type}) ${latency}ms delay from Chain to Localhost`);
        }

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
                if (filter.autoBuy) shouldAutoBuy = true;
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
                  console.log(`[AutoBuy] Triggered for ${itemMeta.name} @ ${price} SOL (via UNKNOWN parsing)`);
                  executeBuyTransaction(potentialMint, price, listing.seller || 'Unknown', undefined, undefined, 0)
                    .then(sig => console.log(`[AutoBuy] SUCCESS! Sig: ${sig}`))
                    .catch(err => {
                      if (err === 'SKIPPED_DUPLICATE') return;
                      console.error(`[AutoBuy] FAILED: ${err.message}`)
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
        const latency = Date.now() - ((event.blockTime || event.timestamp || (Date.now() / 1000)) * 1000);
        console.log(`[Latency] (RAW) ${latency.toFixed(0)}ms`);

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
                console.log(`[RawParser] MATCH FOUND! ${itemMeta.name} is in ${target.symbol}`);

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

                  // Filter matched!
                  matchesAnyFilter = true;
                  if (filter.autoBuy) {
                    shouldAutoBuy = true;
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
                    console.log(`[AutoBuy] Triggered (RAW) for ${itemMeta.name} @ ${price} SOL`);
                    executeBuyTransaction(potentialMint, price, listing.seller || 'Unknown', undefined, auctionHouse, expiry, maxPriorityFee)
                      .then(sig => console.log(`[AutoBuy] SUCCESS! Sig: ${sig}`))
                      .catch(err => {
                        if (err === 'SKIPPED_DUPLICATE') return;
                        console.error(`[AutoBuy] FAILED: ${err.message}`)
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
          await historyService.addPoint(target.symbol, newFloor);
          collectionService.updateCollection(target.symbol, { floorPrice: newFloor });
          broadcaster.broadcastMessage('floorPriceUpdate', { symbol: target.symbol, floorPrice: newFloor });
        }
      } catch (err) {
        console.error(`Error updating floor for ${target.symbol}:`, err);
      }
    }));
    if (i + CONCURRENCY < targets.length) await new Promise(r => setTimeout(r, 1000));
  }
}, 60 * 1000);

// Start Server
app.listen(PORT, () => {
  console.log(`NFT Sniper running on port ${PORT}`);
  console.log(`[Server] Time: ${new Date().toISOString()}`);
  console.log('[Server] M2 Support Enabled (fresh build)');
});

// Shutdown
const shutdown = async () => {
  console.log('\n[Server] Shutting down...');
  await collectionService.stopAutoSave();
  blockhashManager.stop();
  balanceMonitor.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Buy Feature
let heliusConnection: Connection | null = null;
if (RPC_URL) heliusConnection = new Connection(RPC_URL, 'confirmed');

async function executeBuyTransaction(mint: string, price: number, seller: string, tokenATA?: string, auctionHouse?: string, sellerExpiry?: number, priorityFeeSol?: number): Promise<string> {
  // 0. Concurrency Check
  if (ActiveMints.has(mint)) {
    console.log(`[Buy] Skipping duplicate trigger for ${mint}`);
    return 'SKIPPED_DUPLICATE';
  }
  ActiveMints.add(mint);

  try {
    // 0.1 Balance Check
    const balance = balanceMonitor.getBalance();
    if (balance < price) {
      throw new Error(`Insufficient funds: ${balance.toFixed(3)} SOL < ${price} SOL`);
    }

    const ME_API_KEY = process.env.ME_API_KEY;
    const BURNER_KEY_RAW = process.env.BURNER_WALLET_PRIVATE_KEY;
    const BURNER_ADDRESS = process.env.BURNER_WALLET_ADDRESS;
    const USE_JITO = process.env.USE_JITO === 'true';

    if (!ME_API_KEY || !BURNER_KEY_RAW || !BURNER_ADDRESS || !heliusConnection) throw new Error('Server misconfigured');

    let secretKey: Uint8Array;
    if (BURNER_KEY_RAW.trim().startsWith('[')) secretKey = Uint8Array.from(JSON.parse(BURNER_KEY_RAW));
    else secretKey = decodeBase58(BURNER_KEY_RAW);

    const burnerWallet = Keypair.fromSecretKey(secretKey);
    const buyerAddress = BURNER_ADDRESS;

    // 1. Prepare ATA if missing
    let sellerATA = tokenATA;
    if (!sellerATA) {
      const mintPubkey = new PublicKey(mint);

      // Check local collection data for MPL Core flag (0ms latency)
      const symbol = collectionService.findCollectionForMint(mint);
      let isCore = false;

      if (symbol) {
        const col = collectionService.getCollection(symbol);
        if (col && col.type === 'core') {
          isCore = true;
        }
      }

      if (isCore) {
        console.log('[Buy] Local DB thinks this is MPL Core. Skipping ATA derivation.');
        sellerATA = seller;
      } else {
        // Standard SPL Token
        const sellerPubkey = new PublicKey(seller);
        sellerATA = (await getAssociatedTokenAddress(mintPubkey, sellerPubkey)).toBase58();
      }
    }

    // 2. Build Query
    // Priority Fee Logic: Use custom if provided, otherwise default to ENV
    let prioFeeLamports = '500000'; // Default 0.0005 SOL
    if (priorityFeeSol) {
      // Convert SOL to microLamports? 
      // NO: Magic Eden API expects 'prioFeeMicroLamports' which means LAMPORTS (unit of SOL * 1e9) or MICRO-LAMPORTS?
      // Wait, 'prioFeeMicroLamports' usually implies integer value.
      // Let's assume input matches the ENV variable usage.
      // The ENV `PRIORITY_FEE_LAMPORTS` suggests it is in Lamports (1 SOL = 1e9 Lamports).
      // Magic Eden API docs say `prioFeeMicroLamports` but usually people pass Lamports?
      // Let's verify standard usage.
      // Standard code used `process.env.PRIORITY_FEE_LAMPORTS`.

      // Let's settle on: User input is in SOL (UI). We convert to Lamports.
      prioFeeLamports = Math.floor(priorityFeeSol * 1_000_000_000).toString();
      console.log(`[Buy] Using CUSTOM Priority Fee: ${priorityFeeSol} SOL (${prioFeeLamports} lamports)`);
    } else {
      prioFeeLamports = process.env.PRIORITY_FEE_LAMPORTS || '500000';
    }

    const PRIORITY_FEE = prioFeeLamports;

    let authSeller = seller;
    let authPrice = price;
    let authExpiry = sellerExpiry || 0;
    let authTokenATA = sellerATA;
    let authAuctionHouse = auctionHouse;

    // FALLBACK: If we don't know the seller (e.g. Manual Buy from UI where seller was Unknown), OR missing Auction House, we MUST fetch.
    if (!seller || seller === 'Unknown' || !authTokenATA || authTokenATA === 'Unknown' || !authAuctionHouse) {
      console.log('[Buy] Missing Seller/ATA/AH info. Falling back to Smart Fetch...');

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
      authTokenATA = best.tokenAddress || undefined; // Let it be re-derived or used
      authPrice = best.price;
      authAuctionHouse = best.auctionHouse || auctionHouse;

      console.log(`[Buy] Fallback resolved: Seller=${authSeller}, Price=${authPrice}`);
    } else {
      console.log(`[Buy] OPTIMISTIC MODE: Using Webhook data: Price=${authPrice}, Seller=${authSeller}`);
    }

    /*
    // OPTIMIZATION: Commented out "Smart Fetch" for speed. Trusting Webhook Data.
    // ... (Original commented out code removed for brevity as we integrated it above)
    */

    // Re-derive ATA if we have a seller now but no ATA (and it's not Core)
    if (!authTokenATA && authSeller && authSeller !== 'Unknown') {
      // Check if Core again locally to be safe or reuse existing var if available in scope
      const symbol = collectionService.findCollectionForMint(mint);
      let isCoreLocal = false;
      if (symbol) {
        const col = collectionService.getCollection(symbol);
        if (col && col.type === 'core') isCoreLocal = true;
      }

      if (!isCoreLocal) {
        const sellerPubkey = new PublicKey(authSeller);
        const mintPubkey = new PublicKey(mint);
        authTokenATA = (await getAssociatedTokenAddress(mintPubkey, sellerPubkey)).toBase58();
      } else {
        authTokenATA = authSeller;
      }
    }

    // Build query with authoritative data
    const query = new URLSearchParams({
      buyer: buyerAddress,
      seller: authSeller,
      tokenMint: mint,
      tokenATA: authTokenATA as string,
      price: authPrice.toString(),
      sellerExpiry: authExpiry.toString(),
      prioFeeMicroLamports: PRIORITY_FEE
    });

    if (authAuctionHouse) {
      query.append('auctionHouseAddress', authAuctionHouse);
    }

    const meUrl = `https://api-mainnet.magiceden.dev/v2/instructions/buy_now?${query.toString()}`;
    console.log(`[Buy] Fetching tx from: ${meUrl}`);

    const meResp = await fetch(meUrl, {
      headers: { 'Authorization': `Bearer ${ME_API_KEY}`, 'Content-Type': 'application/json' }
    });

    if (!meResp.ok) {
      const errText = await meResp.text();
      throw new Error(`ME API Failed: ${errText}`);
    }

    const data: any = await meResp.json();

    // Debug: Log response structure
    console.log('[Buy] ME Response keys:', Object.keys(data));
    if (data.v0) console.log('[Buy] v0 type:', typeof data.v0, 'isArray:', Array.isArray(data.v0));

    // Handle different response formats - prioritize v0 (compact versioned format)
    let txBuffer: Uint8Array;

    if (data.v0) {
      // v0 is the versioned transaction format (compact with address lookup tables)
      // IMPORTANT: Prioritize txSigned (ME's pre-signed tx) over tx (unsigned)
      // The tx needs 2 signatures: ME's signature + buyer's signature
      if (data.v0.txSigned && data.v0.txSigned.data) {
        // v0.txSigned.data is ALREADY signed by ME - we just add our signature
        txBuffer = Uint8Array.from(data.v0.txSigned.data);
        console.log('[Buy] Using v0.txSigned.data array (pre-signed by ME)');
      } else if (typeof data.v0 === 'string') {
        txBuffer = Buffer.from(data.v0, 'base64');
        console.log('[Buy] Using v0 as base64 string');
      } else if (data.v0.tx && data.v0.tx.data) {
        // v0.tx.data is UNSIGNED - will fail if 2 sigs required
        txBuffer = Uint8Array.from(data.v0.tx.data);
        console.log('[Buy] WARNING: Using v0.tx.data (UNSIGNED) - may fail if 2 sigs needed');
      } else if (data.v0.data) {
        txBuffer = Uint8Array.from(data.v0.data);
        console.log('[Buy] Using v0.data array');
      } else if (Array.isArray(data.v0)) {
        txBuffer = Uint8Array.from(data.v0);
        console.log('[Buy] Using v0 as array');
      } else {
        console.log('[Buy] v0 object keys:', Object.keys(data.v0));
        console.log('[Buy] v0 sample:', JSON.stringify(data.v0).substring(0, 200));
        throw new Error('Unknown v0 format');
      }
    } else if (data.txSigned && data.txSigned.data) {
      // Array buffer format (fallback)
      txBuffer = Uint8Array.from(data.txSigned.data);
      console.log('[Buy] Using txSigned.data array');
    } else if (data.tx && typeof data.tx === 'string') {
      // Base64 string format
      txBuffer = Buffer.from(data.tx, 'base64');
      console.log('[Buy] Using tx as base64 string');
    } else if (data.tx && data.tx.data) {
      // tx.data array format
      txBuffer = Uint8Array.from(data.tx.data);
      console.log('[Buy] Using tx.data array');
    } else {
      console.error('[Buy] Unknown response format:', JSON.stringify(data).substring(0, 500));
      throw new Error('Invalid response from ME API: Unknown transaction format');
    }

    console.log(`[Buy] Transaction size: ${txBuffer.length} bytes`);

    // Deserialize
    const transaction = VersionedTransaction.deserialize(txBuffer);

    // Log transaction details for debugging
    console.log(`[Buy] Transaction signatures needed: ${transaction.message.header.numRequiredSignatures}`);
    console.log(`[Buy] Transaction has ${transaction.message.compiledInstructions.length} instructions`);

    // 3. Get Blockhash - prefer ME's blockhashData if available (it's matched to the tx)
    let blockhashToUse = '';
    if (data.blockhashData && data.blockhashData.blockhash) {
      blockhashToUse = data.blockhashData.blockhash;
      console.log(`[Buy] Using ME's blockhash: ${blockhashToUse}`);
    } else {
      const latestBlockhashObj = blockhashManager.getLatestBlockhash();
      if (!latestBlockhashObj) throw new Error('Blockhash not yet available');
      blockhashToUse = latestBlockhashObj.blockhash;
      console.log(`[Buy] Using cached blockhash: ${blockhashToUse}`);
    }

    // 4. Sign - update blockhash and sign
    transaction.message.recentBlockhash = blockhashToUse;
    transaction.sign([burnerWallet]);

    // Get the actual signature from the signed transaction
    const signature = bs58.encode(transaction.signatures[0]);
    console.log(`[Buy] Transaction Signature: ${signature}`);

    // Log final serialized size
    const finalSerialized = transaction.serialize();
    console.log(`[Buy] Final serialized size: ${finalSerialized.length} bytes`);

    // 5. Execute
    if (USE_JITO) {
      try {
        console.log('[Buy] Sending via Jito Bundle...');
        const tipLamports = parseInt(PRIORITY_FEE, 10) || 100000;
        // Pass the cached blockhash to avoid extra RPC call in JitoService
        const bundleId = await jitoService.sendBundle(transaction, burnerWallet, tipLamports, blockhashToUse);
        console.log(`[Buy] Jito Bundle ID: ${bundleId}`);
        // meaningful signature is already set above
      } catch (error: any) {
        console.error('[Buy] Jito failed:', error.message);
        console.log('[Buy] Falling back to Standard RPC...');
        const serializedTx = transaction.serialize();
        await heliusConnection.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          maxRetries: 0,
          preflightCommitment: 'confirmed'
        });
      }
    } else {
      console.log('[Buy] Sending via Standard RPC...');
      const serializedTx = transaction.serialize();
      // For standard RPC, the return value IS the signature, but it matches what we signed
      await heliusConnection.sendRawTransaction(serializedTx, {
        skipPreflight: true,
        maxRetries: 0,
        preflightCommitment: 'confirmed'
      });
    }

    // 6. Monitor (Fire and Forget)
    confirmationService.monitor(signature, 'Buy Now');

    // 7. Optimistic Balance Update
    balanceMonitor.decreaseBalance(price);

    return signature;

  } finally {
    // Release Lock
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
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});
