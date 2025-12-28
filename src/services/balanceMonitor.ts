import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { decodeBase58 } from '../utils/base58';
import { SSEBroadcaster } from '../api/sseEndpoint';
import { logger } from '../utils/logger';
import { TelegramService } from './telegramService';
import * as fs from 'fs';
import * as path from 'path';

interface BalanceSnapshot {
    [address: string]: number;
}

export class BalanceMonitor {
    private connection: Connection;
    private broadcaster: SSEBroadcaster;
    private telegramService: TelegramService;

    private sniperWalletPubkey: PublicKey;
    private allMonitoredAddresses: PublicKey[] = [];

    // State
    private currentSniperBalance: number = 0; // For UI (Preserved)
    private addressToBalance: Map<string, number> = new Map();
    private lastGrandTotal: number | null = null;

    // Config
    private changeThreshold: number;
    private dataDir: string;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(rpcUrl: string, broadcaster: SSEBroadcaster, publicRpcUrl?: string) {
        // Use Public RPC for polling if available, otherwise fallback to main RPC
        const urlToUse = publicRpcUrl || rpcUrl;
        this.connection = new Connection(urlToUse, 'confirmed');

        if (publicRpcUrl) {
            logger.debug(`BalanceMonitor: Using Public RPC for updates: ${publicRpcUrl}`);
        }

        this.broadcaster = broadcaster;
        this.telegramService = new TelegramService();
        this.dataDir = path.join(__dirname, '../../data');

        // Safety: Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            try {
                fs.mkdirSync(this.dataDir, { recursive: true });
            } catch (e) {
                logger.error('Failed to create data directory:', e);
            }
        }

        this.changeThreshold = parseFloat(process.env.BALANCE_CHANGE_THRESHOLD || '0.001');

        // 1. Load Sniper Wallet
        const BURNER_KEY_RAW = process.env.BURNER_WALLET_PRIVATE_KEY || '';
        if (!BURNER_KEY_RAW) throw new Error('Missing BURNER_WALLET_PRIVATE_KEY');

        let secretKey: Uint8Array;
        if (BURNER_KEY_RAW.trim().startsWith('[')) secretKey = Uint8Array.from(JSON.parse(BURNER_KEY_RAW));
        else secretKey = decodeBase58(BURNER_KEY_RAW);

        this.sniperWalletPubkey = Keypair.fromSecretKey(secretKey).publicKey;

        // 2. Load Watch Wallets
        this.loadMonitoredWallets();

        // 3. Load Persistence
        this.loadSnapshot();

        this.startPolling();
    }

    private loadMonitoredWallets() {
        const watchList = process.env.WATCH_WALLETS || '';
        const extras: PublicKey[] = [];

        if (watchList) {
            watchList.split(',').forEach(addr => {
                try {
                    const trimmed = addr.trim();
                    if (trimmed) extras.push(new PublicKey(trimmed));
                } catch (e) {
                    logger.warn(`Invalid watch wallet address: ${addr}`);
                }
            });
        }

        // Combine Sniper Wallet + Extras
        // Use Set to dedup in case user puts sniper wallet in watch list
        const uniqueKeys = new Set<string>();
        uniqueKeys.add(this.sniperWalletPubkey.toBase58());
        extras.forEach(k => uniqueKeys.add(k.toBase58()));

        this.allMonitoredAddresses = Array.from(uniqueKeys).map(s => new PublicKey(s));
        logger.info(`BalanceMonitor: Watching ${this.allMonitoredAddresses.length} wallets (Sniper + ${extras.length} Parsed Extra).`);
    }

    private parseSnapshot(json: string): BalanceSnapshot {
        try {
            return JSON.parse(json);
        } catch {
            return {};
        }
    }

    private loadSnapshot() {
        try {
            const filePath = path.join(this.dataDir, 'balances.json');
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                const snapshot = this.parseSnapshot(data);

                let loadedTotal = 0;
                let count = 0;

                // Initialize internal map from file
                for (const [addr, bal] of Object.entries(snapshot)) {
                    this.addressToBalance.set(addr, bal);

                    // Only count towards total if it's still in our monitored list
                    // (Handle case where user removed a wallet from config)
                    if (this.allMonitoredAddresses.some(k => k.toBase58() === addr)) {
                        loadedTotal += bal;
                        count++;
                    }
                }

                // Set initial total if we loaded relevant data
                if (count > 0) {
                    this.lastGrandTotal = loadedTotal;
                    // Also set sniper balance specifically for UI
                    const sniperBal = snapshot[this.sniperWalletPubkey.toBase58()];
                    if (sniperBal !== undefined) this.currentSniperBalance = sniperBal;
                }
            }
        } catch (e) {
            logger.error('Failed to load balance snapshot:', e);
        }
    }

    private startPolling() {
        this.refreshBalance();
        // Poll every 60 seconds
        this.intervalId = setInterval(() => this.refreshBalance(), 60 * 1000);
    }

    public async refreshBalance() {
        try {
            // Batch Request: Get Info for ALL accounts in one go
            // RPC Limit Safety: Split into chunks of 100 (Standard RPC limit)
            const CHUNK_SIZE = 100;
            const chunks: PublicKey[][] = [];
            for (let i = 0; i < this.allMonitoredAddresses.length; i += CHUNK_SIZE) {
                chunks.push(this.allMonitoredAddresses.slice(i, i + CHUNK_SIZE));
            }

            const accountInfos: any[] = [];
            for (const chunk of chunks) {
                // Execute chunk fetch
                const results = await this.connection.getMultipleAccountsInfo(chunk);
                accountInfos.push(...results);
            }

            let newGrandTotal = 0;
            const updates: BalanceSnapshot = {};

            // Process Results
            accountInfos.forEach((info, index) => {
                const pubkey = this.allMonitoredAddresses[index];
                const addrStr = pubkey.toBase58();

                const lamports = info ? info.lamports : 0;
                const solBalance = lamports / LAMPORTS_PER_SOL;

                // Update Local Map
                this.addressToBalance.set(addrStr, solBalance);
                updates[addrStr] = solBalance;

                newGrandTotal += solBalance;

                // Update Sniper Specific Balance (For UI compatibility)
                if (addrStr === this.sniperWalletPubkey.toBase58()) {
                    this.currentSniperBalance = solBalance;
                }
            });

            // Check for Significant Change
            if (this.lastGrandTotal !== null) {
                const diff = newGrandTotal - this.lastGrandTotal;

                if (Math.abs(diff) >= this.changeThreshold) {
                    logger.info(`Portfolio Change Detected: ${diff > 0 ? '+' : ''}${diff.toFixed(4)} SOL`);

                    // 1. Notify Telegram (Fire and Forget)
                    this.telegramService.sendPortfolioUpdate(newGrandTotal, diff);

                    // 2. Log History
                    this.logHistory(newGrandTotal);
                }
            } else {
                // First Run ever (or fresh data delete) - just set total
                logger.debug('Initial Portfolio Balance Established');
            }

            // Always update lastGrandTotal
            this.lastGrandTotal = newGrandTotal;

            // Broadcast update to UI (Sniper balance only, to preserve frontend)
            this.broadcaster.broadcastMessage('balanceUpdate', { balance: this.currentSniperBalance });

            // Save Snapshot (Async)
            this.saveSnapshot(updates);

        } catch (error) {
            logger.error('Balance update failed:', error);
        }
    }

    // Async File I/O (Non-Blocking)
    private async saveSnapshot(snapshot: BalanceSnapshot) {
        try {
            const filePath = path.join(this.dataDir, 'balances.json');
            await fs.promises.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
        } catch (e) {
            logger.error('Failed to save balance snapshot:', e);
        }
    }

    private async logHistory(total: number) {
        try {
            // Use NDJSON (Line-delimited JSON) for O(1) performance
            // Simple append, no read-parse-write cycle needed.
            const filePath = path.join(this.dataDir, 'balance_history.json');
            const entry = {
                timestamp: Date.now(),
                total: total
            };

            const line = JSON.stringify(entry) + '\n';
            await fs.promises.appendFile(filePath, line, 'utf-8');
        } catch (e) {
            logger.error('Failed to save balance history:', e);
        }
    }

    public getBalance(): number {
        return this.currentSniperBalance;
    }

    public getWalletAddress(): string {
        return this.sniperWalletPubkey.toBase58();
    }

    public decreaseBalance(amount: number) {
        // Optimistic update for Sniper wallet
        this.currentSniperBalance -= amount;

        // Also update Grand Total optimistically roughly
        if (this.lastGrandTotal !== null) {
            this.lastGrandTotal -= amount;
        }

        // Broadcast update immediately so UI reflects the change
        this.broadcaster.broadcastMessage('balanceUpdate', { balance: this.currentSniperBalance });
    }

    public increaseBalance(amount: number) {
        this.currentSniperBalance += amount;

        if (this.lastGrandTotal !== null) {
            this.lastGrandTotal += amount;
        }

        this.broadcaster.broadcastMessage('balanceUpdate', { balance: this.currentSniperBalance });
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
