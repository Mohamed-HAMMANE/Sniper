import * as fs from 'fs';
import * as path from 'path';
import { CollectionMetadata } from '../types';

interface ItemMetadata {
    name: string;
    image: string;
    collection: string;

    // Additive
    rank_additive: number;
    tier_additive: string;
    score_additive: number;

    // Statistical
    rank_statistical: number;
    tier_statistical: string;
    score_statistical: number;

    // Legacy fallback (optional)
    rank?: number;
    tier?: string;
}

export class CollectionService {
    private collections: CollectionMetadata[] = [];
    private itemDatabases: Map<string, Record<string, ItemMetadata>> = new Map();
    private dataDir: string;

    private isDirty: boolean = false;
    private saveTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.dataDir = path.join(__dirname, '../../data');
        this.loadCollections();
        this.startAutoSave();
    }

    private startAutoSave() {
        // Save every 30 seconds if dirty
        this.saveTimer = setInterval(() => this.saveCollections(), 30 * 1000);
    }

    public async stopAutoSave() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        // Final save
        await this.saveCollections();
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

    public findCollectionForMint(mint: string): string | undefined {
        for (const [symbol, db] of this.itemDatabases.entries()) {
            if (db[mint]) {
                return symbol;
            }
        }
        return undefined;
    }

    public async saveCollections() {
        if (!this.isDirty) return;

        try {
            const collectionsPath = path.join(this.dataDir, 'collections.json');
            // Write to temp file then rename for atomic write
            const tempPath = `${collectionsPath}.tmp`;
            await fs.promises.writeFile(tempPath, JSON.stringify(this.collections, null, 2), 'utf-8');
            await fs.promises.rename(tempPath, collectionsPath);
            this.isDirty = false;
            // console.log('[CollectionService] Saved collections.json');
        } catch (error) {
            console.error('[CollectionService] Error saving collections:', error);
        }
    }

    public updateCollection(symbol: string, updates: Partial<CollectionMetadata>) {
        const col = this.collections.find(c => c.symbol === symbol);
        if (col) {
            Object.assign(col, updates);
            this.isDirty = true;
        }
    }
}
