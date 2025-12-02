import { Listing } from '../types';

export class ListingCache {
  private cache: Map<string, { timestamp: number, price: number }>; // mint -> { timestamp, price }
  private seenSignatures: Map<string, number>; // signature -> timestamp
  private maxAge: number; // milliseconds

  constructor(maxAgeMinutes: number = 10) {
    this.cache = new Map();
    this.seenSignatures = new Map();
    this.maxAge = maxAgeMinutes * 60 * 1000;

    // Clean up old entries every 2 minutes
    setInterval(() => this.cleanup(), 2 * 60 * 1000);
  }

  public hasListing(mint: string): boolean {
    return this.cache.has(mint);
  }

  public addListing(listing: Listing): void {
    // Track signature if available
    if (listing.signature) {
      this.seenSignatures.set(listing.signature, listing.timestamp || Date.now());
    }

    // Always track mint state
    this.cache.set(listing.mint, {
      timestamp: listing.timestamp,
      price: listing.price
    });
  }

  public isNewListing(listing: Listing): boolean {
    // 1. Precise check using Signature (if available)
    if (listing.signature) {
      return !this.seenSignatures.has(listing.signature);
    }

    // 2. Fallback check using Mint + Price (for snapshot polling)
    const cached = this.cache.get(listing.mint);

    // It's new if we haven't seen it
    if (!cached) {
      return true;
    }

    // It's also "new" (worth alerting) if the price has dropped
    if (listing.price < cached.price) {
      console.log(`[Cache] Price drop detected for ${listing.mint}: ${cached.price} -> ${listing.price}`);
      return true;
    }

    return false;
  }

  public filterNewListings(listings: Listing[]): Listing[] {
    const newListings: Listing[] = [];

    for (const listing of listings) {
      if (this.isNewListing(listing)) {
        newListings.push(listing);
        this.addListing(listing);
      }
    }

    return newListings;
  }

  private cleanup(): void {
    const now = Date.now();
    
    // Clean Mint cache
    const mintsToDelete: string[] = [];
    for (const [mint, data] of this.cache.entries()) {
      if (now - data.timestamp > this.maxAge) {
        mintsToDelete.push(mint);
      }
    }
    for (const mint of mintsToDelete) {
      this.cache.delete(mint);
    }

    // Clean Signature cache
    const sigsToDelete: string[] = [];
    for (const [sig, timestamp] of this.seenSignatures.entries()) {
      if (now - timestamp > this.maxAge) {
        sigsToDelete.push(sig);
      }
    }
    for (const sig of sigsToDelete) {
      this.seenSignatures.delete(sig);
    }

    if (mintsToDelete.length > 0 || sigsToDelete.length > 0) {
      console.log(`[Cache] Cleaned up ${mintsToDelete.length} mints and ${sigsToDelete.length} signatures`);
    }
  }

  public getCacheSize(): number {
    return this.cache.size + this.seenSignatures.size;
  }

  public clear(): void {
    this.cache.clear();
    this.seenSignatures.clear();
  }
}