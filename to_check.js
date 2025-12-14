const fs = require('fs');
require('dotenv').config();

const collections = [
    { symbol: 'thatgoblin', address: 'AEzcJ2HwueHJkMmQeSYFv5tNGPDNvUYyR6wh89UHhGzv' }
];

const API_KEY = process.env.API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;



async function deleteAllWebhooks() {
    try {
        console.log("Checking for existing webhooks...");
        const response = await fetch(
            `https://api.helius.xyz/v0/webhooks?api-key=${API_KEY}`
        );
        const webhooks = await response.json();

        if (!webhooks || webhooks.length === 0) {
            console.log("No existing webhooks found.");
            return;
        }

        console.log(`Found ${webhooks.length} existing webhooks. Deleting...`);
        for (const hook of webhooks) {
            await fetch(
                `https://api.helius.xyz/v0/webhooks/${hook.webhookID}?api-key=${API_KEY}`,
                { method: 'DELETE' }
            );
            console.log(`Deleted webhook: ${hook.webhookID}`);
        }
        console.log("All existing webhooks deleted.");
    } catch (err) {
        console.error("Error deleting webhooks:", err);
    }
}

async function createWebhook(mints) {
    try {
        const response = await fetch(
            `https://api.helius.xyz/v0/webhooks?api-key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    webhookURL: WEBHOOK_URL,
                    transactionTypes: ["NFT_LISTING", "UNKNOWN"],
                    accountAddresses: mints,
                    webhookType: 'enhanced'
                })
            }
        );
        const data = await response.json();
        console.log("Webhook creation response:", data);
    } catch (err) {
        console.error("Error creating webhook:", err);
    }
}

async function buildDatabase(COLLECTION, COLLECTION_ADDRESS) {
    const OUTPUT_FILE = COLLECTION + "_database.json";
    let page = 1;
    let allItems = [];
    console.log(`🚀 Starting Download from Helius...`);
    while (true) {
        try {
            const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 'my-id', method: 'getAssetsByGroup',
                    params: { groupKey: 'collection', groupValue: COLLECTION_ADDRESS, page: page, limit: 1000 }
                }),
            });
            const { result } = await response.json();
            if (!result?.items?.length) break;
            allItems.push(...result.items);
            process.stdout.write(`\r📥 Page ${page}: Fetched ${allItems.length} total items...`);
            if (result.items.length < 1000) break;
            page++;
        } catch (e) { console.error("\n❌ Error:", e); break; }
    }
    console.log(`\n✅ Download Complete. Starting Analysis...`);
    const totalItems = allItems.length;
    // --- STEP 2: NORMALIZE & COUNT TRAITS ---
    const allTraitTypes = new Set();
    allItems.forEach(item => {
        const attrs = item.content.metadata.attributes || [];
        attrs.forEach(a => {
            if (a.trait_type) allTraitTypes.add(String(a.trait_type).trim().toLowerCase());
        });
    });
    let traitCounts = {};
    allTraitTypes.forEach(type => traitCounts[type] = {});
    traitCounts["Trait Count"] = {};
    allItems.forEach(item => {
        const attrs = item.content.metadata.attributes || [];
        const activeAttrs = attrs.filter(a => a.value && String(a.value).trim().toLowerCase() !== "none");
        const countVal = activeAttrs.length.toString();
        traitCounts["Trait Count"][countVal] = (traitCounts["Trait Count"][countVal] || 0) + 1;
        allTraitTypes.forEach(type => {
            const found = attrs.find(a => String(a.trait_type).trim().toLowerCase() === type);
            const value = found && found.value ? String(found.value).trim().toLowerCase() : "none";
            if (!traitCounts[type][value]) traitCounts[type][value] = 0;
            traitCounts[type][value]++;
        });
    });
    // --- STEP 3: CALCULATE SCORES (DUAL MODEL) ---
    let scoredItems = allItems.map(item => {
        const attrs = item.content.metadata.attributes || [];
        let name = (item.content.metadata.name || '').trim();
        if (!name) name = COLLECTION;
        // --- Model A: Additive (Sum of Inverse) ---
        // * Classic "HowRare" style. 
        // * Includes "Trait Count" as a feature.
        // * Math: Sum(1 / probability)
        // * Higher Score = Rarer
        let score_additive = 0;
        // A.1 Score Trait Count
        const activeAttrs = attrs.filter(a => a.value && String(a.value).trim().toLowerCase() !== "none");
        const countVal = activeAttrs.length.toString();
        const countFreq = traitCounts["Trait Count"][countVal];
        if (countFreq) score_additive += 1 / (countFreq / totalItems);
        // A.2 Score Attributes
        allTraitTypes.forEach(type => {
            const found = attrs.find(a => String(a.trait_type).trim().toLowerCase() === type);
            const value = found && found.value ? String(found.value).trim().toLowerCase() : "none";
            const freq = traitCounts[type][value];
            if (freq) score_additive += 1 / (freq / totalItems);
        });
        // --- Model B: Statistical (Multiplicative) ---
        // * "Magic Eden" style.
        // * Excludes "Trait Count" (prevents empty items from ranking high).
        // * Math: Product(probability)
        // * Lower Score = Rarer
        let score_statistical = 1;
        allTraitTypes.forEach(type => {
            const found = attrs.find(a => String(a.trait_type).trim().toLowerCase() === type);
            const value = found && found.value ? String(found.value).trim().toLowerCase() : "none";
            const freq = traitCounts[type][value];
            if (freq) score_statistical *= (freq / totalItems);
        });
        return {
            mint: item.id,
            name: name,
            image: item.content.files?.[0]?.uri || item.content.links?.image,
            score_additive: score_additive,
            score_statistical: score_statistical
        };
    });
    // --- STEP 4: SORT & ASSIGN TIERS (DUAL RANKING) ---
    const getTier = (rank, total) => {
        const percentile = (rank / total) * 100;
        if (percentile <= 1) return "MYTHIC";
        if (percentile <= 5) return "LEGENDARY";
        if (percentile <= 15) return "EPIC";
        if (percentile <= 35) return "RARE";
        if (percentile <= 60) return "UNCOMMON";
        return "COMMON";
    };
    // 4.1 Assign Additive Ranks (Descending: Higher is Rarer)
    scoredItems.sort((a, b) => {
        if (b.score_additive !== a.score_additive) return b.score_additive - a.score_additive;
        return a.mint.localeCompare(b.mint);
    });
    scoredItems.forEach((item, index) => {
        item.rank_additive = index + 1;
        item.tier_additive = getTier(index + 1, totalItems);
    });
    // 4.2 Assign Statistical Ranks (Ascending: Lower is Rarer)
    scoredItems.sort((a, b) => {
        if (a.score_statistical !== b.score_statistical) return a.score_statistical - b.score_statistical;
        return a.mint.localeCompare(b.mint);
    });
    scoredItems.forEach((item, index) => {
        item.rank_statistical = index + 1;
        item.tier_statistical = getTier(index + 1, totalItems);
    });
    const finalDatabase = {};
    scoredItems.forEach(item => {
        finalDatabase[item.mint] = {
            name: item.name,
            image: item.image,
            collection: COLLECTION,
            rank_additive: item.rank_additive,
            tier_additive: item.tier_additive,
            score_additive: item.score_additive,
            rank_statistical: item.rank_statistical,
            tier_statistical: item.tier_statistical,
            score_statistical: item.score_statistical
        };
    });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalDatabase, null, 2));
    console.log(`\n🎉 Database Built! Saved to ${OUTPUT_FILE}`);
    console.log(`📊 Total Items: ${Object.keys(finalDatabase).length}`);
    return finalDatabase;
}

async function main() {
    await deleteAllWebhooks();
    let allFilteredMints = [];
    const TARGET_TIERS = ["MYTHIC", "LEGENDARY", "EPIC", "RARE"];

    for (const obj of collections) {
        const collectionAddress = obj.address;
        console.log(`\n==============================`);
        console.log(`Processing collection: ${obj.symbol}`);

        // 1. Build Database (Fetch & Score)
        console.log(`Building database and scoring items for ${obj.symbol}...`);
        const db = await buildDatabase(obj.symbol, collectionAddress);

        // 2. Filter for Rarity
        let collectionRareMints = [];
        Object.entries(db).forEach(([mint, data]) => {
            const isRare = TARGET_TIERS.includes(data.tier_additive) || TARGET_TIERS.includes(data.tier_statistical);
            if (isRare) {
                collectionRareMints.push(mint);
            }
        });

        console.log(`Found ${collectionRareMints.length} items (Rare+) for ${obj.symbol}`);
        allFilteredMints.push(...collectionRareMints);
        console.log(`Done with ${obj.symbol}`);
    }

    const uniqueMints = Array.from(new Set(allFilteredMints));
    console.log(`\nCreating ONE webhook for RARE+ items across all collections.`);
    console.log(`Total monitored mints: ${uniqueMints.length}`);

    if (uniqueMints.length > 0) {
        const EXTRA_MINTS = [
            "HV6FrkmqM4LBDq6dMTfyPmAARxYBjfk3qGgcwQHhHWPi"
        ];
        const mintsToWatch = Array.from(new Set([...uniqueMints, ...EXTRA_MINTS]));
        await createWebhook(mintsToWatch);
        console.log(`Webhook created successfully.`);
    } else {
        console.log(`No rare items found to monitor.`);
    }

    console.log(`\nAll collections processed.`);
}

main();