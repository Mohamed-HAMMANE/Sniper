# NFT Sniper PRO - Advanced Solana Listing Monitor

A high-performance, real-time NFT listing monitor for Solana, designed to snipe listings on Magic Eden and other marketplaces faster than standard frontends.

**Now powered by Helius Webhooks** for sub-second latency and capable of monitoring multiple collections simultaneously.

## 🚀 Key Features

### Core Sniping & Monitoring
- **⚡ Webhook-Driven Speed**: Uses Helius Webhooks to detect listings the moment they hit the blockchain, abandoning slow polling methods.
- **🎯 Multi-Target Support**: Monitor multiple collections simultaneously with unique constraints (Max Price, Min Rarity) for each.
- **🧠 Advanced Parsing**: Custom decoder for **Magic Eden V2** instructions, detecting listings even when standard parsers return "Unknown" transaction types.
- **🛡️ Rarity Integration**: Filter snipes by rarity rank (Statistical or Additive scaling) to find underpriced rare items.
- **👀 Wallet Monitoring**: Tracks SOL balances of configured burner/main wallets and sends **Telegram Alerts** on any balance change (in/out).

### Modern Dashboard UI
- **📊 Real-Time Charts**: Interactive floor price history charts for every watched collection.
- **🌊 Live Feed**: Real-time stream of incoming listings with "Good/Bad Deal" visual indicators based on floor price difference.
- **🔈 Audio/Visual Alerts**: Sound effects and toast notifications for new snipes.
- **📱 Responsive Sidebar**: Collapsible sidebar for managing active watches and collections.
- **💾 Auto-Persistence**: Automatically saves floor prices and target configurations to disk, ensuring your setup survives restarts.

## 🛠️ Project Structure

```
/src
  /server.ts           - Entry point & Webhook handler (ME V2 decoding logic)
  /services
    /collectionService - Manages collection metadata (Rarity, Names)
    /listingCache      - Deduplication to prevent alert spam
    /historyService    - Tracks floor price history
    /floorPriceManager - Background floor price updates
    /walletMonitor     - Tracks wallet balances & sends Telegram alerts
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
- **Telegram Bot Token & Chat ID** (for Wallet Alerts)
- **Ngrok** (or another way to expose localhost to the internet)

### 2. Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory:
   ```env
   # Telegram Configuration
   TELEGRAM_TOKEN=your_bot_token
   CHAT_ID=your_chat_id

   # Wallet Monitoring (Optional)
   WALLET_1=wallet_address_1
   WALLET_2=wallet_address_2
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
    - **Transaction Types**: Select `NFT_LISTING`, `TRANSFER` (if needed for other events), and ensure to handle raw transactions for the Custom Parser.
    - **Account Addresses**: Add the collection addresses (Candy Machine IDs or Update Authorities) you want to watch.

### 5. Start Sniping
1.  Open `http://localhost:3000`.
2.  Click **+ Add Collection** in the sidebar.
3.  Add a collection by symbol (must match a loaded metadata file).
4.  Set your **Max Price** and **Min Rarity**.
5.  Watch the **Live Feed** for instant alerts!

## ⚙️ Configuration

Targets are managed via the UI, but persisted in `config.json`.
Wallet and Telegram settings are managed in `.env`.

## 🔌 API Endpoints

- `GET /api/config`: Current state of targets and collections.
- `POST /api/target`: Add a new collection to watch.
- `DELETE /api/target/:symbol`: Stop watching a collection.
- `GET /api/history/:symbol`: Get floor price history chart data.
- `GET /api/listings-stream`: SSE endpoint for frontend updates.
- `POST /api/feed/clear`: Clear the current listings feed.
- `GET /api/stats`: System health stats (clients, cache size).

## 🐛 Troubleshooting

**"I'm not getting listing alerts"**
- Check your **ngrok** tunnel status. If the URL changed, update the Helius Webhook.
- Ensure the collection address in Helius matches the NFTs you are watching.

**"Telegram alerts not working?"**
- Verify `TELEGRAM_TOKEN` and `CHAT_ID` in `.env`.
- Ensure the bot has been started in your Telegram chat.

**"Unknown Event" logs?**
- The bot includes a custom decoder for Magic Eden V2 listings. If you see `Found UNKNOWN listing: ...`, the custom parser successfully extracted the price from a raw transaction!

## License
MIT
