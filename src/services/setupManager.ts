
import * as fs from 'fs';
import * as path from 'path';
import { CollectionService } from './collectionService';
import { SSEBroadcaster } from '../api/sseEndpoint';

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
     * Stage 1: Search, Download, Analyze & Save DB. Does NOT update webhook.
     */
    public async downloadAndAnalyze(symbol: string, address: string, name: string, image: string, type: 'standard' | 'core') {
        this.runDownloadProcess(symbol, address, name, image, type).catch(err => {
            console.error(`[SetupManager] Download failed for ${symbol}:`, err);
            this.broadcaster.broadcastMessage('setup_error', { symbol, error: err.message });
        });
    }

    private async runDownloadProcess(symbol: string, address: string, name: string, image: string, type: 'standard' | 'core') {
        console.log(`[SetupManager] Starting download for ${symbol}...`);
        this.broadcaster.broadcastMessage('setup_progress', { symbol, percent: 0, message: 'Starting download...' });

        // 1. Download All Items
        const allItems = [];
        let page = 1;
        let isDone = false;
        while (!isDone) {
            let attempt = 0;
            const maxRetries = 3;
            let success = false;

            while (attempt < maxRetries && !success) {
                try {
                    this.broadcaster.broadcastMessage('setup_progress', {
                        symbol,
                        percent: 10 + (page * 2), // Slight increment
                        message: `Fetching page ${page}${attempt > 0 ? ` (Retry ${attempt})` : ''}...`
                    });

                    const response = await fetch(this.rpcUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            jsonrpc: '2.0', id: 'init', method: 'getAssetsByGroup',
                            params: { groupKey: 'collection', groupValue: address, page: page, limit: 1000 }
                        }),
                    });

                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                    const data: any = await response.json();
                    const result = data.result;

                    if (!result?.items) {
                        console.error('[SetupManager] Malformed Helius response:', data);
                        throw new Error('Malformed Helius response');
                    }

                    if (result.items.length > 0) {
                        allItems.push(...result.items);
                    }

                    success = true; // successfully fetched page

                    if (result.items.length < 1000) {
                        isDone = true; // Last page reached
                    } else {
                        page++;
                    }

                } catch (e: any) {
                    attempt++;
                    console.error(`[SetupManager] Fetch error (Page ${page}, Attempt ${attempt}):`, e.message);
                    if (attempt >= maxRetries) throw new Error(`Helius API Fetch Failure after ${maxRetries} retries: ${e.message}`);
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
            // If we exhausted retries without success, we should likely stop or throw.
            // The inner loop throws if maxRetries reached, catching it outside? 
            // The throw is inside the catch block, so execution bubbles up.
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
                const activeVal = found && found.value ? String(found.value).trim().toLowerCase() : "none";
                const freq = traitCounts[type][activeVal];
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

            // Save traits
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

        // Rank Additive
        scoredItems.sort((a, b) => b.score_additive - a.score_additive);
        scoredItems.forEach((item, index) => {
            item.rank_additive = index + 1;
            item.tier_additive = getTier(index + 1, totalItems);
        });

        // Rank Statistical
        scoredItems.sort((a, b) => a.score_statistical - b.score_statistical);
        scoredItems.forEach((item, index) => {
            item.rank_statistical = index + 1;
            item.tier_statistical = getTier(index + 1, totalItems);
        });

        // 4. Save COMPLETE Database
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

        const newColMetadata = {
            symbol,
            name,
            address,
            image: image,
            floorPrice: 0,
            count: totalItems,
            type: type,
            isSynced: false,
            countWatched: 0,
            filters: { minRarity: 'COMMON', traits: '' }
        };

        await this.collectionService.addCollection(newColMetadata);

        // Finish
        this.broadcaster.broadcastMessage('setup_complete', { symbol, count: totalItems });
        console.log(`[SetupManager] Download complete for ${symbol}`);
    }


    /**
     * Stage 2: Sync to Webhook
     * Reads local DB, Filters Mints, Updates Helius (Smart Merge)
     */
    public async syncCollection(symbol: string, minRarity: string, traitsInput: any, logicMode: 'AND' | 'OR' = 'AND') {
        console.log(`[SetupManager] Syncing ${symbol} (Min: ${minRarity}, Traits: ${traitsInput}, Logic: ${logicMode})...`);
        const rarityOrder: Record<string, number> = { 'COMMON': 0, 'UNCOMMON': 1, 'RARE': 2, 'EPIC': 3, 'LEGENDARY': 4, 'MYTHIC': 5 };
        const minRarityVal = rarityOrder[minRarity] || 0;

        // 1. Parse Traits (Support both structured object and legacy string)
        const traitReqs: Record<string, string[]> = {};
        if (typeof traitsInput === 'object' && traitsInput !== null) {
            // Structured Object format: { Type: [Val1, Val2] }
            Object.keys(traitsInput).forEach(cat => {
                const vals = traitsInput[cat];
                if (Array.isArray(vals) && vals.length > 0) {
                    traitReqs[cat.toLowerCase()] = vals.map(v => v.toLowerCase());
                }
            });
        } else if (typeof traitsInput === 'string' && traitsInput.trim().length > 0) {
            // Legacy String format: "Background: Red, Head: Crown"
            const parts = traitsInput.split(',').map(s => s.trim());
            for (const p of parts) {
                if (p.includes(':')) {
                    const [k, v] = p.split(':');
                    const cat = k.trim().toLowerCase();
                    if (!traitReqs[cat]) traitReqs[cat] = [];
                    traitReqs[cat].push(v.trim().toLowerCase());
                }
            }
        }

        const hasTraitFilters = Object.keys(traitReqs).length > 0;

        // 2. Load Local DB
        const dbPath = path.join(this.dataDir, `${symbol}.json`);
        if (!fs.existsSync(dbPath)) throw new Error(`Database for ${symbol} not found. Initialize first.`);
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        const allCollectionMints = Object.keys(db);

        // 3. Filter IDs
        const newWatchList: string[] = [];
        for (const mint of allCollectionMints) {
            const item = db[mint];

            // Rarity Check
            const tierVal = rarityOrder[item.tier_statistical] || 0;
            const matchesRarity = tierVal >= minRarityVal;

            // Trait Check
            let matchesTraits = false;
            if (hasTraitFilters) {
                const itemAttrs = item.attributes || {};
                // Normalize item attrs for check
                const normAttrs: Record<string, string> = {};
                Object.keys(itemAttrs).forEach(k => normAttrs[k.toLowerCase()] = itemAttrs[k].toString().toLowerCase());

                for (const cat of Object.keys(traitReqs)) {
                    const requiredValues = traitReqs[cat];
                    const itemValue = normAttrs[cat];

                    // Global OR: If we match ANY variation in ANY category, we see it as a "Trait Match"
                    if (itemValue && requiredValues.includes(itemValue)) {
                        matchesTraits = true;
                        break;
                    }
                }
            }

            // FINAL LOGIC DECISION
            let shouldKeep = false;

            if (logicMode === 'OR') {
                // Keep if matches Rarity OR matches Traits
                // But wait, if NO traits are selected, "matchesTraits" is false.
                // If logic is OR, and I select RARE, I get RARE.
                // If I select RARE + GOLD SKIN: I get (RARE) OR (GOLD SKIN aka Common Gold Skin). Correct.
                shouldKeep = matchesRarity || matchesTraits;
            } else {
                // AND (Default)
                // Must match Rarity.
                // AND if traits are specified, must match traits.
                shouldKeep = matchesRarity && (!hasTraitFilters || matchesTraits);
            }

            if (shouldKeep) {
                newWatchList.push(mint);
            }
        }

        console.log(`[SetupManager] Filtered ${newWatchList.length}/${allCollectionMints.length} items for ${symbol}`);

        // 4. Helius Smart Merge
        await this.smartUpdateWebhook(allCollectionMints, newWatchList);

        await this.collectionService.updateCollection(symbol, {
            isSynced: true,
            countWatched: newWatchList.length,
            filters: { minRarity, traits: traitsInput, logicMode }
        });

        return { success: true, count: newWatchList.length };
    }

    private async smartUpdateWebhook(allMintsInCollection: string[], newMintsToWatch: string[]) {
        const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.PUBLIC_URL + '/webhook';
        if (!process.env.PUBLIC_URL && !process.env.WEBHOOK_URL) {
            console.warn('[SetupManager] No WEBHOOK_URL/PUBLIC_URL. Skipping Helius update.');
            return;
        }

        // Normalize URL for matching (remove trailing slashes, ensure consistent protocol)
        const normalizeUrl = (url: string) => url.toLowerCase().replace(/\/+$/, '').trim();
        const normalizedTargetUrl = normalizeUrl(WEBHOOK_URL);

        try {
            console.log(`[SetupManager] Helius Sync Target: ${WEBHOOK_URL}`);
            const listResp = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`);
            if (!listResp.ok) throw new Error(`Failed to list webhooks: ${listResp.status} ${listResp.statusText}`);

            const webhooks = await listResp.json() as any[];
            let target = webhooks.find((w: any) => normalizeUrl(w.webhookURL) === normalizedTargetUrl);

            let finalAddressList: string[] = [];

            if (target) {
                console.log(`[SetupManager] Found matching webhook ID: ${target.webhookID}`);
                const detailResp = await fetch(`https://api.helius.xyz/v0/webhooks/${target.webhookID}?api-key=${this.apiKey}`);
                if (!detailResp.ok) throw new Error(`Failed to fetch webhook details: ${detailResp.status} ${detailResp.statusText}`);

                const detailData = await detailResp.json() as any;
                const currentAddresses = detailData.accountAddresses || [];
                console.log(`[SetupManager] Current Address Count: ${currentAddresses.length}`);

                // 1. Remove ALL mints belonging to this collection
                const collectionMintSet = new Set(allMintsInCollection);
                const beforeCount = currentAddresses.length;
                finalAddressList = currentAddresses.filter((addr: string) => !collectionMintSet.has(addr));
                const removedCount = beforeCount - finalAddressList.length;
                console.log(`[SetupManager] Removed ${removedCount} stale addresses. Remaining: ${finalAddressList.length}`);

                // 2. Add NEW filtered mints
                finalAddressList.push(...newMintsToWatch);
                console.log(`[SetupManager] Final Count for Update: ${finalAddressList.length}`);

                // 3. Handle Empty List (DELETE instead of PUT)
                if (finalAddressList.length === 0) {
                    console.log(`[SetupManager] No addresses remaining. Deleting Webhook ${target.webhookID}...`);
                    const deleteResp = await fetch(`https://api.helius.xyz/v0/webhooks/${target.webhookID}?api-key=${this.apiKey}`, {
                        method: 'DELETE'
                    });
                    if (!deleteResp.ok) {
                        const errorText = await deleteResp.text();
                        throw new Error(`Failed to delete empty webhook: ${deleteResp.status} ${errorText}`);
                    }
                    console.log('[SetupManager] Helius Webhook Deleted Successfully.');
                    return;
                }

                // Update
                const updateResp = await fetch(`https://api.helius.xyz/v0/webhooks/${target.webhookID}?api-key=${this.apiKey}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        webhookURL: WEBHOOK_URL,
                        transactionTypes: ['ANY'],
                        accountAddresses: finalAddressList,
                        webhookType: 'raw',
                        txnStatus: 'success',
                        authHeader: process.env.HELIUS_AUTH_SECRET
                    })
                });
                if (!updateResp.ok) {
                    const errorText = await updateResp.text();
                    throw new Error(`Failed to update webhook: ${updateResp.status} ${errorText}`);
                }

            } else {
                console.log('[SetupManager] No existing webhook found for this URL. Creating new one...');
                finalAddressList = newMintsToWatch;

                if (finalAddressList.length === 0) {
                    console.log('[SetupManager] No addresses to watch. Skipping webhook creation.');
                    return;
                }

                const createResp = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        webhookURL: WEBHOOK_URL,
                        transactionTypes: ['ANY'],
                        accountAddresses: finalAddressList,
                        webhookType: 'raw',
                        txnStatus: 'success',
                        authHeader: process.env.HELIUS_AUTH_SECRET
                    })
                });
                if (!createResp.ok) {
                    const errorText = await createResp.text();
                    throw new Error(`Failed to create webhook: ${createResp.status} ${errorText}`);
                }
            }

            console.log('[SetupManager] Helius Webhook Synced Successfully.');

        } catch (e: any) {
            console.error('[SetupManager] Webhook Sync Failed:', e.message);
            throw new Error(`Webhook Sync Failed: ${e.message}`);
        }
    }

    public async deleteCollectionData(symbol: string) {
        // 0. Cleanup Helius Webhook FIRST while we still have the data file
        const dataPath = path.join(this.dataDir, `${symbol}.json`);
        if (fs.existsSync(dataPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                const allMints = Object.keys(data);
                console.log(`[SetupManager] Cleaning up ${allMints.length} addresses from Helius for ${symbol}...`);
                await this.smartUpdateWebhook(allMints, []); // Remove all, add none
            } catch (e) {
                console.error(`[SetupManager] Error during Helius cleanup for ${symbol}:`, e);
            }
        }

        // 1. Remove from CollectionService (handles memory + disk)
        await this.collectionService.removeCollection(symbol);

        // 2. Delete data file
        if (fs.existsSync(dataPath)) {
            try {
                fs.unlinkSync(dataPath);
            } catch (e) {
                console.error(`[SetupManager] Error deleting ${symbol}.json:`, e);
            }
        }
    }

    public async markAsUnsynced(symbol: string) {
        // 0. Cleanup Helius Webhook
        const dataPath = path.join(this.dataDir, `${symbol}.json`);
        if (fs.existsSync(dataPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                const allMints = Object.keys(data);
                console.log(`[SetupManager] Removing ${symbol} from Helius webhook...`);
                await this.smartUpdateWebhook(allMints, []); // Remove all from this collection
            } catch (e) {
                console.error(`[SetupManager] Error during Helius removal for ${symbol}:`, e);
            }
        }

        await this.collectionService.updateCollection(symbol, {
            isSynced: false,
            countWatched: 0
        });
    }

    // For Manager View
    public getManagerStats() {
        return this.collectionService.getCollections();
    }

}
