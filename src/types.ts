export interface TargetCollection {
  symbol: string;
  priceMax: number;
  minRarity?: string; // 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'
}

export interface CollectionMetadata {
  symbol: string;
  name: string;
  image: string;
  floorPrice?: number;
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
  seller?: string;
  signature?: string;
  rank?: number;
  rarity?: string;
}


