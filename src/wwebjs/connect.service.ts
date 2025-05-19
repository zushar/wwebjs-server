// connect.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import Redis from 'ioredis';
import { Client } from 'whatsapp-web.js';
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
   * Retrieves the active WhatsApp client instance.
   * Throws an error if the client is not found or not ready.
   */
  getClient(phoneNumber: string): {
    client: Client;
    ready: boolean;
  } {
    const clientData = this.clients.get(phoneNumber);
    if (!clientData) {
      const errorMsg = `Client for phone number ${phoneNumber} not found in memory`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    if (!clientData.ready) {
      const errorMsg = `Client for phone number ${phoneNumber} is not ready`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    this.logger.log(`Client ${phoneNumber} found in memory and ready.`);
    return {
      client: clientData.client,
      ready: clientData.ready,
    };
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
    this.logger.log(`Initializing WhatsApp client for: ${phoneNumber}`);
    const clientData: ClientState | undefined = this.clients.get(clientId);
    if (clientData) {
      this.logger.warn(`Client ${clientId} already exists. Reinitializing...`);
      return {
        clientId: clientData.id,
        message: 'Client already exists and is verified',
      };
    }

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
      let resolved = false;
      let pairingCodeRequested = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.logger.error(
            `Timed out waiting for client event (ready/qr) for ${phoneNumber}`,
          );
          this.clients.delete(clientId);
          client
            .destroy()
            .catch((e) =>
              this.logger.error(
                `Error destroying client on timeout for ${phoneNumber}:`,
                e,
              ),
            );
          reject(new Error('Timed out waiting for client connection'));
        }
      }, 300000);

      client.on('loading_screen', (percent, message) => {
        this.logger.log(
          `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
        );
      });

      client.on('ready', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.logger.log(`Client ready for ${phoneNumber}`);
          newClient.ready = true;
          newClient.lastActive = Date.now();
          this.clients.set(clientId, newClient);

          void this.redisClient
            .set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClient)),
            )
            .then(() => {
              this.logger.log(
                `Stored ready status in Redis for ${phoneNumber}`,
              );
              resolve({ clientId, message: 'Client is ready' });
            })
            .catch((error) => {
              this.logger.error(
                `Failed to store Redis data for ${phoneNumber}:`,
                error,
              );
              // Still resolve since client is ready
              resolve({
                clientId,
                message: 'Client is ready (Redis update failed)',
              });
            });
        } else {
          this.logger.warn(
            `'ready' event received for ${phoneNumber} after promise was already resolved.`,
          );
        }
      });

      client.on('qr', () => {
        if (resolved || pairingCodeRequested) {
          this.logger.debug(
            `Ignoring extra QR event for ${phoneNumber} (resolved: ${resolved}, requested: ${pairingCodeRequested}).`,
          );
          return;
        }
        pairingCodeRequested = true;
        this.clients.set(clientId, newClient);

        this.logger.log(
          `QR received for ${phoneNumber}, requesting pairing code...`,
        );
        const pairingTimeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.logger.warn(
              `Pairing code not entered for ${phoneNumber} within timeout period`,
            );
            this.clients.delete(clientId);
            client
              .destroy()
              .catch((e) =>
                this.logger.error(
                  `Error destroying client on pairing timeout for ${phoneNumber}:`,
                  e,
                ),
              );
            reject(new Error('Pairing code not entered within timeout'));
          }
        }, 600000);
        void client
          .requestPairingCode(phoneNumber)
          .then(async (pairingCode: string) => {
            this.logger.log(
              `Pairing code received for ${phoneNumber}: ${pairingCode}`,
            );
            await this.redisClient.set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClient)),
            );
            this.logger.log(
              `Stored unverified status in Redis for ${phoneNumber}`,
            );
            if (!resolved) {
              resolved = true;
              clearTimeout(pairingTimeout);
              resolve({ clientId, pairingCode });
            }
          })
          .catch((error: unknown) => {
            this.logger.error(
              `Failed to get pairing code for ${phoneNumber}:`,
              error,
            );
            if (!resolved) {
              resolved = true;
              clearTimeout(pairingTimeout);
              this.clients.delete(clientId);
              client
                .destroy()
                .catch((e) =>
                  this.logger.error(
                    `Error destroying client on pairing code failure for ${phoneNumber}:`,
                    e,
                  ),
                );
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
      });

      client.on('auth_failure', (error: unknown) => {
        this.logger.error(
          `Authentication failure for ${phoneNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.clients.delete(clientId);
          client
            .destroy()
            .catch((e) =>
              this.logger.error(
                `Error destroying client on auth failure for ${phoneNumber}:`,
                e,
              ),
            );
          reject(
            new Error(
              'Authentication failure: ' +
                (error instanceof Error ? error.message : String(error)),
            ),
          );
        }
      });

      client.on('disconnected', (reason) => {
        this.logger.warn(
          `Client ${phoneNumber} disconnected: ${reason}. Removing from active clients.`,
        );
        this.clients.delete(clientId);
        client
          .destroy()
          .catch((e) =>
            this.logger.error(
              `Error destroying client on disconnect for ${phoneNumber}:`,
              e,
            ),
          );
        this.redisClient
          .del(this.getRedisKey(clientId))
          .catch((e) =>
            this.logger.error(
              `Error deleting Redis entry for ${phoneNumber} on disconnect:`,
              e,
            ),
          );
        const authPath = '../../wwebjs_auth/session-' + phoneNumber;
        fs.rm(authPath, { recursive: true, force: true }, (err) => {
          if (err) {
            this.logger.error(
              `Error deleting auth files for ${phoneNumber}:`,
              err,
            );
          } else {
            this.logger.log(
              `Auth files deleted for ${phoneNumber} successfully.`,
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
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.clients.delete(clientId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}
