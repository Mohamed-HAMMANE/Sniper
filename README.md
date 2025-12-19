# NFT Sniper PRO - Advanced Solana Listing Monitor

A high-performance, real-time NFT listing monitor for Solana, designed to snipe listings on Magic Eden and other marketplaces faster than standard frontends.

**Now powered by Helius Webhooks** for sub-second latency and capable of monitoring multiple collections simultaneously.

## 🚀 Key Features

### Core Sniping & Monitoring
- **⚡ Webhook-Driven Speed**: Uses Helius Webhooks to detect listings the moment they hit the blockchain, abandoning slow polling methods.
- **🎯 Multi-Target Support**: Monitor multiple collections simultaneously. **Advanced Filtering**: Apply multiple strategy filters per collection (e.g., "Snipe Rares < 50 SOL" AND "Snipe Floor < 10 SOL").
- **🧠 Advanced Parsing**: Custom decoder for **Magic Eden V2** instructions, detecting listings even when standard parsers return "Unknown" transaction types.
- **🛡️ Rarity Integration**: Filter snipes by rarity rank (Statistical or Additive scaling) to find underpriced rare items.
- **🎨 Trait Filters**: SolRarity Sniper-style attribute picker to filter by specific traits (e.g., \"Background: Red\" AND \"Hat: Crown\"). Uses OR within categories, AND between categories.
- **💰 Auto-Buying Engine**: Integrated **Jito Bundles** support to bypass network congestion and protect against sandwiches. Includes "Smart Fetch" to validate listing parameters before execution.
- **🧠 Smart Resource Management**: Hybrid RPC strategy offloads background tasks (Blockhash, Balance) to free public nodes, reducing paid RPC usage by **99%**.

### Modern Dashboard UI
- **📊 Smart Charts**: Interactive floor price history with smoothed trends (15-min intervals) to reduce noise while maintaining live updates.
- **🌊 Live Feed**: Real-time stream of incoming listings with "Good/Bad Deal" visual indicators.
- **⚡ Instant Buy**: One-click manual buy or fully automated sniping with a burner wallet.
- **📱 Responsive Sidebar**: Collapsible sidebar for managing active watches and collections.
- **💾 Auto-Persistence**: Automatically saves floor prices and target configurations to disk.

## 🛠️ Project Structure

```
/src
  /server.ts           - Entry point & Webhook handler (ME V2 decoding logic)
  /services
    /collectionService - Manages collection metadata (Rarity, Names)
    /listingCache      - Deduplication to prevent alert spam
    /historyService    - Tracks floor price history
    /floorPriceManager - Background floor price updates
    /balanceMonitor    - Tracks burner wallet balance
    /jitoService       - Jito Bundle integration
  /api
    /sseEndpoint       - Real-time client broadcasting
  /config              - Configuration manager
  /utils               - Decoding helpers (Base58)
  
/data
  collections.json     - Persisted collection stats (Floor price, etc.)
  *.json               - Collection specific metadata (e.g., degods.json)
  
/public                - Frontend Dashboard (Vanilla JS + Chart.js + CSS)
```

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** (v16+)
- **Helius API Key** (for Webhooks)
- **Private Key** (for Burner Wallet)
- **Ngrok** (for local testing) or **VPS** (for production)

### 2. Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory:
   ```env
   # RPC & APIs
   RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
   PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com  # (Optional) For background tasks to save credits
   ME_API_KEY=your_magiceden_key
   
   # Burner Wallet
   BURNER_WALLET_PRIVATE_KEY=[array]
   BURNER_WALLET_ADDRESS=...
   
   # Jito (Optional but Recommended)
   USE_JITO=true
   PRIORITY_FEE_LAMPORTS=500000
   ```

### 3. Build & Run

```bash
npm run build
npm start
```
The server will start on port `3000`.
- Dashboard: `http://localhost:3000`
- Webhook URL: `http://localhost:3000/webhook`

### 4. Setup Helius Webhook
Since this bot relies on push notifications from the blockchain, you must connect it to Helius:

1.  Start an ngrok tunnel (if local): `ngrok http 3000`
2.  Go to the [Helius Developer Portal](https://dev.helius.xyz/webhooks).
3.  Create a new Webhook:
    - **Network**: Mainnet
    - **Webhook URL**: `https://your-ngrok-url.ngrok.io/webhook`
    - **Webhook Type**: `Raw` (Essential for <2s latency)
    - **Transaction Types**: Select `Any` or `Transaction`.
    - **Transaction Status**: Select `Succeeded` only.
    - **Account Addresses**: Add the collection addresses (Update Authorities or Candy Machine IDs).
    - **Note**: Do NOT use "Enhanced" or "NFT_LISTING" types as they add ~5s of latency. The bot now includes a custom Raw Parser.

## 🔮 Strategic Move: Low Latency VPS
**Critical for Success:** 
Running this locally with Ngrok adds **4-8 seconds** of latency due to the tunnel round-trip. In the sniping game, this is too slow.

**Reference Setup (Production):**
This project is currently deployed on a **Vultr** VPS in **New Jersey (NJ)**.
- **Why NJ?**: Strategic proximity to Helius/Jito nodes.
- **Hardware**: 1 vCPU / 1GB RAM (Proven stable for monitoring ~10 collections).
- **Benefit**: **Reliability**. Ensures 24/7 uptime and eliminates home internet connection drops/interruptions.

## 🔮 Strategic Turn: Program-Level WebSockets (Architecture 2.0)

**The Bottleneck:** Helius Webhooks suffer from "Indexing Lag" (2.5s - 4.0s). By the time you receive the webhook, the block has been confirmed and indexed, meaning you are already seconds behind gRPC bots.

**The Solution:** Switch from reactive Webhooks to **Program-Level WebSockets**.

1.  **Direct Feed:** Subscribe to `logsSubscribe` for the Magic Eden V2 Program ID (`M2mx...`).
2.  **Local Filtering:** Instead of relying on Helius to filter addresses, receive **ALL** market logs and filter them locally against `target_mints.json` in memory (0ms).
3.  **Result:** Detection latency drops from **~3.0s** to **<500ms**, triggering the buy in the *same* or *next* block.

*Note: This architecture is currently being integrated to replace the legacy Webhook system.*

## ⚙️ Configuration

Targets are managed via the UI, but persisted in `config.json`.
Wallet settings are managed in `.env`.

## 🛡️ Security

This bot includes two layers of security for use on public cloud servers:

1.  **Webhook Security**:
    *   Set `HELIUS_AUTH_SECRET` in your `.env` file (e.g., `HELIUS_AUTH_SECRET=my-super-secret-token`).
    *   Add this same string to the `authHeader` field in your Helius Webhook configuration.
    *   The bot will verify this header on every incoming webhook and reject unauthorized requests.

2.  **Dashboard Access Control**:
    *   Set `AUTH_USER` and `AUTH_PASSWORD` in your `.env` file to protect the UI.
    *   Example:
        ```env
        AUTH_USER=admin
        AUTH_PASSWORD=password123
        ```
    *   Accessing the dashboard will now require Basic Auth credentials.

## 🔌 API Endpoints


- `GET /api/config`: Current state of targets.
- `GET /api/stats`: System health stats.
- `GET /api/history/:symbol`: Get floor price history chart data.
- `GET /api/traits/:symbol`: Get available traits for a collection.
- `GET /api/listings-stream`: SSE endpoint for frontend updates.

**Target Management**
- `POST /api/target`: Add a new collection to watch.
- `DELETE /api/target/:symbol`: Stop watching a collection.
- `PUT /api/target/:symbol/collapse`: Save UI collapse state.

**Filter Management**
- `POST /api/target/:symbol/filter`: Add a new filter to a collection.
- `PUT /api/target/:symbol/filter/:filterId`: Update a specific filter.
- `DELETE /api/target/:symbol/filter/:filterId`: Remove a specific filter.

**Operations**
- `POST /api/buy`: Trigger manual buy.
- `POST /api/feed/clear`: Clear the current listings feed.
- `POST /api/balance/refresh`: Force refresh of burner wallet balance.

**Setup**
- `POST /api/setup/init`: Initialize a new collection (fetch metadata/rarity).

## 🐛 Troubleshooting

**"I'm not getting listing alerts"**
- Check your **ngrok** tunnel status. If the URL changed, update the Helius Webhook.
- Ensure the collection address in Helius matches the NFTs you are watching.

**"Unknown Event" logs?**
- The bot includes a custom decoder for Magic Eden V2 listings. If you see `Found UNKNOWN listing: ...`, the custom parser successfully extracted the price from a raw transaction!

## License
MIT
