import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { TargetCollection, CollectionMetadata, Listing } from './types';
import { MetadataService } from './services/metadataService';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const configManager = new ConfigManager();
const cache = new ListingCache(60); // Cache for 60 minutes
const broadcaster = new SSEBroadcaster();
const metadataService = new MetadataService();

// State
let currentMetadata: CollectionMetadata | null = null;

// SSE endpoint
app.get('/api/listings-stream', (req, res) => {
  broadcaster.addClient(res);
});

// Get config
app.get('/api/config', (req, res) => {
  res.json({
    target: configManager.getTarget(),
    metadata: currentMetadata
  });
});

// Set target collection
app.post('/api/target', async (req, res) => {
  const { symbol, priceMax } = req.body;

  if (priceMax === undefined) {
    return res.status(400).json({ error: 'Missing required field: priceMax' });
  }

  const target: TargetCollection = {
    symbol: symbol ? symbol.toLowerCase() : undefined,
    priceMax: Number(priceMax)
  };

  configManager.setTarget(target);

  // Reset state
  cache.clear();
  broadcaster.clearHistory();

  // No metadata fetch - we rely on local DB for item details
  currentMetadata = {
    symbol: target.symbol || 'Global Watch',
    name: target.symbol || 'Global Watch',
    image: '' // No image available without API
  };

  res.json({ success: true, target, metadata: currentMetadata });
});

// Remove target
app.delete('/api/target', (req, res) => {
  configManager.removeTarget();
  currentMetadata = null;
  res.json({ success: true });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.getCacheSize(),
    connectedClients: broadcaster.getClientCount(),
    target: configManager.getTarget()?.symbol || 'Global'
  });
});

// Webhook Endpoint for Helius
app.post('/webhook', (req, res) => {
  // Acknowledge immediately
  res.status(200).send('OK');

  try {
    const notifications = req.body;
    if (!Array.isArray(notifications)) return;

    const target = configManager.getTarget();
    if (!target) return;

    for (const event of notifications) {
      if (event.type === 'NFT_LISTING') {
        const eventData = event.events.nft;
        const mint = eventData.nfts[0].mint;
        const priceLamports = eventData.amount;
        const priceSol = priceLamports / 1_000_000_000;
        const seller = eventData.seller;

        // 1. Price Check
        if (priceSol > target.priceMax) continue;

        // 2. Local Metadata Lookup (Zero Latency)
        // This acts as our "Whitelist" - if it's not in DB, we ignore it
        const localMeta = metadataService.getMetadata(mint);

        if (!localMeta) {
          // console.log(`[Webhook] Ignored ${mint} (Not in database)`);
          continue;
        }

        const listing: Listing = {
          collection: target.symbol || 'Unknown',
          mint: mint,
          price: priceSol,
          listingUrl: `https://magiceden.io/item-details/${mint}`,
          timestamp: Date.now(),
          seller: seller,
          name: localMeta.name,
          imageUrl: localMeta.image,
          // Add extra fields for rarity if needed
          // rank: localMeta.rank
        };

        console.log(`[Webhook] 🔔 SNIPE! ${listing.name} for ${listing.price} SOL`);
        broadcaster.broadcastListing(listing);
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
