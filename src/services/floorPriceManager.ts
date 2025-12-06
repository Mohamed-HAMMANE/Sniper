
import https from 'https';

export class FloorPriceManager {
    private readonly baseUrl = 'https://api-mainnet.magiceden.dev/v2/collections';

    /**
     * Fetches the current floor price for a collection symbol from Magic Eden.
     * Returns price in SOL or null if failed.
     */
    async fetchFloorPrice(symbol: string): Promise<number | null> {
        return new Promise((resolve) => {
            const url = `${this.baseUrl}/${symbol}/stats`;

            const req = https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const stats = JSON.parse(data);
                            // Magic Eden returns floor price in lamports (1e9)
                            const floorLamports = stats.floorPrice;
                            if (floorLamports) {
                                resolve(floorLamports / 1e9);
                            } else {
                                resolve(null);
                            }
                        } else {
                            if (res.statusCode === 429) {
                                console.warn(`[FloorPrice] Rate limited for ${symbol}`);
                            } else if (res.statusCode === 404) {
                                console.warn(`[FloorPrice] Collection not found: ${symbol}`);
                            }
                            resolve(null);
                        }
                    } catch (e) {
                        console.error(`[FloorPrice] Error parsing stats for ${symbol}:`, e);
                        resolve(null);
                    }
                });
            });

            req.on('error', (e) => {
                console.error(`[FloorPrice] Request error for ${symbol}:`, e);
                resolve(null);
            });

            req.end();
        });
    }
}
