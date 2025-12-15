
import * as fs from 'fs';
import * as path from 'path';

interface HistoryPoint {
    t: number; // timestamp (seconds)
    p: number; // price (SOL)
}

export class HistoryService {
    private dataDir: string;

    constructor() {
        this.dataDir = path.join(__dirname, '../../data/history');
        this.ensureDir();
    }

    private ensureDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    public async addPoint(symbol: string, price: number): Promise<void> {
        const filePath = path.join(this.dataDir, `${symbol}.json`);
        let history: HistoryPoint[] = [];


        // Load existing
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                history = JSON.parse(raw);
            } catch (e) {
                console.error(`[History] Error reading ${symbol}:`, e);
            }
        }

        // Optimization: Only save if price changed significantly (>= 1.5%)
        // This prevents saving duplicates while capturing meaningful moves on low-value collections
        if (history.length > 0) {
            const lastPoint = history[history.length - 1];
            const diff = Math.abs(price - lastPoint.p);
            const percentChange = diff / lastPoint.p;

            // If change is less than 1.5%, ignore it
            if (percentChange < 0.015) {
                return;
            }
        }

        // Add new point
        history.push({
            t: Math.floor(Date.now() / 1000),
            p: price
        });

        // Optional: Prune old data (e.g., keep last 10,000 points ~ 1 week at 1/min)
        if (history.length > 10000) {
            history = history.slice(-10000);
        }

        // Save
        try {
            fs.writeFileSync(filePath, JSON.stringify(history)); // Minify to save space
        } catch (e) {
            console.error(`[History] Error saving ${symbol}:`, e);
        }
    }

    public getHistory(symbol: string): HistoryPoint[] {
        const filePath = path.join(this.dataDir, `${symbol}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(raw);
            } catch (e) {
                return [];
            }
        }
        return [];
    }
}
