// connect.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ClientFactoryService } from './client-factory.service';
import { Client } from 'whatsapp-web.js';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ClientType, ClientMeta, ClientState } from './client-meta.type';
import * as fs from 'fs';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);
  private clients: Map<string, ClientState> = new Map();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly clientFactory: ClientFactoryService,
  ) {}

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
    verified: boolean;
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
      verified: clientData.verified,
    };
  }

  /**
   * Converts a ClientState to a ClientMeta for Redis storage.
   */
  private toClientMeta(state: ClientState): ClientMeta {
    return {
      id: state.id,
      verified: state.verified,
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
    verifid = false,
  ): Promise<{ clientId: string; pairingCode?: string; message?: string }> {
    const clientId = phoneNumber;
    this.logger.log(`Initializing WhatsApp client for: ${phoneNumber}`);
    const clientData: ClientState | undefined = this.clients.get(clientId);

    if (clientData && !clientData.verified) {
      this.logger.warn(
        `Client ${clientId} already exists but is not verified.`,
      );
      return {
        clientId: clientData.id,
        message: 'Client already exists but not verified',
      };
    } else if (clientData && clientData.verified) {
      this.logger.warn(
        `Client ${clientId} already exists and is verified. Reinitializing...`,
      );
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
      verified: verifid,
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
      }, 60000);

      client.on('loading_screen', (percent, message) => {
        this.logger.log(
          `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
        );
      });

      client.on('ready', async () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.logger.log(`Client ready for ${phoneNumber}`);
          newClient.ready = true;
          newClient.verified = true;
          newClient.lastActive = Date.now();
          this.clients.set(clientId, newClient);

          await this.redisClient.set(
            this.getRedisKey(clientId),
            JSON.stringify(this.toClientMeta(newClient)),
          );
          this.logger.log(`Stored verified status in Redis for ${phoneNumber}`);
          resolve({ clientId, message: 'Client is ready' });
        } else {
          this.logger.warn(
            `'ready' event received for ${phoneNumber} after promise was already resolved.`,
          );
        }
      });

      client.on('qr', (_qr: string) => {
        if (resolved || pairingCodeRequested) {
          this.logger.debug(
            `Ignoring extra QR event for ${phoneNumber} (resolved: ${resolved}, requested: ${pairingCodeRequested}).`,
          );
          return;
        }
        pairingCodeRequested = true;
        newClient.ready = true;
        newClient.verified = false;
        this.clients.set(clientId, newClient);

        this.logger.log(
          `QR received for ${phoneNumber}, requesting pairing code...`,
        );
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
              clearTimeout(timeout);
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
              clearTimeout(timeout);
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

  /**
   * Verifies the pairing code provided by the end user by updating Redis.
   * Note: This assumes the 'ready' event will fire on the client instance
   * after successful pairing, which will handle the final verification state.
   * This method primarily confirms the user action.
   */
  async verifyCode(phoneNumber: string): Promise<{ message: string }> {
    const clientId = phoneNumber;
    this.logger.log(`Processing verification for phoneNumber: ${phoneNumber}`);

    const connection = this.clients.get(clientId);
    if (!connection) {
      const errorMsg = `Client for phone number ${phoneNumber} not found in memory during verification. It might have disconnected.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (!connection.ready) {
      const errorMsg = `Client ${phoneNumber} is not ready for verification.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    connection.verified = true;
    await this.redisClient.set(
      this.getRedisKey(clientId),
      JSON.stringify(this.toClientMeta(connection)),
    );

    this.logger.log(
      `Client ${phoneNumber} marked as verified in Redis and memory. Waiting for 'ready' event for final confirmation.`,
    );
    return { message: 'Verification processed. Client should become ready.' };
  }

  /**
   * Checks if a client associated with the phone number is verified in Redis.
   */
  async isClientVerified(phoneNumber: string): Promise<boolean> {
    const redisKey = this.getRedisKey(phoneNumber);
    const data = await this.redisClient.get(redisKey);
    if (!data) {
      this.logger.warn(
        `No Redis record found for ${phoneNumber} during verification check.`,
      );
      return false;
    }
    try {
      const parsedData = JSON.parse(data) as ClientMeta;
      return parsedData.verified;
    } catch (e) {
      this.logger.error(
        `Failed to parse Redis data for ${phoneNumber} during verification check: ${data}`,
        e,
      );
      return false;
    }
  }
}
