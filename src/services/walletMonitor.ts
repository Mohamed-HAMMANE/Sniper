import { Connection, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } from '@solana/web3.js';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

// === CONFIGURATION ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const WALLET_1 = process.env.WALLET_1;
const WALLET_2 = process.env.WALLET_2;

// Validation
if (!TELEGRAM_TOKEN || !CHAT_ID || !WALLET_1 || !WALLET_2) {
    console.warn("⚠️ Wallet Monitor: Missing configuration in .env. TELEGRAM_TOKEN, CHAT_ID, WALLET_1, and WALLET_2 are required.");
}

let bot: TelegramBot | null = null;
if (TELEGRAM_TOKEN) {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
}

const connection = new Connection(
    clusterApiUrl('mainnet-beta'),
    { commitment: 'confirmed' }
);

let publicKey1: PublicKey | null = null;
let publicKey2: PublicKey | null = null;

try {
    if (WALLET_1) publicKey1 = new PublicKey(WALLET_1);
    if (WALLET_2) publicKey2 = new PublicKey(WALLET_2);
} catch (e) {
    console.error("❌ Wallet Monitor: Invalid Wallet Address", e);
}

let lastCombinedBalance: number | null = null;

async function getSolBalance(pubkey: PublicKey): Promise<number> {
    const lamports = await connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
}

async function checkCombinedBalance() {
    if (!bot || !publicKey1 || !publicKey2 || !CHAT_ID) return;

    try {
        const [bal1, bal2] = await Promise.all([
            getSolBalance(publicKey1),
            getSolBalance(publicKey2),
        ]);

        const combined = bal1 + bal2;

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
    if (!TELEGRAM_TOKEN || !CHAT_ID || !WALLET_1 || !WALLET_2) {
        console.log("Skipping Wallet Monitor: Missing Config");
        return;
    }
    console.log("Starting Wallet Monitor...");
    // Initial check immediately
    checkCombinedBalance();
    // Then every 30 seconds
    setInterval(checkCombinedBalance, 30_000);
}
