import { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, Transaction, Message } from '@solana/web3.js';
import bs58 from 'bs58';

// Jito Block Engine URLs
const BLOCK_ENGINE_URLS = {
    amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
    frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
    ny: 'https://ny.mainnet.block-engine.jito.wtf',
    tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
};

// Common Jito Tip Accounts (from official Jito docs 2024)
const JITO_TIP_ACCOUNTS = [
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvQKNWKkC5wPdSSdeBnizKZ6jT'
];

// Default to NY for now, or make configurable
const JITO_URL = BLOCK_ENGINE_URLS.ny;

export class JitoService {
    private rpcUrl: string;
    private connection: Connection;
    private publicConnection: Connection | null = null;
    private cachedTipTx: string | null = null;
    private cachedBlockhash: string | null = null;
    private cachedTipLamports: number = 0;

    constructor(rpcUrl: string, publicRpcUrl?: string) {
        this.rpcUrl = rpcUrl;
        this.connection = new Connection(rpcUrl, 'confirmed');

        if (publicRpcUrl) {
            console.log(`[JitoService] Using Public RPC for Tip Warmer: ${publicRpcUrl}`);
            this.publicConnection = new Connection(publicRpcUrl, 'confirmed');
        }
    }

    private getRandomTipAccount(): PublicKey {
        const accountStr = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
        return new PublicKey(accountStr);
    }

    // Background Warmer: Pre-signs the tip transaction to save CPU at snipe time
    public startTipWarmer(signer: Keypair, tipLamports: number) {
        console.log(`[Jito] Starting Tip Warmer for ${tipLamports} lamports...`);
        this.updateCachedTip(signer, tipLamports);

        // Update every 30 seconds (Blockhashes last ~60s, so this is safe)
        setInterval(() => {
            this.updateCachedTip(signer, tipLamports);
        }, 30000);
    }

    private async updateCachedTip(signer: Keypair, tipLamports: number) {
        try {
            // Use Public RPC if available, otherwise Main RPC
            const conn = this.publicConnection || this.connection;
            const { blockhash } = await conn.getLatestBlockhash('confirmed');

            // Build Tip Tx
            const tipAccount = this.getRandomTipAccount();
            const tipIx = SystemProgram.transfer({
                fromPubkey: signer.publicKey,
                toPubkey: tipAccount,
                lamports: tipLamports
            });

            const tipTx = new Transaction();
            tipTx.recentBlockhash = blockhash;
            tipTx.feePayer = signer.publicKey;
            tipTx.add(tipIx);
            tipTx.sign(signer);

            const serialized = tipTx.serialize();
            this.cachedTipTx = Buffer.from(serialized).toString('base64');
            this.cachedBlockhash = blockhash;
            this.cachedTipLamports = tipLamports;

            // console.log(`[Jito] Internal Warmer: Tip refreshed (Blockhash: ${blockhash.slice(0, 8)}...)`);
        } catch (e: any) {
            console.error('[Jito] Warmer Failed:', e.message);
        }
    }

    // Sends a bundle with the core transaction AND a tip transaction
    async sendBundle(transaction: VersionedTransaction, signer: Keypair, tipLamports: number, latestBlockhash?: string): Promise<string> {
        try {
            let b64TipTx = '';

            // Optimization: Use Cached Tip if available and matches request
            if (this.cachedTipTx && this.cachedTipLamports === tipLamports) {
                // Check if blockhash provided matches our cache, or if none provided (optimistic)
                // Actually, for the Tip Tx, it effectively stands alone in the bundle.
                // We just use the pre-signed valid one.
                b64TipTx = this.cachedTipTx;
                // console.log('[Jito] FAST PATH: Using Pre-Signed Tip Transaction');
            } else {
                console.log('[Jito] SLOW PATH: Signing new Tip Transaction...');
                // 1. Create Tip Transaction (Fallback)
                const tipAccount = this.getRandomTipAccount();
                // ... (Original logic logic)

                const tipIx = SystemProgram.transfer({
                    fromPubkey: signer.publicKey,
                    toPubkey: tipAccount,
                    lamports: tipLamports
                });

                // Get latest blockhash for tip tx if NOT cached
                let blockhash = '';
                if (latestBlockhash) {
                    blockhash = latestBlockhash;
                } else {
                    const res = await this.connection.getLatestBlockhash('confirmed');
                    blockhash = res.blockhash;
                }

                const tipTx = new Transaction();
                tipTx.recentBlockhash = blockhash;
                tipTx.feePayer = signer.publicKey;
                tipTx.add(tipIx);
                tipTx.sign(signer);

                b64TipTx = Buffer.from(tipTx.serialize()).toString('base64');
            }

            // 2. Serialize Transactions
            const serializedBuyTx = transaction.serialize();
            // (tip already serialized)

            const b64BuyTx = Buffer.from(serializedBuyTx).toString('base64');
            // const b64TipTx = ... (Ready)

            // 3. Construct Bundle
            const payload = {
                jsonrpc: '2.0',
                id: 1,
                method: 'sendBundle',
                params: [
                    [b64BuyTx, b64TipTx], // Order matters: Buy first, then Tip
                    {
                        encoding: 'base64',
                    }
                ]
            };

            const endpoints = Object.values(BLOCK_ENGINE_URLS);
            console.log(`[Jito] Shotgun! Sending to ${endpoints.length} regions simultaneously...`);

            // Helper to send to one endpoint
            const sendToEndpoint = async (url: string): Promise<string> => {
                try {
                    // console.log(`[Jito] Sending to ${url}...`);
                    const response = await fetch(`${url}/api/v1/bundles`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data: any = await response.json();
                    if (data.error) throw new Error(JSON.stringify(data.error));

                    console.log(`[Jito] Success from ${url}`);
                    return data.result;
                } catch (err: any) {
                    // console.log(`[Jito] Error from ${url}: ${err.message}`);
                    throw err;
                }
            };

            // Promise.any polyfill behavior: Return first success, reject if ALL fail
            try {
                const bundleId = await Promise.any(endpoints.map(url => sendToEndpoint(url)));
                console.log(`[Jito] Bundle Accepted! ID: ${bundleId}`);
                return bundleId;
            } catch (aggregateError: any) {
                console.error('[Jito] All regions failed.');
                throw new Error('All Jito endpoints rejected the bundle (likely Rate Limited validation)');
            }
        } catch (error: any) {
            // If it was the AggregateError from Promise.any, we already logged it.
            // Just rethrow so server.ts knows to fallback.
            console.error('[Jito] Shotgun failed:', error.message);
            throw error;
        }
    }
}
