import * as fs from 'fs';
import * as path from 'path';
import { CollectionMetadata } from '../types';

interface ItemMetadata {
    name: string;
    rank: number;
    tier: string;
    image: string;
    collection: string;
}

export class CollectionService {
    private collections: CollectionMetadata[] = [];
    private itemDatabases: Map<string, Record<string, ItemMetadata>> = new Map();
    private dataDir: string;

    constructor() {
        this.dataDir = path.join(__dirname, '../../data');
        this.loadCollections();
    }

    public loadCollections() {
        try {
            const collectionsPath = path.join(this.dataDir, 'collections.json');
            if (fs.existsSync(collectionsPath)) {
                const data = fs.readFileSync(collectionsPath, 'utf-8');
                this.collections = JSON.parse(data);
                console.log(`[CollectionService] Loaded ${this.collections.length} collections.`);

                // Load individual databases
                for (const col of this.collections) {
                    this.loadDatabase(col.symbol);
                }
            } else {
                console.warn('[CollectionService] collections.json not found.');
            }
        } catch (error) {
            console.error('[CollectionService] Error loading collections:', error);
        }
    }

    private loadDatabase(symbol: string) {
        try {
            const dbPath = path.join(this.dataDir, `${symbol}.json`);
            if (fs.existsSync(dbPath)) {
                const data = fs.readFileSync(dbPath, 'utf-8');
                const db = JSON.parse(data);
                this.itemDatabases.set(symbol, db);
                console.log(`[CollectionService] Loaded database for ${symbol} (${Object.keys(db).length} items).`);
            } else {
                console.warn(`[CollectionService] Database for ${symbol} not found at ${dbPath}`);
            }
        } catch (error) {
            console.error(`[CollectionService] Error loading database for ${symbol}:`, error);
        }
    }

    public getCollections(): CollectionMetadata[] {
        return this.collections;
    }

    public getCollection(symbol: string): CollectionMetadata | undefined {
        return this.collections.find(c => c.symbol === symbol);
    }

    public getItem(symbol: string, mint: string): ItemMetadata | undefined {
        const db = this.itemDatabases.get(symbol);
        if (!db) return undefined;
        return db[mint];
    }

    // Helper to check if a mint belongs to ANY loaded collection
    public findCollectionForMint(mint: string): string | undefined {
        for (const [symbol, db] of this.itemDatabases.entries()) {
            if (db[mint]) {
                return symbol;
            }
        }
        return undefined;
    }
}
