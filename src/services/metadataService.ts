import * as fs from 'fs';
import * as path from 'path';

export interface LocalMetadata {
    name: string;
    rank: number;
    tier: string;
    image: string;
}

export class MetadataService {
    private db: Record<string, LocalMetadata> = {};
    private isLoaded = false;

    constructor() {
        this.loadDatabase();
    }

    public loadDatabase(): void {
        try {
            const dbPath = path.join(process.cwd(), 'database.json');
            if (fs.existsSync(dbPath)) {
                const rawData = fs.readFileSync(dbPath, 'utf-8');
                this.db = JSON.parse(rawData);
                this.isLoaded = true;
                console.log(`[Metadata] Loaded ${Object.keys(this.db).length} items from database.json`);
            } else {
                console.warn('[Metadata] database.json not found. Local lookups will fail.');
            }
        } catch (error) {
            console.error('[Metadata] Failed to load database.json:', error);
        }
    }

    public getMetadata(mint: string): LocalMetadata | undefined {
        return this.db[mint];
    }
}
