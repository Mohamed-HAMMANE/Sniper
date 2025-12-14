# NFT Sniper PRO - Advanced Solana Listing Monitor

A high-performance, real-time NFT listing monitor for Solana, designed to snipe listings on Magic Eden and other marketplaces faster than standard frontends.

**Now powered by Helius Webhooks** for sub-second latency and capable of monitoring multiple collections simultaneously.

## 🚀 Key Features

### Core Sniping & Monitoring
- **⚡ Webhook-Driven Speed**: Uses Helius Webhooks to detect listings the moment they hit the blockchain, abandoning slow polling methods.
- **🎯 Multi-Target Support**: Monitor multiple collections simultaneously with unique constraints (Max Price, Min Rarity) for each.
- **🧠 Advanced Parsing**: Custom decoder for **Magic Eden V2** instructions, detecting listings even when standard parsers return "Unknown" transaction types.
- **🛡️ Rarity Integration**: Filter snipes by rarity rank (Statistical or Additive scaling) to find underpriced rare items.
- **� Auto-Buying Engine**: Integrated **Jito Bundles** support to bypass network congestion and protect against sandwiches. Includes "Smart Fetch" to validate listing parameters before execution.

### Modern Dashboard UI
- **📊 Real-Time Charts**: Interactive floor price history charts for every watched collection.
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
    - **Account Addresses**: Add the collection addresses (Update Authorities or Candy Machine IDs).
    - **Note**: Do NOT use "Enhanced" or "NFT_LISTING" types as they add ~5s of latency. The bot now includes a custom Raw Parser.

## 🔮 Strategic Move: Low Latency VPS
**Critical for Success:** 
Running this locally with Ngrok adds **4-8 seconds** of latency due to the tunnel round-trip. In the sniping game, this is too slow.

**Recommendation:**
Deploy this application to a high-performance Cloud VPS (Virtual Private Server) to achieve sub-second reaction times.
- **Provider**: Vultr, DigitalOcean, or AWS (US-East Region recommended for proximity to Solana RPCs).
- **Benefit**: Removes the Ngrok bottleneck, reducing latency from ~6000ms to <200ms.

## ⚙️ Configuration

Targets are managed via the UI, but persisted in `config.json`.
Wallet settings are managed in `.env`.

## 🔌 API Endpoints

- `GET /api/config`: Current state of targets.
- `POST /api/target`: Add a new collection to watch.
- `DELETE /api/target/:symbol`: Stop watching a collection.
- `GET /api/history/:symbol`: Get floor price history chart data.
- `GET /api/listings-stream`: SSE endpoint for frontend updates.
- `POST /api/buy`: Trigger manual buy.
- `POST /api/feed/clear`: Clear the current listings feed.
- `GET /api/stats`: System health stats.

## 🐛 Troubleshooting

**"I'm not getting listing alerts"**
- Check your **ngrok** tunnel status. If the URL changed, update the Helius Webhook.
- Ensure the collection address in Helius matches the NFTs you are watching.

**"Unknown Event" logs?**
- The bot includes a custom decoder for Magic Eden V2 listings. If you see `Found UNKNOWN listing: ...`, the custom parser successfully extracted the price from a raw transaction!

## License
MIT
