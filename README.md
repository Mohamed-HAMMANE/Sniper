# NFT Sniper - Advanced Solana Listing Monitor

A high-performance, real-time NFT listing monitor for Solana, designed to snub listings on Magic Eden and other marketplaces faster than standard frontends.

**Now powered by Helius Webhooks** for sub-second latency and capable of monitoring multiple collections simultaneously.

## 🚀 Key Features

- **⚡ Webhook-Driven Speed**: Abandoned polling for Helius Webhooks to detect listings the moment they hit the blockchain.
- **🎯 Multi-Target Support**: Monitor multiple collections at once with unique constraints (Max Price, Min Rarity) for each.
- **🧠 Advanced Parsing**: Custom decoder for **Magic Eden V2** instructions, detecting listings even when standard parsers return "Unknown" transaction types.
- **🛡️ Rarity Integration**: Filter snipes by rarity rank (Statistical or Additive scaling) to find underpriced rare items.
- **💾 Auto-Persistence**: Automatically saves floor prices and target configurations to disk (`data/`), ensuring your setup survives restarts.
- **📊 Historical Data**: Tracks and visualizes floor price trends over time.
- **🖥️ Modern Dashboard**:
    - **Sidebar Navigation**: Manage active watches and collections.
    - **Live Feed**: Real-time stream of incoming listings.
    - **Visual & Audio Alerts**: Never miss a snipe.

## 🛠️ Project Structure

```
/src
  /server.ts           - Entry point & Webhook handler (ME V2 decoding logic)
  /services
    /collectionService - Manages collection metadata (Rarity, Names)
    /listingCache      - Deduplication to prevent alert spam
    /historyService    - Tracks floor price history
    /floorPriceManager - Background floor price updates
  /api
    /sseEndpoint       - Real-time client broadcasting
  /config              - Configuration manager
  /utils               - Decoding helpers (Base58)

/data
  collections.json     - Persisted collection stats (Floor price, etc.)
  *.json               - Collection specific metadata (e.g., degods.json)
  /history             - Historical data points
  
/public                - Frontend Dashboard (Vanilla JS + CSS)
```

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** (v16+)
- **Helius API Key** (for Webhooks)
- **Ngrok** (or another way to expose localhost to the internet)

### 2. Installation

```bash
npm install
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

1.  Start an ngrok tunnel: `ngrok http 3000`
2.  Copy your public HTTPS URL (e.g., `https://abcd-123.ngrok.io`).
3.  Go to the [Helius Developer Portal](https://dev.helius.xyz/webhooks).
4.  Create a new Webhook:
    - **Network**: Mainnet
    - **Webhook URL**: `https://abcd-123.ngrok.io/webhook`
    - **Transaction Types**: Select `NFT_LISTING` and `Any` (or ensure raw transactions are sent so the Custom Parser can catch `UNKNOWN` ME V2 events).
    - **Account Addresses**: Add the collection addresses (Candy Machine IDs or Update Authorities) you want to watch.

### 5. Start Sniping
1.  Open `http://localhost:3000`.
2.  Click **+ Add Collection** in the sidebar.
3.  Add a collection by symbol (must match a loaded metadata file) or configure a new watch.
4.  Set your **Max Price** and **Min Rarity**.
5.  Watch the **Live Feed** for instant alerts!

## ⚙️ Configuration

Targets are managed via the UI, but persisted in `config.json`.

```json
{
  "targets": [
    {
      "symbol": "degods",
      "priceMax": 50,
      "minRarity": "RARE",
      "rarityType": "statistical"
    }
  ]
}
```

## 🔌 API Endpoints

- `GET /api/config`: Current state of targets and collections.
- `POST /api/target`: Add a new collection to watch.
- `DELETE /api/target/:symbol`: Stop watching a collection.
- `GET /api/history/:symbol`: Get floor price history chart data.
- `GET /api/listings-stream`: SSE endpoint for frontend updates.

## 🐛 Troubleshooting

**"I'm not getting listing alerts"**
- Check your **ngrok** tunnel status. If the URL changed, you must update the Helius Webhook.
- Ensure the collection address in Helius matches the NFTs you are watching.
- Check the console logs. If you see `[Webhook] Received mint...`, usage is correct but filters (Price/Rarity) might be hiding the item.

**"Unknown Event" logs?**
- The bot includes a custom decoder for Magic Eden V2 listings. If you see `Found UNKNOWN listing: ...`, the custom parser successfully extracted the price from a raw transaction!

## License
MIT
