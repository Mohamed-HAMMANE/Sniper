# NFT Sniper - Magic Eden Listing Monitor

A lightweight, personal NFT listing monitor for Solana's Magic Eden marketplace. Monitor multiple collections with per-collection price filtering and get real-time alerts.

## Features

- ✅ Real-time monitoring of Magic Eden listings
- ✅ Per-collection price range filters
- ✅ Web-based dashboard with live updates
- ✅ Sound + visual alerts for matching listings
- ✅ Rate-limited API polling (respects Magic Eden limits)
- ✅ No database required - runs entirely in-memory
- ✅ Lightweight and easy to maintain

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

### 4. Add Collections to Watch

1. Open the dashboard in your browser
2. Enter a collection symbol (e.g., `degods`, `okay_bears`)
3. Set min and max price in SOL
4. Click "Add Collection"

## Development

### Watch Mode

For development with auto-recompile:

```bash
npm run watch
```

Then in another terminal:

```bash
npm start
```

### Project Structure

```
/src
  /pollers        - Magic Eden API polling with rate limiting
  /filters        - Per-collection price filtering logic
  /services       - Listing cache to prevent duplicates
  /api            - SSE endpoint for real-time browser updates
  /config         - Configuration management
  /types.ts       - TypeScript interfaces
  /server.ts      - Main Express server

/public
  /index.html     - Dashboard UI
  /app.js         - Frontend JavaScript
  /styles.css     - Dark mode styling

/config.json      - Your watched collections (auto-created)
```

## Configuration

Collections are managed via the web UI, but you can also edit `config.json` directly:

```json
{
  "collections": [
    {
      "symbol": "degods",
      "priceMin": 5,
      "priceMax": 50
    },
    {
      "symbol": "okay_bears",
      "priceMin": 1,
      "priceMax": 10
    }
  ]
}
```

**Note:** The server will automatically reload the config and restart polling when it changes.

## API Endpoints

### GET /api/config
Get current configuration

### POST /api/collections
Add a new collection
```json
{
  "symbol": "degods",
  "priceMin": 5,
  "priceMax": 50
}
```

### DELETE /api/collections/:symbol
Remove a collection

### PUT /api/collections/:symbol
Update collection price range
```json
{
  "priceMin": 10,
  "priceMax": 100
}
```

### GET /api/stats
Get current stats (cache size, connected clients, etc.)

### GET /api/listings-stream
Server-Sent Events stream for real-time listing updates

## Rate Limiting

The tool respects Magic Eden's rate limits:
- **Without API key:** 120 requests/minute (2 per second)
- **Queue-based polling:** Sequential requests with 500ms minimum gap
- **Exponential backoff:** Automatically backs off on 429 errors (30s, 60s, 120s)

For higher limits, you can request an API key from Magic Eden and add it to the poller.

## Tips

1. **Start with 1-3 collections** to test the system
2. **Set realistic price ranges** to avoid too many alerts
3. **Check the stats** regularly to monitor cache size and queue length
4. **Keep the browser tab open** to receive real-time alerts

## Troubleshooting

### No listings appearing

- Check that the collection symbol is correct (lowercase, e.g., `degods` not `DeGods`)
- Verify there are active listings for that collection on Magic Eden
- Check the browser console for errors
- Ensure the server is running and connected (status should show "Connected")

### Rate limit errors

- The tool automatically handles rate limits with exponential backoff
- If you're watching many collections, consider getting an API key from Magic Eden
- Reduce polling frequency in `server.ts` if needed

### Build errors

- Make sure you're using Node.js 18 or higher
- Delete `node_modules` and `dist` folders and reinstall: `npm install && npm run build`

## Future Enhancements

- Tensor marketplace integration
- Rarity scoring (HowRare.is, MoonRank APIs)
- Desktop notifications
- Historical data storage
- Auto-buy functionality
- Discord/Telegram webhooks

## License

MIT
