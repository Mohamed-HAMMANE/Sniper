// Individual filter rule within a collection
export interface FilterRule {
  id: string;                               // UUID for tracking/deletion
  priceMax: number;
  maxRank?: number;                         // Rank-based filter (e.g., 500 = top 500)
  minRarity?: string;                       // Tier-based fallback ('COMMON' to 'MYTHIC')
  rarityType?: 'additive' | 'statistical';
  traitFilters?: Record<string, string[]>;  // e.g. { "Background": ["Red", "Blue"] }
  priorityFee?: number;                     // Optional custom priority fee in SOL
  autoBuy: boolean;
}

export interface TargetCollection {
  symbol: string;
  filters: FilterRule[];
  collapsed?: boolean;
}

export interface CollectionMetadata {
  symbol: string;
  name: string;
  image: string;
  address?: string; // New: stored to allow re-downloads
  floorPrice?: number;
  type?: 'core' | 'standard'; // Updated to match usage
  isSynced?: boolean;
  countWatched?: number;
  count?: number; // Total items
  filters?: {
    minRarity?: string;
    traits?: string | any[];
    logicMode?: 'AND' | 'OR';
  };
}

export interface Config {
  targets: TargetCollection[];
}

export interface Listing {
  source: string;
  mint: string;
  price: number; // in SOL
  listingUrl: string;
  timestamp: number;
  imageUrl?: string;
  name?: string;
  symbol?: string;
  seller?: string;
  signature?: string;
  auctionHouse?: string;
  sellerExpiry?: number;

  // Legacy support / Primary display
  rank?: number;
  rarity?: string;

  // New Dual Rarity
  rank_additive?: number;
  tier_additive?: string;
  score_additive?: number;

  rank_statistical?: number;
  tier_statistical?: string;
  score_statistical?: number;
}


