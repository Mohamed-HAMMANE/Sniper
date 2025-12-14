
import * as fs from 'fs';
import * as path from 'path';
import { CollectionService } from './collectionService';
import { SSEBroadcaster } from '../api/sseEndpoint';

interface PreviewData {
    name: string;
    image: string;
    type: 'standard' | 'core';
    address: string;
}

export class SetupManager {
    private apiKey: string;
    private rpcUrl: string;
    private dataDir: string;
    private collectionService: CollectionService;
    private broadcaster: SSEBroadcaster;

    constructor(collectionService: CollectionService, broadcaster: SSEBroadcaster) {
        this.rpcUrl = process.env.RPC_URL || '';
        this.apiKey = this.rpcUrl.split('api-key=')[1] || '';
        this.dataDir = path.join(__dirname, '../../data');
        this.collectionService = collectionService;
        this.broadcaster = broadcaster;
    }

    /**
     * Preview: Fetches 1 item to detect Name, Image, Type
     */
    public async previewCollection(address: string): Promise<PreviewData> {
        try {
            console.log(`[SetupManager] Previewing address: ${address}`);

            // Fetch only 1 item
            // Use RPC_URL directly
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'preview',
                    method: 'getAssetsByGroup',
                    params: {
                        groupKey: 'collection',
                        groupValue: address,
                        page: 1,
                        limit: 1
                    }
                }),
            });

            const data: any = await response.json();
            const result = data.result;
            if (!result || !result.items || result.items.length === 0) {
                throw new Error('No items found for this collection address');
            }

            const item = result.items[0];
            const nameFull = item.content.metadata.name || 'Unknown Collection';
            // Simple logic: "Goblin #342" -> "Goblin"
            const name = nameFull.split('#')[0].trim();

            const image = item.content.files?.[0]?.uri || item.content.links?.image || '';
            const type = item.interface === 'MplCore' ? 'core' : 'standard';

            return { name, image, type, address };

        } catch (error: any) {
            console.error('[SetupManager] Preview failed:', error);
            throw new Error(`Preview failed: ${error.message}`);
        }
    }


    /**
     * Init: Downloads items, Calcs Rarity, Filters by MinRarity, Updates Webhook, Saves DB
     */
    public async initializeCollection(symbol: string, address: string, name: string, image: string, type: 'standard' | 'core', minRarity: string) {
        this.runInitializationProcess(symbol, address, name, image, type, minRarity).catch(err => {
            console.error(`[SetupManager] Initialization failed for ${symbol}:`, err);
            this.broadcaster.broadcastMessage('setup_error', { symbol, error: err.message });
        });
    }

    private async runInitializationProcess(symbol: string, address: string, name: string, image: string, type: 'standard' | 'core', minRarity: string) {
        console.log(`[SetupManager] Starting initialization for ${symbol} (Min Rarity: ${minRarity})...`);
        this.broadcaster.broadcastMessage('setup_progress', { symbol, percent: 0, message: 'Starting download...' });

        // 1. Download All Items
        const allItems = [];
        let page = 1;
        while (true) {
            try {
                this.broadcaster.broadcastMessage('setup_progress', {
                    symbol,
                    percent: 10,
                    message: `Fetching page ${page} (${allItems.length} items)...`
                });

                const response = await fetch(this.rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0', id: 'init', method: 'getAssetsByGroup',
                        params: { groupKey: 'collection', groupValue: address, page: page, limit: 1000 }
                    }),
                });

                const data: any = await response.json();
                const result = data.result;
                if (!result?.items?.length) break;

                allItems.push(...result.items);
                if (result.items.length < 1000) break;
                page++;

            } catch (e) {
                console.error(e);
                throw new Error('Helius API Fetch Error');
            }
        }

        console.log(`[SetupManager] Downloaded ${allItems.length} items.`);
        this.broadcaster.broadcastMessage('setup_progress', { symbol, percent: 50, message: `Analyzing ${allItems.length} items...` });

        // 2. Normalize Traits & Calculate Rarity
        const totalItems = allItems.length;
        const allTraitTypes = new Set<string>();

        // Pass 1: Collect Types
        allItems.forEach(item => {
            const attrs = item.content.metadata.attributes || [];
            attrs.forEach((a: any) => {
                if (a.trait_type) allTraitTypes.add(String(a.trait_type).trim().toLowerCase());
            });
        });

        // Pass 2: Count Frequencies
        const traitCounts: Record<string, Record<string, number>> = {};
        allTraitTypes.forEach(type => traitCounts[type] = {});
        traitCounts["Trait Count"] = {};

        allItems.forEach(item => {
            const attrs = item.content.metadata.attributes || [];
            const activeAttrs = attrs.filter((a: any) => a.value && String(a.value).trim().toLowerCase() !== "none");
            const countVal = activeAttrs.length.toString();

            traitCounts["Trait Count"][countVal] = (traitCounts["Trait Count"][countVal] || 0) + 1;

            allTraitTypes.forEach(type => {
                const found = attrs.find((a: any) => String(a.trait_type).trim().toLowerCase() === type);
                const value = found && found.value ? String(found.value).trim().toLowerCase() : "none";
                if (!traitCounts[type][value]) traitCounts[type][value] = 0;
                traitCounts[type][value]++;
            });
        });

        // Pass 3: Score
        const scoredItems = allItems.map(item => {
            const attrs = item.content.metadata.attributes || [];
            let itemName = (item.content.metadata.name || '').trim();
            if (!itemName) itemName = name;

            let score_additive = 0;
            let score_statistical = 1;

            // Additive
            const activeAttrs = attrs.filter((a: any) => a.value && String(a.value).trim().toLowerCase() !== "none");
            const countVal = activeAttrs.length.toString();
            const countFreq = traitCounts["Trait Count"][countVal];
            if (countFreq) score_additive += 1 / (countFreq / totalItems);

            allTraitTypes.forEach(type => {
                const found = attrs.find((a: any) => String(a.trait_type).trim().toLowerCase() === type);
                const value = found && found.value ? String(found.value).trim().toLowerCase() : "none";
                const freq = traitCounts[type][value];
                if (freq) {
                    score_additive += 1 / (freq / totalItems);
                    score_statistical *= (freq / totalItems);
                }
            });

            const itemObj = {
                mint: item.id,
                name: itemName,
                image: item.content.files?.[0]?.uri || item.content.links?.image,
                score_additive: score_additive,
                score_statistical: score_statistical,
                rank_additive: 0,
                tier_additive: '',
                rank_statistical: 0,
                tier_statistical: '',
                attributes: {} as Record<string, string>
            };

            // Save traits to item for filtering
            allTraitTypes.forEach(type => {
                const found = attrs.find((a: any) => String(a.trait_type).trim().toLowerCase() === type);
                if (found && found.value) {
                    itemObj.attributes[type] = String(found.value).trim();
                }
            });

            return itemObj;
        });

        // 3. Rank & Tier
        const getTier = (rank: number, total: number) => {
            const percentile = (rank / total) * 100;
            if (percentile <= 1) return "MYTHIC";
            if (percentile <= 5) return "LEGENDARY";
            if (percentile <= 15) return "EPIC";
            if (percentile <= 35) return "RARE";
            if (percentile <= 60) return "UNCOMMON";
            return "COMMON";
        };

        // Rank Additive (High Score = Rare)
        scoredItems.sort((a, b) => b.score_additive - a.score_additive);
        scoredItems.forEach((item, index) => {
            item.rank_additive = index + 1;
            item.tier_additive = getTier(index + 1, totalItems);
        });

        // Rank Statistical (Low Score = Rare)
        scoredItems.sort((a, b) => a.score_statistical - b.score_statistical);
        scoredItems.forEach((item, index) => {
            item.rank_statistical = index + 1;
            item.tier_statistical = getTier(index + 1, totalItems);
        });

        // 4. Save COMPLETE Database (Local Reference)
        const finalDatabase: Record<string, any> = {};
        scoredItems.forEach(item => {
            finalDatabase[item.mint] = {
                name: item.name,
                image: item.image,
                collection: symbol,
                rank_additive: item.rank_additive,
                tier_additive: item.tier_additive,
                score_additive: item.score_additive,
                rank_statistical: item.rank_statistical,
                tier_statistical: item.tier_statistical,
                score_statistical: item.score_statistical,
                attributes: item.attributes
            };
        });

        const dbPath = path.join(this.dataDir, `${symbol}.json`);
        await fs.promises.writeFile(dbPath, JSON.stringify(finalDatabase, null, 2));


        // 5. UPDATE WEBOOK - Filter Mints by Min Rarity
        this.broadcaster.broadcastMessage('setup_progress', { symbol, percent: 80, message: 'Updating Webhook...' });

        const rarityOrder: Record<string, number> = { 'COMMON': 0, 'UNCOMMON': 1, 'RARE': 2, 'EPIC': 3, 'LEGENDARY': 4, 'MYTHIC': 5 };
        const minRarityVal = rarityOrder[minRarity] || 0;

        // Filter mints: Keep if tier >= minRarity
        const filteredMints = scoredItems
            .filter(item => {
                const tierVal = rarityOrder[item.tier_statistical] || 0;
                return tierVal >= minRarityVal;
            })
            .map(item => item.mint);

        console.log(`[SetupManager] Filtered ${filteredMints.length} mints for webhook (Min: ${minRarity})`);

        await this.updateHeliusWebhook(filteredMints);


        // 6. Update Collections List
        const collectionsPath = path.join(this.dataDir, 'collections.json');
        let collections = [];
        try {
            if (fs.existsSync(collectionsPath)) {
                collections = JSON.parse(fs.readFileSync(collectionsPath, 'utf-8'));
            }
        } catch (e) { }

        // Remove existing if present
        collections = collections.filter((c: any) => c.symbol !== symbol);
        collections.push({
            symbol,
            name,
            address,
            image: image,
            floorPrice: 0,
            count: totalItems,
            type: type,
            minRarity // Store this preference
        });

        await fs.promises.writeFile(collectionsPath, JSON.stringify(collections, null, 2));

        // 7. Finish
        this.collectionService.loadCollections();

        this.broadcaster.broadcastMessage('setup_complete', { symbol, count: totalItems });
        console.log(`[SetupManager] Setup complete for ${symbol}`);
    }

    private async updateHeliusWebhook(newMints: string[]) {
        const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.PUBLIC_URL + '/webhook';
        if (!process.env.PUBLIC_URL && !process.env.WEBHOOK_URL) {
            console.warn('[SetupManager] No WEBHOOK_URL defined. Skipping webhook update.');
            return;
        }

        try {
            // 1. Get existing webhooks
            const listResp = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`);
            const webhooks = await listResp.json() as any[];

            let targetWebhook = webhooks.find((w: any) => w.webhookURL === WEBHOOK_URL);

            if (targetWebhook) {
                // UPDATE existing
                console.log(`[SetupManager] Updating existing webhook: ${targetWebhook.webhookID}`);

                // Fetch FULL details to get accountAddresses (sometimes missing in list view)
                try {
                    const detailResp = await fetch(`https://api.helius.xyz/v0/webhooks/${targetWebhook.webhookID}?api-key=${this.apiKey}`);
                    const detailData = await detailResp.json() as any;
                    if (detailData && detailData.accountAddresses) {
                        targetWebhook.accountAddresses = detailData.accountAddresses;
                    }
                } catch (err) {
                    console.warn('[SetupManager] Failed to fetch webhook details, assuming empty addresses.', err);
                }

                // Merge new mints with existing
                const existingMints = new Set(targetWebhook.accountAddresses || []);
                newMints.forEach(m => existingMints.add(m));
                const updatedMints = Array.from(existingMints);

                // Helius limit is 100k addresses per webhook usually.
                if (updatedMints.length > 100000) {
                    console.warn('[SetupManager] Warning: Webhook address count exceeding 100k. Truncating not implemented yet.');
                }

                await fetch(`https://api.helius.xyz/v0/webhooks/${targetWebhook.webhookID}?api-key=${this.apiKey}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        webhookURL: WEBHOOK_URL,
                        transactionTypes: ['ANY'], // Raw webhook requires broadly compatible types
                        accountAddresses: updatedMints,
                        webhookType: 'raw', // Changed from 'enhanced' for speed
                        txnStatus: 'success' // Only successful txns
                    })
                });

            } else {
                // CREATE new
                console.log(`[SetupManager] Creating NEW webhook for ${WEBHOOK_URL}`);
                await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        webhookURL: WEBHOOK_URL,
                        transactionTypes: ['ANY'],
                        accountAddresses: newMints,
                        webhookType: 'raw',
                        txnStatus: 'success'
                    })
                });
            }
            console.log('[SetupManager] Webhook updated successfully.');

        } catch (e: any) {
            console.error('[SetupManager] Failed to update Helius webhook:', e.message);
            // Non-blocking error, but important (user wont get alerts if this fails)
            this.broadcaster.broadcastMessage('setup_progress', {
                symbol: 'WARN',
                percent: 90,
                message: 'Webhook update failed Check logs.'
            });
        }
    }
}
