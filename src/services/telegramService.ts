import { logger } from '../utils/logger';

export class TelegramService {
    private botToken: string;
    private chatId: string;
    private isEnabled: boolean = false;

    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
        this.chatId = process.env.TELEGRAM_CHAT_ID || '';

        if (this.botToken && this.chatId) {
            this.isEnabled = true;
            logger.info('Telegram Service: Enabled 🟢');
        } else {
            logger.warn('Telegram Service: Disabled (Missing Token or Chat ID) ⚪');
        }
    }

    public async sendPortfolioUpdate(newTotal: number, change: number) {
        if (!this.isEnabled) return;

        try {
            const date = new Date().toLocaleString('en-US', {
                month: 'numeric', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true
            });

            // Format: +0.50 or -0.50
            const sign = change >= 0 ? '+' : '';
            const changeStr = `${sign}${change.toFixed(5)}`;
            const emoji = change >= 0 ? '🟢' : '🔴';

            const message =
                `🔔 <b>Portfolio Update Detected</b>

${emoji} <b>Change:</b> <code>${changeStr} SOL</code>
💰 <b>New Total:</b> <code>${newTotal.toFixed(5)} SOL</code>

────────────────
📅 <i>${date}</i>`;

            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            const payload = {
                chat_id: this.chatId,
                text: message,
                parse_mode: 'HTML'
            };

            // Fire and forget (No await) - prevents blocking
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(async res => {
                if (!res.ok) {
                    const txt = await res.text();
                    logger.error(`Telegram API Error: ${txt}`);
                }
            }).catch(err => {
                logger.error(`Telegram Network Error: ${err.message}`);
            });

        } catch (error) {
            logger.error('Failed to construct Telegram message:', error);
        }
    }
}
