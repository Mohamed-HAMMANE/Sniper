import { Connection } from '@solana/web3.js';
import { SSEBroadcaster } from '../api/sseEndpoint';
import { logger } from '../utils/logger';

export class ConfirmationService {
    private connection: Connection;
    private broadcaster: SSEBroadcaster;

    constructor(rpcUrl: string, broadcaster: SSEBroadcaster, publicRpcUrl?: string) {
        // Use Public RPC for confirmation checks if available, otherwise fallback to main RPC
        const urlToUse = publicRpcUrl || rpcUrl;
        this.connection = new Connection(urlToUse, 'confirmed');

        if (publicRpcUrl) {
            logger.debug(`ConfirmationService: Using Public RPC for status checks: ${publicRpcUrl}`);
        }

        this.broadcaster = broadcaster;
    }

    public async monitor(signature: string, label: string = 'Buy') {
        logger.debug(`Confirmation: Monitoring ${label} tx: ${signature}`);

        // Wait a bit before first check (give it time to propagate)
        await new Promise(r => setTimeout(r, 2000));

        let retries = 0;
        const MAX_RETRIES = 10; // 10 * 2s = 20s max wait

        const check = async () => {
            try {
                const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });

                if (status && status.value) {
                    if (status.value.err) {
                        logger.error(`${label} Failed: ${JSON.stringify(status.value.err)}`);
                        this.broadcaster.broadcastMessage('tx_failed', { signature, error: status.value.err });
                        return;
                    }

                    if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
                        logger.info(`${label} Confirmed!`);
                        this.broadcaster.broadcastMessage('tx_confirmed', { signature });
                        return;
                    }
                }

                // If not confirmed yet, retry
                retries++;
                if (retries < MAX_RETRIES) {
                    setTimeout(check, 2000);
                } else {
                    logger.warn(`${label} Timeout waiting for confirmation.`);
                    this.broadcaster.broadcastMessage('tx_timeout', { signature });
                }
            } catch (error) {
                logger.error('Error checking status:', error);
            }
        };

        check();
    }
}
