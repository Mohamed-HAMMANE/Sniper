import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { decodeBase58 } from '../utils/base58';
import { SSEBroadcaster } from '../api/sseEndpoint';

export class BalanceMonitor {
    private connection: Connection;
    private broadcaster: SSEBroadcaster;
    private walletPublicKey: PublicKey;
    private currentBalance: number = 0;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(rpcUrl: string, broadcaster: SSEBroadcaster, publicRpcUrl?: string) {
        // Use Public RPC for polling if available, otherwise fallback to main RPC
        const urlToUse = publicRpcUrl || rpcUrl;
        this.connection = new Connection(urlToUse, 'confirmed');

        if (publicRpcUrl) {
            console.log(`[BalanceMonitor] Using Public RPC for updates: ${publicRpcUrl}`);
        }

        this.broadcaster = broadcaster;

        // Load Wallet Public Key
        const BURNER_KEY_RAW = process.env.BURNER_WALLET_PRIVATE_KEY || '';
        if (!BURNER_KEY_RAW) throw new Error('Missing BURNER_WALLET_PRIVATE_KEY');

        let secretKey: Uint8Array;
        if (BURNER_KEY_RAW.trim().startsWith('[')) secretKey = Uint8Array.from(JSON.parse(BURNER_KEY_RAW));
        else secretKey = decodeBase58(BURNER_KEY_RAW);

        this.walletPublicKey = Keypair.fromSecretKey(secretKey).publicKey;

        this.startPolling();
    }

    private startPolling() {
        this.refreshBalance();
        // Poll every 60 seconds
        this.intervalId = setInterval(() => this.refreshBalance(), 60 * 1000);
    }

    public async refreshBalance() {
        try {
            const lamports = await this.connection.getBalance(this.walletPublicKey);
            this.currentBalance = lamports / LAMPORTS_PER_SOL;
            // console.log(`[Balance] Updated: ${this.currentBalance.toFixed(3)} SOL`);

            // Broadcast update
            this.broadcaster.broadcastMessage('balanceUpdate', { balance: this.currentBalance });
        } catch (error) {
            console.error('[Balance] Failed to update:', error);
        }
    }

    public getBalance(): number {
        return this.currentBalance;
    }

    public decreaseBalance(amount: number) {
        this.currentBalance -= amount;
        // Broadcast update immediately so UI reflects the change
        this.broadcaster.broadcastMessage('balanceUpdate', { balance: this.currentBalance });
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
