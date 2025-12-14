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

    constructor(rpcUrl: string) {
        this.rpcUrl = rpcUrl;
        // We need a connection to get latest blockhash for the tip tx
        // Ideally this should be passed in or reused, but creating one for now is safe for low frequency
        this.connection = new Connection(rpcUrl);
    }

    private getRandomTipAccount(): PublicKey {
        const accountStr = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
        return new PublicKey(accountStr);
    }

    // Sends a bundle with the core transaction AND a tip transaction
    async sendBundle(transaction: VersionedTransaction, signer: Keypair, tipLamports: number, latestBlockhash?: string): Promise<string> {
        try {
            // 1. Create Tip Transaction
            const tipAccount = this.getRandomTipAccount();
            console.log(`[Jito] Adding tip of ${tipLamports} lamports to ${tipAccount.toBase58()}`);

            const tipIx = SystemProgram.transfer({
                fromPubkey: signer.publicKey,
                toPubkey: tipAccount,
                lamports: tipLamports
            });

            // Get latest blockhash for tip tx
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

            // 2. Serialize Transactions
            const serializedBuyTx = transaction.serialize();
            const serializedTipTx = tipTx.serialize();

            const b64BuyTx = Buffer.from(serializedBuyTx).toString('base64');
            const b64TipTx = Buffer.from(serializedTipTx).toString('base64');

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

            console.log(`[Jito] Sending bundle to ${JITO_URL}...`);

            const response = await fetch(`${JITO_URL}/api/v1/bundles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Jito HTTP Error: ${response.status} ${response.statusText}`);
            }

            const data: any = await response.json();

            if (data.error) {
                throw new Error(`Jito API Error: ${JSON.stringify(data.error)}`);
            }

            const bundleId = data.result;
            console.log(`[Jito] Bundle Sent! ID: ${bundleId}`);
            return bundleId;
        } catch (error: any) {
            console.error('[Jito] Failed to send bundle:', error.message);
            throw error;
        }
    }
}
