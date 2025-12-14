export interface TargetCollection {
  symbol: string;
  priceMax: number;
  minRarity?: string; // 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'
  rarityType?: 'additive' | 'statistical';
  autoBuy?: boolean;
  traitFilters?: Record<string, string[]>; // e.g. { "Background": ["Red", "Blue"] }
}

export interface CollectionMetadata {
  symbol: string;
  name: string;
  image: string;
  floorPrice?: number;
  type?: 'core' | 'normal';
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


