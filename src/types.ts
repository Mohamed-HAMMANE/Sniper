export interface TargetCollection {
  symbol?: string;
  priceMax: number;
}

export interface CollectionMetadata {
  symbol: string;
  name: string;
  image: string;
}

export interface Config {
  target?: TargetCollection;
}

export interface Listing {
  collection: string;
  mint: string;
  price: number; // in SOL
  listingUrl: string;
  timestamp: number;
  imageUrl?: string;
  name?: string;
  seller?: string;
  signature?: string;
}


