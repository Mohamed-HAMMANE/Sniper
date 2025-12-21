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

    public async monitor(signature: string, label: string = 'Buy'): Promise<boolean> {
        logger.debug(`Confirmation: Monitoring ${label} tx: ${signature}`);

        // Wait a bit before first check (give it time to propagate)
        await new Promise(r => setTimeout(r, 2000));

        let retries = 0;
        const MAX_RETRIES = 12; // 12 * 2s = 24s max wait (slightly increased to be safe)

        return new Promise((resolve) => {
            const check = async () => {
                try {
                    const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });

                    if (status && status.value) {
                        if (status.value.err) {
                            logger.error(`${label} Failed: ${JSON.stringify(status.value.err)}`);
                            this.broadcaster.broadcastMessage('tx_failed', { signature, error: status.value.err });
                            return resolve(false);
                        }

                        if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
                            logger.info(`${label} Confirmed!`);
                            this.broadcaster.broadcastMessage('tx_confirmed', { signature });
                            return resolve(true);
                        }
                    }

                    // If not confirmed yet, retry
                    retries++;
                    if (retries < MAX_RETRIES) {
                        setTimeout(check, 2000);
                    } else {
                        logger.warn(`${label} Timeout waiting for confirmation.`);
                        this.broadcaster.broadcastMessage('tx_timeout', { signature });
                        resolve(false);
                    }
                } catch (error) {
                    logger.error('Error checking status:', error);
                    // On network error, we don't resolve immediately to allow retries, 
                    // but if it keeps failing, the timeout will catch it.
                    retries++;
                    if (retries < MAX_RETRIES) {
                        setTimeout(check, 2000);
                    } else {
                        resolve(false);
                    }
                }
            };

            check();
        });
    }
}
