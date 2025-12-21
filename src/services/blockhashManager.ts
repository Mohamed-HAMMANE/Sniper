import { Connection, BlockhashWithExpiryBlockHeight } from '@solana/web3.js';
import { logger } from '../utils/logger';

export class BlockhashManager {
    private connection: Connection;
    private latestBlockhash: BlockhashWithExpiryBlockHeight | null = null;
    private intervalId: NodeJS.Timeout | null = null;
    private readonly POLL_INTERVAL_MS = 10000; // Poll every 10s (safe for public RPCs)

    constructor(rpcUrl: string, publicRpcUrl?: string) {
        // Use Public RPC for polling if available, otherwise fallback to main RPC
        const urlToUse = publicRpcUrl || rpcUrl;
        this.connection = new Connection(urlToUse, 'confirmed');

        if (publicRpcUrl) {
            logger.debug(`BlockhashManager: Using Public RPC for blockhash updates: ${publicRpcUrl}`);
        }

        this.startPolling();
    }

    private startPolling() {
        // Initial fetch
        this.fetchBlockhash();

        this.intervalId = setInterval(() => {
            this.fetchBlockhash();
        }, this.POLL_INTERVAL_MS);
    }

    private async fetchBlockhash() {
        try {
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
            this.latestBlockhash = { blockhash, lastValidBlockHeight };
            logger.debug(`Blockhash Updated: ${blockhash.slice(0, 8)}...`);
        } catch (error) {
            logger.error('Failed to update blockhash:', error);
        }
    }

    public getLatestBlockhash(): BlockhashWithExpiryBlockHeight | null {
        return this.latestBlockhash;
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
