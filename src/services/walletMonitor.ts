import { Connection, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } from '@solana/web3.js';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

// === CONFIGURATION ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const WALLETS_ENV = process.env.WALLETS;

// Validation
if (!TELEGRAM_TOKEN || !CHAT_ID || !WALLETS_ENV) {
    console.warn("⚠️ Wallet Monitor: Missing configuration in .env. TELEGRAM_TOKEN, CHAT_ID, and WALLETS are required.");
}

let bot: TelegramBot | null = null;
if (TELEGRAM_TOKEN) {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
}

const connection = new Connection(
    clusterApiUrl('mainnet-beta'),
    { commitment: 'confirmed' }
);

let publicKeys: PublicKey[] = [];

try {
    if (WALLETS_ENV) {
        publicKeys = WALLETS_ENV.split(',').map(addr => new PublicKey(addr.trim()));
    }
} catch (e) {
    console.error("❌ Wallet Monitor: Invalid Wallet Address", e);
}

let lastCombinedBalance: number | null = null;

async function getSolBalance(pubkey: PublicKey): Promise<number> {
    const lamports = await connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
}

async function checkCombinedBalance() {
    if (!bot || publicKeys.length === 0 || !CHAT_ID) return;

    try {
        const balances = await Promise.all(publicKeys.map(pk => getSolBalance(pk)));

        const combined = balances.reduce((sum, bal) => sum + bal, 0);

        if (lastCombinedBalance === null) {
            lastCombinedBalance = combined;
            console.log(`Wallet Monitor Initialized. Initial balance: ${combined.toFixed(5)} SOL`);
            return;
        }

        if (combined !== lastCombinedBalance) {
            const diff = combined - lastCombinedBalance;
            const emoji = diff > 0 ? '🟢 Received' : '🔴 Sent';
            const formattedDiff = (diff > 0 ? '+' : '') + diff.toFixed(5);

            const message = `
💸 *Combined Balance Changed*  
${emoji}: \`${formattedDiff} SOL\`  
📊 *New Combined Balance*: \`${combined.toFixed(5)} SOL\`
🕒 ${new Date().toLocaleString()}
      `.trim();

            await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
            console.log(`✅ Alert sent: ${formattedDiff} | New: ${combined.toFixed(5)} SOL`);

            lastCombinedBalance = combined;
        }
    } catch (e: any) {
        console.error('❌ Error checking balance:', e.message);
    }
}

export function startWalletMonitor() {
    if (!TELEGRAM_TOKEN || !CHAT_ID || !WALLETS_ENV) {
        console.log("Skipping Wallet Monitor: Missing Config");
        return;
    }
    console.log("Starting Wallet Monitor...");
    // Initial check immediately
    checkCombinedBalance();
    // Then every 30 seconds
    setInterval(checkCombinedBalance, 30_000);
}
