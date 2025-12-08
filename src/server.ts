import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { CollectionService } from './services/collectionService';
import { TargetCollection, CollectionMetadata, Listing } from './types';
import { decodeBase58 } from './utils/base58';
import { startWalletMonitor } from './services/walletMonitor';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const configManager = new ConfigManager();
const cache = new ListingCache(60); // Cache for 60 minutes
const broadcaster = new SSEBroadcaster();
const collectionService = new CollectionService();

// State
// let currentMetadata: CollectionMetadata | null = null; // No longer needed as global state

// SSE endpoint
app.get('/api/listings-stream', (req, res) => {
  broadcaster.addClient(res);
});

// Get config
app.get('/api/config', (req, res) => {
  res.json({
    targets: configManager.getTargets(),
    collections: collectionService.getCollections()
  });
});

// Add target collection
app.post('/api/target', async (req, res) => {
  const { symbol, priceMax, minRarity } = req.body;

  if (!symbol || priceMax === undefined) {
    return res.status(400).json({ error: 'Missing required fields: symbol, priceMax' });
  }

  const target: TargetCollection = {
    symbol: symbol,
    priceMax: Number(priceMax),
    minRarity: minRarity,
    rarityType: req.body.rarityType || 'statistical'
  };

  configManager.addTarget(target);

  // Clear cache/history if needed, or keep it to support multiple streams
  // cache.clear(); 
  // broadcaster.clearHistory();

  res.json({ success: true, targets: configManager.getTargets() });
});

// Clear feed history
app.post('/api/feed/clear', (req, res) => {
  broadcaster.clearHistory();
  res.json({ success: true, message: 'Feed history cleared' });
});

// Remove target
// Remove target
app.delete('/api/target/:symbol', (req, res) => {
  const { symbol } = req.params;
  configManager.removeTarget(symbol);
  res.json({ success: true, targets: configManager.getTargets() });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.getCacheSize(),
    connectedClients: broadcaster.getClientCount(),
    activeTargets: configManager.getTargets().length
  });
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

        const seller = eventData.seller;

        // Debug: Check if mint exists in any collection
        // const foundCollection = collectionService.findCollectionForMint(mint);
        // console.log(`[Webhook] Received mint: ${mint}, Found in collection: ${foundCollection || 'NONE'}`);

        // Check if this mint belongs to ANY active target collection
        // We need to check each target because different targets might have different criteria
        for (const target of targets) {
          // 1. Check if item is in this collection's database
          const itemMeta = collectionService.getItem(target.symbol, mint);

          // If not in this collection, skip
          if (!itemMeta) continue;

          // 2. Price Check
          if (priceSol > target.priceMax) {
            //console.log(`[Webhook] Skipped ${itemMeta.name}: Price ${priceSol} > ${target.priceMax}`);
            continue;
          }

          // 3. Rarity Check
          const rarityType = target.rarityType || 'statistical';
          let itemTier = '';
          let itemRank = 0;

          if (rarityType === 'additive') {
            itemTier = itemMeta.tier_additive || itemMeta.tier || 'COMMON';
            itemRank = itemMeta.rank_additive || itemMeta.rank || 0;
          } else {
            // Default to statistical
            itemTier = itemMeta.tier_statistical || itemMeta.tier || 'COMMON';
            itemRank = itemMeta.rank_statistical || itemMeta.rank || 0;
          }

          if (target.minRarity && itemTier) {
            const itemRarityVal = rarityOrder[itemTier.toUpperCase()] || 0;
            const targetRarityVal = rarityOrder[target.minRarity.toUpperCase()] || 0;

            if (itemRarityVal < targetRarityVal) {
              //console.log(`[Webhook] Skipped ${itemMeta.name}: Rarity ${itemTier} < ${target.minRarity} (${rarityType})`);
              continue;
            }
          }

          const listing: Listing = {
            source: event.source || 'Unknown',
            mint: mint,
            price: priceSol,
            listingUrl: `https://magiceden.io/item-details/${mint}`, // TODO: Adjust based on source
            timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
            seller: seller,
            name: itemMeta.name, // Use local name
            symbol: target.symbol,
            imageUrl: itemMeta.image, // Use local image

            // Primary display (based on selection)
            rank: itemRank,
            rarity: itemTier,

            // Full data
            rank_additive: itemMeta.rank_additive,
            tier_additive: itemMeta.tier_additive,
            score_additive: itemMeta.score_additive,

            rank_statistical: itemMeta.rank_statistical,
            tier_statistical: itemMeta.tier_statistical,
            score_statistical: itemMeta.score_statistical
          };

          // cache.addListing(listing);
          broadcaster.broadcastListing(listing);

          // Break after finding a match? Or allow multiple matches? 
          // Usually one item belongs to one collection, so break is safe.
          break;
        }
      } else if (event.type === 'UNKNOWN' && event.accountData) {
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

          // Optimization: Check against active targets directly instead of all loaded collections
          for (const target of targets) {
            const collectionSymbol = target.symbol;
            const itemMeta = collectionService.getItem(collectionSymbol, potentialMint);

            if (itemMeta) {
              // Rarity Check
              const rarityType = target.rarityType || 'statistical';
              let itemTier = '';
              let itemRank = 0;

              if (rarityType === 'additive') {
                itemTier = itemMeta.tier_additive || itemMeta.tier || 'COMMON';
                itemRank = itemMeta.rank_additive || itemMeta.rank || 0;
              } else {
                itemTier = itemMeta.tier_statistical || itemMeta.tier || 'COMMON';
                itemRank = itemMeta.rank_statistical || itemMeta.rank || 0;
              }

              if (target.minRarity && itemTier) {
                const itemRarityVal = rarityOrder[itemTier.toUpperCase()] || 0;
                const targetRarityVal = rarityOrder[target.minRarity.toUpperCase()] || 0;

                if (itemRarityVal < targetRarityVal) {
                  continue;
                }
              }

              // If we found a price, check it against max price
              if (price <= 0 || price > target.priceMax) {
                continue;
              }

              const listing: Listing = {
                source: isMagicEdenListing ? 'MagicEden' : (event.source || 'Unknown'),
                mint: potentialMint,
                price: price,
                listingUrl: `https://magiceden.io/item-details/${potentialMint}`,
                timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
                seller: event.feePayer, // Assuming fee payer is the seller/initiator
                name: itemMeta.name,
                symbol: collectionSymbol,
                imageUrl: itemMeta.image,

                // Primary display
                rank: itemRank,
                rarity: itemTier,

                // Full data
                rank_additive: itemMeta.rank_additive,
                tier_additive: itemMeta.tier_additive,
                score_additive: itemMeta.score_additive,

                rank_statistical: itemMeta.rank_statistical,
                tier_statistical: itemMeta.tier_statistical,
                score_statistical: itemMeta.score_statistical
              };

              // if (cache.isNewListing(listing)) {
              //   cache.addListing(listing);
              broadcaster.broadcastListing(listing);
              // }
              break; // Found the NFT in this target, stop checking other targets for this mint
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[Webhook] Error processing payload:', error);
  }
});

// Background Floor Price Integration
import { FloorPriceManager } from './services/floorPriceManager';
import { HistoryService } from './services/historyService';

const floorPriceManager = new FloorPriceManager();
const historyService = new HistoryService();

// History API
app.get('/api/history/:symbol', (req, res) => {
  const symbol = req.params.symbol;
  const history = historyService.getHistory(symbol);
  res.json({ symbol, history });
});

// Refresh Floor Prices every 60 seconds
setInterval(async () => {
  const targets = configManager.getTargets();
  if (targets.length === 0) return;

  // Process in batches to control rate limit (e.g. 3 concurrent requests)
  const CONCURRENCY = 3;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (target) => {
      try {
        const newFloor = await floorPriceManager.fetchFloorPrice(target.symbol);

        if (newFloor !== null) {
          // Record History
          await historyService.addPoint(target.symbol, newFloor);

          // Update memory (marked dirty)
          collectionService.updateCollection(target.symbol, { floorPrice: newFloor });

          // Broadcast update
          broadcaster.broadcastMessage('floorPriceUpdate', {
            symbol: target.symbol,
            floorPrice: newFloor
          });
        }
      } catch (err) {
        console.error(`Error updating floor for ${target.symbol}:`, err);
      }
    }));

    // Small delay between batches
    if (i + CONCURRENCY < targets.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}, 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`NFT Sniper is running!`);
  console.log(`=================================`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Webhook: http://localhost:${PORT}/webhook`);
  console.log(`=================================\n`);

  // Start Wallet Monitor
  startWalletMonitor();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  await collectionService.stopAutoSave();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Shutting down...');
  await collectionService.stopAutoSave();
  process.exit(0);
});

// ==================== BUY FEATURE ====================
import { Keypair, Connection, VersionedTransaction } from '@solana/web3.js';

// Global connection to reuse TCP Handshake (Optimization)
let heliusConnection: Connection | null = null;
const RPC_URL = process.env.RPC_URL;

if (RPC_URL) {
  heliusConnection = new Connection(RPC_URL, 'confirmed');
} else {
  console.warn("⚠️ Warning: RPC_URL missing while initializing server. Buy feature may be slow or fail.");
}

app.post('/api/buy', async (req, res) => {
  try {
    const { mint, price } = req.body;
    if (!mint || !price) {
      return res.status(400).json({ error: 'Missing mint or price' });
    }

    // 1. Load Keys
    const ME_API_KEY = process.env.ME_API_KEY;
    const BURNER_KEY_RAW = process.env.BURNER_WALLET_PRIVATE_KEY;

    if (!ME_API_KEY || !BURNER_KEY_RAW || !heliusConnection) {
      return res.status(500).json({ error: 'Server misconfigured (Missing Keys/RPC)' });
    }

    // 2. Parse Burner Key (JSON Array or Base58)
    let secretKey: Uint8Array;
    try {
      if (BURNER_KEY_RAW.trim().startsWith('[')) {
        const parsed = JSON.parse(BURNER_KEY_RAW);
        secretKey = Uint8Array.from(parsed);
      } else {
        secretKey = decodeBase58(BURNER_KEY_RAW);
      }
    } catch (e) {
      return res.status(500).json({ error: 'Invalid Burner Key format' });
    }

    const burnerWallet = Keypair.fromSecretKey(secretKey);
    const buyerAddress = burnerWallet.publicKey.toBase58();

    // 3. Call Magic Eden API to get Transaction
    const query = new URLSearchParams({
      buyer: buyerAddress,
      mint: mint,
      price: price.toString(), // SAFETY LOCK
      sellerExpiry: '0',
      useV2: 'true'
    });

    // Use default instruction endpoint which handles most standard listings
    const meUrl = `https://api-mainnet.magiceden.dev/v2/instructions/buy_now?${query.toString()}`;

    const meResp = await fetch(meUrl, {
      headers: {
        'Authorization': `Bearer ${ME_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!meResp.ok) {
      const errText = await meResp.text();
      console.error(`[Buy] ME API Error: ${meResp.status} ${errText}`);
      return res.status(400).json({ error: `ME API Failed: ${errText}` });
    }

    const data: any = await meResp.json();

    // Check for tx data
    if (!data.txSigned || !data.txSigned.data) {
      if (!data.tx || !data.tx.data) {
        return res.status(500).json({ error: 'Invalid response from ME API (No tx data)' });
      }
    }

    const txBufferData = data.txSigned ? data.txSigned.data : data.tx.data;
    const txBuffer = Uint8Array.from(txBufferData);

    // 4. Deserialize & Sign
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([burnerWallet]);

    // 5. Send via Helius RPC (High Speed)
    // OPTIMIZATION: skipPreflight: true (Don't simulate, just send!)
    const signature = await heliusConnection.sendTransaction(transaction, {
      skipPreflight: true,
      maxRetries: 0 // Don't retry, let it fail fast if block passes. Speed is priority.
    });

    console.log(`[Buy] Success! Sig: ${signature}`);
    res.json({ success: true, signature: signature });

  } catch (err: any) {
    console.error(`[Buy] Critical Error:`, err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

