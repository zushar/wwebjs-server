// connect.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ClientMeta, ClientState, ClientType } from './client-meta.type';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);
  private clients: Map<string, ClientState> = new Map();
  private readonly sessionTimeout = 60 * 60 * 1000; // שעה אחת של חוסר פעילות

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly clientFactory: ClientFactoryService,
  ) {
    // הפעל ניקוי אוטומטי של סשנים לא פעילים כל 15 דקות
    setInterval(
      () => {
        this.cleanupInactiveClients().catch((err) =>
          this.logger.error('Error in cleanupInactiveClients:', err),
        );
      },
      15 * 60 * 1000,
    );
  }

  private async cleanupInactiveClients(): Promise<void> {
    this.logger.log('Running cleanup of inactive clients');
    const now = Date.now();

    for (const [phoneNumber, clientState] of this.clients.entries()) {
      if (now - clientState.lastActive > this.sessionTimeout) {
        this.logger.log(`Auto-removing inactive client ${phoneNumber}`);
        await Promise.resolve(this.removeClient(phoneNumber));
      }
    }
  }

  private getRedisKey(phoneNumber: string): string {
    return `wa-client:${phoneNumber}`;
  }
  /**
   * Retrieves the client metadata from Redis.
   * Returns null if not found.
   */
  async getClientMeta(phoneNumber: string): Promise<ClientMeta | null> {
    const redisKey = this.getRedisKey(phoneNumber);
    const data = await this.redisClient.get(redisKey);
    if (!data) {
      this.logger.warn(
        `No Redis record found for ${phoneNumber} during metadata retrieval.`,
      );
      return null;
    }
    try {
      const parsedData = JSON.parse(data) as ClientMeta;
      this.logger.log(
        `Client metadata retrieved from Redis for ${phoneNumber}: ${JSON.stringify(
          parsedData,
        )}`,
      );
      return parsedData;
    } catch (e) {
      this.logger.error(
        `Failed to parse Redis data for ${phoneNumber} during metadata retrieval: ${data}`,
        e,
      );
      return null;
    }
  }

  /**
   * Retrieves the active WhatsApp client instance from memory.
   * Throws an error if the client is not found or not ready.
   */
  getClient(phoneNumber: string): ClientState | undefined {
    const clientData = this.clients.get(phoneNumber);
    return clientData;
  }

  removeClient(phoneNumber: string): void {
    const clientData = this.clients.get(phoneNumber);
    if (!clientData) {
      this.logger.warn(
        `Client for phone number ${phoneNumber} not found in memory`,
      );
      return;
    }
    this.logger.log(`Removing client ${phoneNumber} from memory.`);
    clientData.client
      .destroy()
      .catch((e) =>
        this.logger.error(
          `Error destroying client ${phoneNumber} during removal:`,
          e,
        ),
      );
    this.clients.delete(phoneNumber);
  }

  /**
   * Converts a ClientState to a ClientMeta for Redis storage.
   */
  private toClientMeta(state: ClientState): ClientMeta {
    return {
      id: state.id,
      type: state.clientType,
      lastActive: state.lastActive,
    };
  }

  /**
   * Creates (or reinitializes) a WhatsApp client using LocalAuth and returns a pairingCode if needed.
   * Stores verification status in Redis.
   */
  async createVerificationCode(
    phoneNumber: string,
    clientType: ClientType,
  ): Promise<{ clientId: string; pairingCode?: string; message?: string }> {
    const clientId = phoneNumber;
    this.logger.log(`Checking clients for phone number: ${phoneNumber}`);

    const clientData: ClientState | undefined = this.clients.get(clientId);
    if (clientData?.ready) {
      this.logger.log(`Client ${clientId} already exists and is ready.`);
      return {
        clientId: clientData.id,
        message: 'Client already exists and is ready',
      };
    }

    this.logger.log(`Creating new client for phone number: ${phoneNumber}`);
    const client = this.clientFactory.createClient(phoneNumber);

    const newClient: ClientState = {
      id: clientId,
      client: client,
      ready: false,
      lastActive: Date.now(),
      clientType: clientType,
    };
    this.clients.set(clientId, newClient);

    return new Promise<{
      clientId: string;
      pairingCode?: string;
      message?: string;
    }>((resolve, reject) => {
      let isResolved = false;
      let pairingCode = '';
      let pairingCodeTimeout: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (initTimeout) clearTimeout(initTimeout);
        if (pairingCodeTimeout) clearTimeout(pairingCodeTimeout);
        // Only remove specific listeners, not ALL listeners
        // client.removeAllListeners('qr');
        // client.removeAllListeners('ready');
        // client.removeAllListeners('loading_screen');
        // client.removeAllListeners('auth_failure');
        // DO NOT remove 'disconnected' listener - it's needed for lifecycle management
      };

      const safeResolve = (result: {
        clientId: string;
        pairingCode?: string;
        message?: string;
      }) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve(result);
        }
      };

      const safeReject = (error: Error) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          // Only remove disconnect listener when rejecting (client setup failed)
          client.removeAllListeners('disconnected');
          this.clients.delete(clientId);
          client
            .destroy()
            .catch((destroyError) =>
              this.logger.error(
                `Error destroying client for ${phoneNumber}:`,
                destroyError,
              ),
            );
          reject(error);
        }
      };

      // Overall timeout for the entire process
      const initTimeout = setTimeout(() => {
        this.logger.warn(`Overall timeout reached for client ${phoneNumber}`);
        safeReject(
          new Error(`Timed out waiting for client ${clientId} connection`),
        );
      }, 600000); // 10 minutes

      client.on('qr', () => {
        this.logger.log(
          `QR received for ${phoneNumber}, requesting pairing code...`,
        );

        client
          .requestPairingCode(phoneNumber)
          .then(async (code) => {
            pairingCode = code;
            this.logger.log(
              `Pairing code received for ${phoneNumber}: ${pairingCode}`,
            );

            // Store client meta in Redis
            await this.redisClient.set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClient)),
            );

            safeResolve({
              clientId,
              pairingCode: pairingCode,
              message:
                'Pairing code generated - waiting for user to enter code',
            });

            pairingCodeTimeout = setTimeout(() => {
              this.logger.warn(
                `Pairing code timeout for ${phoneNumber} - code was never entered`,
              );

              this.logger.log(
                `Cleaning up client ${phoneNumber} due to pairing code timeout`,
              );

              // Clean up the expired client
              this.clients.delete(clientId);
              client.removeAllListeners();
              client
                .destroy()
                .catch((error) =>
                  this.logger.error(
                    `Error destroying expired client for ${phoneNumber}:`,
                    error,
                  ),
                );

              this.redisClient
                .del(this.getRedisKey(clientId))
                .catch((error) =>
                  this.logger.error(
                    `Error deleting Redis entry for expired client ${phoneNumber}:`,
                    error,
                  ),
                );

              const authPath = '../../wwebjs_auth/session-' + phoneNumber;
              fs.promises
                .rm(authPath, { recursive: true, force: true })
                .catch((error) =>
                  this.logger.error(
                    `Error deleting auth files for expired client ${phoneNumber}:`,
                    error,
                  ),
                );
            }, 360000); // 6 minutes for pairing code entry

            this.logger.log(
              `Pairing code generated for ${phoneNumber}. Waiting for user to enter code...`,
            );
          })
          .catch((error) => {
            this.logger.error(
              `Failed to get pairing code for ${phoneNumber}:`,
              error,
            );
            safeReject(
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      client.on('ready', () => {
        this.logger.log(`Client ready for ${phoneNumber}`);
        newClient.ready = true;
        newClient.lastActive = Date.now();
        this.clients.set(clientId, newClient);

        // תמיד נקה את הtimeout אם קיים
        if (pairingCodeTimeout) {
          this.logger.log(
            `Clearing pairing code timeout for ${phoneNumber} - client is ready`,
          );
          clearTimeout(pairingCodeTimeout);
          pairingCodeTimeout = null;
        }

        // אם Promise עדיין לא resolved (re-establishment case)
        if (!isResolved) {
          client.removeAllListeners('qr');
          client.removeAllListeners('ready');
          client.removeAllListeners('loading_screen');
          client.removeAllListeners('auth_failure');
          safeResolve({
            clientId,
            message: pairingCode
              ? 'Client is ready and authenticated with pairing code'
              : 'Client is ready and authenticated (re-established)',
          });
        } else {
          // אם Promise כבר resolved (pairing code case) - רק לוג
          this.logger.log(
            `Client ${phoneNumber} is now ready (Promise already resolved)`,
          );
        }
      });

      client.on('loading_screen', (percent, message) => {
        this.logger.log(
          `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
        );
      });
      client.on('authenticated', () => {
        this.logger.log(`✅ Client ${phoneNumber} authenticated successfully`);
      });

      client.on('auth_failure', (error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Authentication failure for ${phoneNumber}: ${errorMessage}`,
        );
        safeReject(new Error(`Authentication failure: ${errorMessage}`));
      });

      client.on('disconnected', (reason) => {
        this.logger.warn(
          `Client ${phoneNumber} disconnected: ${reason}. Cleaning up...`,
        );

        this.redisClient
          .del(this.getRedisKey(clientId))
          .catch((error) =>
            this.logger.error(
              `Error deleting Redis entry for ${phoneNumber}:`,
              error,
            ),
          )
          .then(() => {
            const authPath = '../../wwebjs_auth/session-' + phoneNumber;
            return fs.promises.rm(authPath, { recursive: true, force: true });
          })
          .then(() => {
            this.logger.log(
              `Auth files deleted for ${phoneNumber} successfully.`,
            );
          })
          .catch((error) => {
            this.logger.error(
              `Error deleting auth files for ${phoneNumber}:`,
              error,
            );
          })
          .finally(() => {
            this.clients.delete(clientId);

            if (!isResolved) {
              // This handles both scenarios:
              // 1. New authentication where user disconnected during setup
              // 2. Re-establishment where user had disconnected from WhatsApp
              safeResolve({
                clientId,
                message: `Client disconnected and removed: ${reason}`,
              });
            } else {
              // Post-setup disconnection (client was successfully established)
              this.logger.log(
                `Established client ${phoneNumber} disconnected: ${reason}`,
              );
            }
          });
      });

      this.logger.log(`Starting client initialization for ${phoneNumber}...`);
      client.initialize().catch((error) => {
        this.logger.error(
          `Failed to initialize client for ${phoneNumber}:`,
          error,
        );
        safeReject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /**
   * Retrieves the status of a client by phone number.
   */
  getClientStatus(phoneNumber: string): {
    clientId: string;
    status: string;
    ready: boolean;
  } {
    const clientData = this.clients.get(phoneNumber);
    if (!clientData) {
      return {
        clientId: phoneNumber,
        status: 'not_found',
        ready: false,
      };
    }

    return {
      clientId: phoneNumber,
      status: clientData.ready ? 'ready' : 'authenticating',
      ready: clientData.ready,
    };
  }
}
