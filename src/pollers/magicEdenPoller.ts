import { Listing, MagicEdenListing, CollectionMetadata } from '../types';

const MAGIC_EDEN_API_BASE = 'https://api-mainnet.magiceden.dev/v2';

export class MagicEdenPoller {
  private nameCache = new Map<string, string>();
  private lastRequestTime = 0;

  public async pollCollection(symbol: string): Promise<Listing[]> {
    return this.fetchListings(symbol);
  }

  public async getCollectionMetadata(symbol: string): Promise<CollectionMetadata> {
    const url = `${MAGIC_EDEN_API_BASE}/collections/${symbol}`;

    try {
      const response = await this.fetchUrl(url);
      const data = await response.json() as any;

      return {
        symbol: data.symbol,
        name: data.name,
        image: data.image
      };
    } catch (error) {
      console.log(`[Metadata] Failed to fetch metadata for ${symbol} (using fallback)`);
      // Return fallback metadata so we don't crash or block
      return {
        symbol: symbol,
        name: symbol,
        image: ''
      };
    }
  }


  public async fetchActivities(symbol: string): Promise<any[]> {
    const url = `${MAGIC_EDEN_API_BASE}/collections/${symbol}/activities?limit=100`;
    try {
      const response = await this.fetchUrl(url);
      return await response.json() as any[];
    } catch (error) {
      console.error(`[MagicEden] Error fetching activities for ${symbol}:`, error);
      return [];
    }
  }

  public async pollActivitiesAsListings(symbol: string): Promise<Listing[]> {
    try {
      const activities = await this.fetchActivities(symbol);
      const listEvents = activities.filter(a => a.type === 'list');

      return listEvents.map(a => ({
        collection: symbol,
        mint: a.tokenMint,
        price: a.price,
        listingUrl: `https://magiceden.io/item-details/${a.tokenMint}`,
        timestamp: (a.blockTime || 0) * 1000,
        imageUrl: a.image,
        name: undefined, // Activity doesn't usually provide token name
        seller: a.seller,
        signature: a.signature
      }));
    } catch (error) {
      console.error(`[MagicEden] Error polling activities as listings for ${symbol}:`, error);
      return [];
    }
  }

  public async getTokenName(mint: string): Promise<string | undefined> {
    if (this.nameCache.has(mint)) {
      return this.nameCache.get(mint);
    }

    // Rate limit compliance: Ensure at least 500ms between token details fetches
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < 500) {
      await this.sleep(500 - timeSinceLast);
    }
    this.lastRequestTime = Date.now();

    const url = `${MAGIC_EDEN_API_BASE}/tokens/${mint}`;
    try {
      const response = await this.fetchUrl(url);
      const data = await response.json() as any;
      
      if (data.name) {
        this.nameCache.set(mint, data.name);
      }
      return data.name;
    } catch (error) {
      console.error(`[MagicEden] Error fetching token name for ${mint}:`, error);
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchListings(symbol: string): Promise<Listing[]> {
    // Fetch 100 items to ensure we catch bursts
    // Cache buster removed as it causes API errors
    const url = `${MAGIC_EDEN_API_BASE}/collections/${symbol}/listings?limit=100&sort=updatedAt`;

    try {
      const response = await this.fetchUrl(url);
      const data = await response.json() as MagicEdenListing[];

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map(listing => this.convertListing(symbol, listing));

    } catch (error) {
      console.error(`[MagicEden] Error fetching listings for ${symbol}:`, error);
      throw error;
    }
  }

  private async fetchUrl(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (response.status === 429) {
      throw new Error('429 - Too Many Requests');
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  private convertListing(collectionSymbol: string, meListing: MagicEdenListing): Listing {
    // Magic Eden API returns price already in SOL
    const priceInSol = meListing.price;

    return {
      collection: collectionSymbol,
      mint: meListing.tokenMint,
      price: priceInSol,
      listingUrl: `https://magiceden.io/item-details/${meListing.tokenMint}`,
      // Magic Eden doesn't provide blockTime, so we use current poll time
      timestamp: Date.now(),
      seller: meListing.seller,
      imageUrl: meListing.extra?.img || meListing.token?.image,
      name: meListing.token?.name
    };
  }
}
