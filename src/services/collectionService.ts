import * as fs from 'fs';
import * as path from 'path';
import { CollectionMetadata } from '../types';
import { logger } from '../utils/logger';

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

    // Attributes for filtering
    attributes?: Record<string, string>;
}

export class CollectionService {
    private collections: CollectionMetadata[] = [];
    private itemDatabases: Map<string, Record<string, ItemMetadata>> = new Map();
    private dataDir: string;

    private isDirty: boolean = false;
    private saveTimer: NodeJS.Timeout | null = null;
    private currentSavePromise: Promise<void> | null = null;

    constructor() {
        this.dataDir = path.join(__dirname, '../../data');
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
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
                const parsed = JSON.parse(data);
                this.collections = Array.isArray(parsed) ? parsed : [];

                // DATA MIGRATION: Ensure traits is always a string
                for (const col of this.collections) {
                    if (col.filters) {
                        if (Array.isArray(col.filters.traits)) {
                            col.filters.traits = col.filters.traits.join(',');
                        } else if (col.filters.traits === null || col.filters.traits === undefined) {
                            col.filters.traits = '';
                        }
                    }
                }

                logger.debug(`Loaded ${this.collections.length} collections (migrated).`);

                // Load individual databases
                this.itemDatabases.clear();
                for (const col of this.collections) {
                    this.loadDatabase(col.symbol);
                }
            } else {
                logger.warn('collections.json not found. Initializing empty.');
                this.collections = [];
                fs.writeFileSync(collectionsPath, '[]');
            }
        } catch (error) {
            logger.error('Error loading collections, resetting db:', error);
            this.collections = [];
            try {
                const collectionsPath = path.join(this.dataDir, 'collections.json');
                fs.writeFileSync(collectionsPath, '[]');
            } catch (e) { }
        }
    }

    private loadDatabase(symbol: string) {
        try {
            const dbPath = path.join(this.dataDir, `${symbol}.json`);
            if (fs.existsSync(dbPath)) {
                const data = fs.readFileSync(dbPath, 'utf-8');
                const db = JSON.parse(data);
                this.itemDatabases.set(symbol, db);
                logger.debug(`Loaded database for ${symbol} (${Object.keys(db).length} items).`);
            } else {
                logger.warn(`Database for ${symbol} not found at ${dbPath}`);
            }
        } catch (error) {
            logger.error(`Error loading database for ${symbol}:`, error);
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

        // If a save is already in progress, wait for it and then start this one
        if (this.currentSavePromise) {
            await this.currentSavePromise;
            // After previous finish, check if we still need to save (could have been handled by the queue)
            if (!this.isDirty) return;
        }

        this.currentSavePromise = (async () => {
            try {
                const collectionsPath = path.join(this.dataDir, 'collections.json');
                // Write to temp file then rename for atomic write
                const tempPath = `${collectionsPath}.tmp`;
                await fs.promises.writeFile(tempPath, JSON.stringify(this.collections, null, 2), 'utf-8');
                await fs.promises.rename(tempPath, collectionsPath);
                this.isDirty = false;
                logger.debug(`Persisted ${this.collections.length} collections.`);
            } catch (error) {
                logger.error('Error saving collections:', error);
            } finally {
                this.currentSavePromise = null;
            }
        })();

        return this.currentSavePromise;
    }

    public async updateCollection(symbol: string, updates: Partial<CollectionMetadata>) {
        const col = this.collections.find(c => c.symbol === symbol);
        if (col) {
            Object.assign(col, updates);
            this.isDirty = true;
            await this.saveCollections(); // Save immediately for critical updates
        }
    }

    public async addCollection(metadata: any) {
        // Remove existing if any
        this.collections = this.collections.filter(c => c.symbol !== metadata.symbol);
        this.collections.push(metadata);

        // Load its database immediately
        this.loadDatabase(metadata.symbol);

        this.isDirty = true;
        await this.saveCollections();
        logger.info(`Added/Updated collection: ${metadata.symbol}`);
    }

    public async removeCollection(symbol: string) {
        this.collections = this.collections.filter(c => c.symbol !== symbol);
        this.itemDatabases.delete(symbol);
        this.isDirty = true;
        await this.saveCollections();
        logger.info(`Removed collection: ${symbol}`);
    }

    public getTraits(symbol: string): Record<string, Record<string, number>> {
        const db = this.itemDatabases.get(symbol);
        if (!db) return {};

        const traits: Record<string, Record<string, number>> = {};

        Object.values(db).forEach(item => {
            if (item.attributes) {
                Object.entries(item.attributes).forEach(([key, value]) => {
                    // key is already normalized to lowercase in setupManager
                    // but let's be safe and keep it consistent
                    if (!traits[key]) traits[key] = {};
                    if (!traits[key][value]) traits[key][value] = 0;
                    traits[key][value]++;
                });
            }
        });

        return traits;
    }

    public getFullDatabase(symbol: string): Record<string, ItemMetadata> | undefined {
        return this.itemDatabases.get(symbol);
    }
}
