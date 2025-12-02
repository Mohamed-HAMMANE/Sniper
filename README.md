# NFT Sniper - Magic Eden Listing Monitor

A lightweight, real-time NFT listing monitor for Solana's Magic Eden marketplace. Designed for speed and efficiency, it monitors a specific collection for listings below a target price and provides instant audio and visual alerts.

## Features

- **🎯 Single-Target Focus**: Dedicated monitoring for one collection at a time for maximum performance.
- **⚡ Real-time Updates**: Uses Magic Eden's activity API to detect listings seconds after they appear.
- **🔔 Instant Alerts**: Visual highlighting and audio notifications for listings matching your criteria.
- **🖥️ Modern UI**:
  - **Compact Header**: Status and stats at a glance.
  - **Controls Bar**: Quick access to change target collection and max price.
  - **Horizontal Card Layout**: Information-dense card layout showing the most recent listings.
- **🛡️ Rate Limit Smart**: Respects Magic Eden's API limits with intelligent polling intervals (1s base interval).
- **💾 No Database**: Runs entirely in-memory for zero-setup deployment.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Start the Server

```bash
npm start
```

The dashboard will be available at: `http://localhost:3000`

### 4. Start Sniping

1. Open the dashboard.
2. Enter a **Collection Symbol** (e.g., `degods`, `okay_bears`, `mad_lads`).
   - *Tip: Use the symbol found in the Magic Eden URL (e.g., magiceden.io/marketplace/**degods**)*
3. Set your **Max Price** in SOL.
4. Click **Update Target**.

The bot will immediately fetch a snapshot of current listings and then switch to monitoring real-time activities.

## Project Structure

```
/src
  /pollers        - Magic Eden API interaction (Listings & Activities)
  /config         - Configuration management (config.json)
  /services       - Listing cache and deduplication logic
  /api            - SSE (Server-Sent Events) broadcaster
  /types.ts       - TypeScript definitions
  /server.ts      - Main Express server & polling loop

/public
  /index.html     - Dashboard structure
  /app.js         - Frontend logic (SSE connection, UI rendering)
  /styles.css     - Modern dark mode styling

/config.json      - Persisted target configuration
```

## Configuration

The configuration is managed automatically via the UI, but is stored in `config.json`.
You can manually edit this file if needed (requires server restart to pick up changes if not done via API).

```json
{
  "target": {
    "symbol": "degods",
    "priceMax": 50
  }
}
```

## API Endpoints

The server exposes a REST API for controlling the sniper programmatically.

### `GET /api/config`
Returns the current target and collection metadata.

### `POST /api/target`
Sets the collection to monitor.
```json
{
  "symbol": "degods",
  "priceMax": 50
}
```

### `DELETE /api/target`
Stops monitoring and clears the current target.

### `GET /api/stats`
Returns system stats (cache size, connected clients).

### `GET /api/listings-stream`
Server-Sent Events (SSE) endpoint for real-time listing updates.

## Rate Limiting

The tool is designed to be a good citizen of the Magic Eden API:
- **Polling Interval**: Defaults to ~1 second between checks.
- **Token Details**: Fetches token names with a 500ms delay to avoid hitting rate limits on bursts.
- **Error Handling**: Automatically pauses and retries on API errors.

## Troubleshooting

### No listings appearing?
- **Check the Symbol**: Ensure you are using the correct collection symbol from the Magic Eden URL.
- **Check Activity**: If the collection is quiet (no new listings), the feed will remain empty until a new event occurs.
- **Console Logs**: Check the terminal output where `npm start` is running for detailed polling logs.

### "Rate Limit" errors in logs?
- The bot automatically handles these by retrying. If they persist, try increasing the delay in `server.ts` or monitoring a less active collection.

## License

MIT
