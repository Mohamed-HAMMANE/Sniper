import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { MagicEdenPoller } from './pollers/magicEdenPoller';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { TargetCollection, CollectionMetadata, Listing } from './types';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const configManager = new ConfigManager();
const poller = new MagicEdenPoller();
const cache = new ListingCache(60); // Cache for 60 minutes
const broadcaster = new SSEBroadcaster();

// State
let currentMetadata: CollectionMetadata | null = null;
let isWarmedUp = false;

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

  if (!symbol || priceMax === undefined) {
    return res.status(400).json({ error: 'Missing required fields: symbol, priceMax' });
  }

  const target: TargetCollection = {
    symbol: symbol.toLowerCase(),
    priceMax: Number(priceMax)
  };

  configManager.setTarget(target);

  // Reset state
  isWarmedUp = false;
  cache.clear();
  broadcaster.clearHistory();

  // Fetch metadata immediately
  try {
    currentMetadata = await poller.getCollectionMetadata(target.symbol);
  } catch (e) {
    console.error('Failed to fetch metadata:', e);
  }

  // Restart polling immediately
  stopPolling();
  startPolling();

  res.json({ success: true, target, metadata: currentMetadata });
});

// Remove target
app.delete('/api/target', (req, res) => {
  configManager.removeTarget();
  currentMetadata = null;
  isWarmedUp = false;
  stopPolling();
  res.json({ success: true });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json({
    cacheSize: cache.getCacheSize(),
    connectedClients: broadcaster.getClientCount(),
    target: configManager.getTarget()?.symbol || 'None'
  });
});

// Main polling loop
async function pollLoop() {
  const target = configManager.getTarget();

  if (!target) {
    // console.log('[Poller] No target configured. Waiting...');
    return;
  }

  try {
    let currentListings: Listing[] = [];

    // 1. Warmup Phase: Fetch Snapshot
    if (!isWarmedUp) {
      // Fetch listings from Magic Eden (limit=100, sort=updatedAt)
      currentListings = await poller.pollCollection(target.symbol);

      console.log(`[Poller] Initialized cache for ${target.symbol} with ${currentListings.length} listings.`);
      isWarmedUp = true;
      console.log('[System] Freshness check disabled - showing all listings');

      // Fetch recent activities to get accurate timestamps
      try {
        console.log('[Poller] Fetching activities to identify fresh listings...');
        // Wait a bit to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

        const activities = await poller.fetchActivities(target.symbol);
        const listActivities = activities.filter(a => a.type === 'list');

        // Map mint -> timestamp (seconds * 1000)
        const mintTimestamps = new Map<string, number>();
        listActivities.forEach(a => {
          if (a.tokenMint && a.blockTime) {
            mintTimestamps.set(a.tokenMint, a.blockTime * 1000);
          }
        });

        const TEN_MINUTES = 10 * 60 * 1000;
        const now = Date.now();
        let freshCount = 0;

        // Reverse to broadcast Oldest -> Newest so frontend prepends correctly (Newest ends up at top)
        const sortedListings = [...currentListings].reverse();

        for (const listing of sortedListings) {
          // Check if we have a timestamp from activities
          const activityTime = mintTimestamps.get(listing.mint);

          if (activityTime) {
            listing.timestamp = activityTime;
          }

          // Broadcast if it matches criteria (regardless of age on startup)
          if (listing.price <= target.priceMax) {
            broadcaster.broadcastListing(listing);
            freshCount++;
          }

          // IMPORTANT: Cache ALL listings (even expensive ones) to prevent duplicate alerts
          // when we switch to activity polling (which might see these items as "new events")
          cache.addListing(listing);
        }

        if (freshCount > 0) {
          console.log(`[Poller] Found ${freshCount} listings on startup!`);
        } else {
          console.log('[Poller] No matching listings found on startup.');
        }

      } catch (e) {
        console.error('[Poller] Error processing startup activities:', e);
      }

      // Try to fetch metadata if we don't have it
      if (!currentMetadata) {
        try {
          // Wait 2 seconds before fetching metadata
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentMetadata = await poller.getCollectionMetadata(target.symbol);
        } catch (e) { console.error('Error fetching metadata', e); }
      }
      return;
    }

    // 2. Monitoring Phase: Use Activities
    // Switch to activities for better precision and re-list detection
    currentListings = await poller.pollActivitiesAsListings(target.symbol);

    // Filter new listings only
    const newListings = cache.filterNewListings(currentListings);

    if (newListings.length === 0) {
      // Log every 30 seconds if no new listings
      // if (pollCount % 30 === 0) {
      //   console.log(`[Poller] Still monitoring ${target.symbol}... (0 new events)`);
      // }
      return;
    }

    console.log(`[Poller] Detected ${newListings.length} new listing events`);

    // Filter by max price
    const matchingListings = newListings.filter(l => l.price <= target.priceMax);

    if (matchingListings.length > 0) {
      console.log(`[Alert] ${matchingListings.length} listings match max price ${target.priceMax} SOL`);

      // Broadcast to all connected clients (Oldest -> Newest)
      // Activities are returned Newest -> Oldest by API.
      // We reverse them so the broadcast order is chronological (Oldest first).
      matchingListings.reverse();

      // Fetch names concurrently for these relevant listings
      await Promise.all(matchingListings.map(async (listing) => {
        try {
          const name = await poller.getTokenName(listing.mint);
          if (name) {
            listing.name = name;
            console.log(`[Metadata] Fetched name for ${listing.mint}: ${name}`);
          }
        } catch (e) {
          console.error(`[Metadata] Failed to fetch name for ${listing.mint}`, e);
        }
      }));

      for (const listing of matchingListings) {
        broadcaster.broadcastListing(listing);
      }
    }

  } catch (error) {
    console.error(`[Poller] Error polling ${target.symbol}:`, error);
  }
}

// Start polling
let isPolling = false;
let pollingTimeout: NodeJS.Timeout;

async function startPolling() {
  if (isPolling) return;
  isPolling = true;
  console.log('[Poller] Starting polling loop...');

  await pollLoop();
}

function stopPolling() {
  isPolling = false;
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
  }
  console.log('[Poller] Polling stopped');
}

let pollCount = 0;
// Wrap pollLoop to handle scheduling
const originalPollLoop = pollLoop;
// @ts-ignore
pollLoop = async function () {
  if (!isPolling) return;

  const start = Date.now();
  await originalPollLoop();

  pollCount++;
  // if (pollCount % 10 === 0) {
  //   console.log(`[Poller] Heartbeat: Still sniping... (Cycle ${pollCount})`);
  // }

  const duration = Date.now() - start;

  // Calculate next delay (aim for 1s interval, but respect execution time)
  // If we hit rate limit (duration > 1000), we naturally slow down
  const delay = Math.max(1000 - duration, 100); // Minimum 100ms delay

  if (isPolling) {
    pollingTimeout = setTimeout(pollLoop, delay);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`NFT Sniper is running!`);
  console.log(`=================================`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`=================================\n`);

  // Start polling after server is up
  startPolling();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down...');
  stopPolling();
  process.exit(0);
});
