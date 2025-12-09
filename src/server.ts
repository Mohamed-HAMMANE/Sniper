import express from 'express';
import * as path from 'path';
import { ConfigManager } from './config/configManager';
import { ListingCache } from './services/listingCache';
import { SSEBroadcaster } from './api/sseEndpoint';
import { CollectionService } from './services/collectionService';
import { TargetCollection, CollectionMetadata, Listing } from './types';
import { decodeBase58 } from './utils/base58';
import { startWalletMonitor } from './services/walletMonitor';
import { FloorPriceManager } from './services/floorPriceManager';
import { HistoryService } from './services/historyService';
import { Keypair, Connection, VersionedTransaction, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { JitoService } from './services/jitoService';
import { BlockhashManager } from './services/blockhashManager';
import { ConfirmationService } from './services/confirmationService';
import { BalanceMonitor } from './services/balanceMonitor';

// Concurrency Control
const ActiveMints = new Set<string>();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const configManager = new ConfigManager();
const cache = new ListingCache(60); // Cache for 60 minutes
const collectionService = new CollectionService();
const broadcaster = new SSEBroadcaster();
const jitoService = new JitoService(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
const blockhashManager = new BlockhashManager(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
const confirmationService = new ConfirmationService(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', broadcaster);
const balanceMonitor = new BalanceMonitor(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', broadcaster);

// SSE endpoint
app.get('/api/listings-stream', (req, res) => {
  broadcaster.addClient(res);
});

// Get config
app.get('/api/config', (req, res) => {
  res.json({
    targets: configManager.getTargets(),
    collections: collectionService.getCollections(),
    balance: balanceMonitor.getBalance()
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
    rarityType: req.body.rarityType || 'statistical',
    autoBuy: req.body.autoBuy === true
  };

  await configManager.addTarget(target);
  res.json({ success: true, targets: configManager.getTargets() });
});

// Clear feed history
app.post('/api/feed/clear', (req, res) => {
  broadcaster.clearHistory();
  res.json({ success: true, message: 'Feed history cleared' });
});

// Remove target
app.delete('/api/target/:symbol', async (req, res) => {
  const { symbol } = req.params;
  await configManager.removeTarget(symbol);
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

        // Check against active targets
        for (const target of targets) {
          const itemMeta = collectionService.getItem(target.symbol, mint);

          if (!itemMeta) continue;

          // Price Check
          if (priceSol > target.priceMax) continue;

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
            if (itemRarityVal < targetRarityVal) continue;
          }

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
            rank: itemRank,
            rarity: itemTier,
            rank_additive: itemMeta.rank_additive,
            tier_additive: itemMeta.tier_additive,
            score_additive: itemMeta.score_statistical,
            rank_statistical: itemMeta.rank_statistical,
            tier_statistical: itemMeta.tier_statistical,
            score_statistical: itemMeta.score_statistical
          };

          broadcaster.broadcastListing(listing);

          // Auto Buy
          if (target.autoBuy) {
            console.log(`[AutoBuy] Triggered for ${itemMeta.name} @ ${priceSol} SOL`);
            // Pass seller to executeBuyTransaction
            executeBuyTransaction(mint, priceSol, seller)
              .then(sig => console.log(`[AutoBuy] SUCCESS! Sig: ${sig}`))
              .catch(err => {
                if (err === 'SKIPPED_DUPLICATE') return;
                console.error(`[AutoBuy] FAILED: ${err.message}`)
              });
          }
          break; // Found in target, break inner loop
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

          for (const target of targets) {
            const collectionSymbol = target.symbol;
            const itemMeta = collectionService.getItem(collectionSymbol, potentialMint);

            if (itemMeta) {
              // Rarity Check (Duplicate logic, simplified)
              const rarityType = target.rarityType || 'statistical';
              let itemTier = rarityType === 'additive' ? (itemMeta.tier_additive || 'COMMON') : (itemMeta.tier_statistical || 'COMMON');
              let itemRank = rarityType === 'additive' ? (itemMeta.rank_additive || 0) : (itemMeta.rank_statistical || 0);

              if (target.minRarity) {
                const itemRarityVal = rarityOrder[itemTier.toUpperCase()] || 0;
                const targetRarityVal = rarityOrder[target.minRarity.toUpperCase()] || 0;
                if (itemRarityVal < targetRarityVal) continue;
              }

              // Listing Logic for Unknown (Price 0 safety)
              if (price <= 0 || price > target.priceMax) continue;

              const listing: Listing = {
                source: isMagicEdenListing ? 'MagicEden' : (event.source || 'Unknown'),
                mint: potentialMint,
                price: price,
                listingUrl: `https://magiceden.io/item-details/${potentialMint}`,
                timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
                seller: event.feePayer || 'Unknown', // Keep consistent with old code assumption
                name: itemMeta.name,
                symbol: collectionSymbol,
                imageUrl: itemMeta.image,
                rank: itemRank,
                rarity: itemTier,
                rank_additive: itemMeta.rank_additive,
                tier_additive: itemMeta.tier_additive,
                score_additive: itemMeta.score_statistical, // reusing statistical score if additive missing, or keeping consistent
                rank_statistical: itemMeta.rank_statistical,
                tier_statistical: itemMeta.tier_statistical,
                score_statistical: itemMeta.score_statistical
              };

              broadcaster.broadcastListing(listing);

              // Auto Buy Logic for UNKNOWN events (Critical addition to match feature parity)
              if (target.autoBuy) {
                console.log(`[AutoBuy] Triggered for ${itemMeta.name} @ ${price} SOL (via UNKNOWN parsing)`);
                executeBuyTransaction(potentialMint, price, listing.seller || 'Unknown')
                  .then(sig => console.log(`[AutoBuy] SUCCESS! Sig: ${sig}`))
                  .catch(err => {
                    if (err === 'SKIPPED_DUPLICATE') return;
                    console.error(`[AutoBuy] FAILED: ${err.message}`)
                  });
              }

              break;
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
  startWalletMonitor();
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
const RPC_URL = process.env.RPC_URL;
if (RPC_URL) heliusConnection = new Connection(RPC_URL, 'confirmed');
else console.warn("⚠️ Warning: RPC_URL missing.");

async function executeBuyTransaction(mint: string, price: number, seller: string, tokenATA?: string): Promise<string> {
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
    const USE_JITO = process.env.USE_JITO === 'true';

    if (!ME_API_KEY || !BURNER_KEY_RAW || !heliusConnection) throw new Error('Server misconfigured');

    let secretKey: Uint8Array;
    if (BURNER_KEY_RAW.trim().startsWith('[')) secretKey = Uint8Array.from(JSON.parse(BURNER_KEY_RAW));
    else secretKey = decodeBase58(BURNER_KEY_RAW);

    const burnerWallet = Keypair.fromSecretKey(secretKey);
    const buyerAddress = burnerWallet.publicKey.toBase58();

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
    // Adding Priority Fee: 10000 microlamports = 0.00001 SOL (Adjustable)
    const PRIORITY_FEE = process.env.PRIORITY_FEE_LAMPORTS || '100000'; // Default 0.0001 SOL to be safe

    const query = new URLSearchParams({
      buyer: buyerAddress,
      seller: seller,
      mint: mint,
      tokenATA: sellerATA,
      price: price.toString(),
      sellerExpiry: '0',
      useV2: 'true',
      prioFeeMicroLamports: PRIORITY_FEE
    });

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
    const txBufferData = data.txSigned ? data.txSigned.data : (data.tx ? data.tx.data : null);

    if (!txBufferData) throw new Error('Invalid response from ME API: No transaction data found');

    // Deserialize
    const txBuffer = Uint8Array.from(txBufferData);
    const transaction = VersionedTransaction.deserialize(txBuffer);

    // 3. Get Blockhash (Instant)
    const latestBlockhashObj = blockhashManager.getLatestBlockhash();
    if (!latestBlockhashObj) throw new Error('Blockhash not yet available');

    // 4. Sign
    transaction.message.recentBlockhash = latestBlockhashObj.blockhash;
    transaction.sign([burnerWallet]);

    // 5. Execute
    let signature = '';
    if (USE_JITO) {
      console.log('[Buy] Sending via Jito Bundle...');
      const tipLamports = parseInt(PRIORITY_FEE, 10) || 100000;
      // Pass the cached blockhash to avoid extra RPC call in JitoService
      signature = await jitoService.sendBundle(transaction, burnerWallet, tipLamports, latestBlockhashObj.blockhash);
    } else {
      console.log('[Buy] Sending via Standard RPC...');
      signature = await heliusConnection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 0 });
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
    const { mint, price, seller } = req.body;
    if (!mint || !price || !seller) return res.status(400).json({ error: 'Missing mint, price, or seller' });

    // Manual buy also benefits from Jito if configured
    const signature = await executeBuyTransaction(mint, price, seller);
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
