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
    const startTime = Date.now();
    const client = this.clientFactory.createClient(phoneNumber);
    const creationTime = Date.now() - startTime;
    this.logger.log(`Client created in: ${creationTime} ms`);

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

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        client.removeAllListeners('qr');
        client.removeAllListeners('ready');
        client.removeAllListeners('loading_screen');
        client.removeAllListeners('auth_failure');
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

      const timeout = setTimeout(() => {
        this.logger.warn(
          `Timeout reached while waiting for client event for ${phoneNumber}`,
        );
        safeReject(
          new Error(`Timed out waiting for client ${clientId} connection`),
        );
      }, 600000);

      client.on('qr', () => {
        this.logger.log(
          `QR received for ${phoneNumber}, requesting pairing code...`,
        );
        const pairingStartTime = Date.now();

        client
          .requestPairingCode(phoneNumber)
          .then(async (code) => {
            pairingCode = code;
            const pairingTime = Date.now() - pairingStartTime;
            this.logger.log(
              `Pairing code received for ${phoneNumber}: ${pairingCode} (${pairingTime} ms)`,
            );

            // Store client meta in Redis
            const storeStartTime = Date.now();
            await this.redisClient.set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClient)),
            );
            const storeTime = Date.now() - storeStartTime;
            this.logger.log(
              `Client meta stored in Redis for ${phoneNumber} (${storeTime} ms)`,
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

        const result: {
          clientId: string;
          pairingCode?: string;
          message: string;
        } = {
          clientId,
          message: pairingCode
            ? 'Client is ready and authenticated with pairing code'
            : 'Client is ready and authenticated',
        };

        if (pairingCode) {
          result.pairingCode = pairingCode;
        }

        safeResolve(result);
      });

      client.on('loading_screen', (percent, message) => {
        this.logger.log(
          `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
        );
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

        // Clean up Redis entry first
        this.redisClient
          .del(this.getRedisKey(clientId))
          .then(() => {
            this.logger.log(`Redis entry deleted for ${phoneNumber}`);
          })
          .catch((error) => {
            this.logger.error(
              `Error deleting Redis entry for ${phoneNumber}:`,
              error,
            );
          })
          .then(() => {
            // Clean up auth files
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
            // Always clean up the client from memory
            this.clients.delete(clientId);

            // Only resolve if this is an expected disconnection after setup
            if (newClient.ready) {
              safeResolve({
                clientId,
                message: `Client disconnected and removed: ${reason}`,
              });
            } else {
              safeReject(
                new Error(`Client disconnected during setup: ${reason}`),
              );
            }
          });
      });

      // Start client initialization
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
