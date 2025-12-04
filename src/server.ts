import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { CollectionService } from './services/collectionService';
import { TargetCollection, CollectionMetadata, Listing } from './types';
import { decodeBase58 } from './utils/base58';

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

        if (priceSol <= 0) continue;

        const seller = eventData.seller;

        // Debug: Check if mint exists in any collection
        const foundCollection = collectionService.findCollectionForMint(mint);
        //console.log(`[Webhook] Received mint: ${mint}, Found in collection: ${foundCollection || 'NONE'}`);

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
          if (target.minRarity && itemMeta.tier) {
            const itemRarityVal = rarityOrder[itemMeta.tier.toUpperCase()] || 0;
            const targetRarityVal = rarityOrder[target.minRarity.toUpperCase()] || 0;

            if (itemRarityVal < targetRarityVal) {
              //console.log(`[Webhook] Skipped ${itemMeta.name}: Rarity ${itemMeta.tier} < ${target.minRarity}`);
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
            imageUrl: itemMeta.image, // Use local image
            rank: itemMeta.rank,
            rarity: itemMeta.tier
          };
          //console.log(`[Webhook] 🔔 SNIPE! ${listing.name} (${listing.rarity}) for ${listing.price} SOL`);
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

          // Check if this account is a known mint in any of our loaded collections
          const collectionSymbol = collectionService.findCollectionForMint(potentialMint);

          if (collectionSymbol) {
            // Check if we are currently watching this collection
            const target = targets.find(t => t.symbol === collectionSymbol);
            if (target) {
              const itemMeta = collectionService.getItem(collectionSymbol, potentialMint);
              if (itemMeta) {
                // Rarity Check
                if (target.minRarity && itemMeta.tier) {
                  const itemRarityVal = rarityOrder[itemMeta.tier.toUpperCase()] || 0;
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
                  imageUrl: itemMeta.image,
                  rank: itemMeta.rank,
                  rarity: itemMeta.tier
                };

                // console.log(`[Webhook] Found UNKNOWN listing: ${listing.name} for ${listing.price} SOL`);
                broadcaster.broadcastListing(listing);
                break; // Found the NFT, stop checking other accounts
              }
            }
          }
        }
      } else {
        console.log('------------------------------');
        console.log(event);
        console.log('------------------------------');
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
