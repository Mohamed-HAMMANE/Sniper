import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { CollectionService } from './services/collectionService';
import { TargetCollection, CollectionMetadata, Listing } from './types';

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
    minRarity: minRarity
  };

  configManager.addTarget(target);

  // Clear cache/history if needed, or keep it to support multiple streams
  // cache.clear(); 
  // broadcaster.clearHistory();

  res.json({ success: true, targets: configManager.getTargets() });
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
        const seller = eventData.seller;

        // Check if this mint belongs to ANY active target collection
        // We need to check each target because different targets might have different criteria
        for (const target of targets) {
          // 1. Check if item is in this collection's database
          const itemMeta = collectionService.getItem(target.symbol, mint);

          // If not in this collection, skip
          if (!itemMeta) continue;

          // 2. Price Check
          if (priceSol > target.priceMax) continue;

          // 3. Rarity Check
          if (target.minRarity && itemMeta.tier) {
            const itemRarityVal = rarityOrder[itemMeta.tier.toUpperCase()] || 0;
            const targetRarityVal = rarityOrder[target.minRarity.toUpperCase()] || 0;

            if (itemRarityVal < targetRarityVal) {
              // console.log(`[Webhook] Ignored ${itemMeta.name} (Rarity ${itemMeta.tier} < ${target.minRarity})`);
              continue;
            }
          }

          const listing: Listing = {
            source: event.source || 'Unknown',
            mint: mint,
            price: priceSol,
            listingUrl: `https://magiceden.io/item-details/${mint}`, // TODO: Adjust based on source
            timestamp: Date.now(),
            seller: seller,
            name: itemMeta.name, // Use local name
            imageUrl: itemMeta.image, // Use local image
            rank: itemMeta.rank,
            rarity: itemMeta.tier
          };

          console.log(`[Webhook] 🔔 SNIPE! ${listing.name} (${listing.rarity}) for ${listing.price} SOL`);
          broadcaster.broadcastListing(listing);

          // Break after finding a match? Or allow multiple matches? 
          // Usually one item belongs to one collection, so break is safe.
          break;
        }
      }
    }
  } catch (error) {
    console.error('[Webhook] Error processing payload:', error);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`NFT Sniper is running!`);
  console.log(`=================================`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Webhook: http://localhost:${PORT}/webhook`);
  console.log(`=================================\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down...');
  process.exit(0);
});
