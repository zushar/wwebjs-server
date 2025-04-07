// connect.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ClientFactoryService } from './client-factory.service';
import { Client } from 'whatsapp-web.js';
import { REDIS_CLIENT } from '../redis/redis.module';

// Define a type for the data stored in Redis for clarity
type ClientRedisData = {
  verified: boolean;
};

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);
  private readonly redisClientPrefix = 'whatsapp:client:';

  // In-memory storage for runtime WhatsApp client instances.
  private clients: Map<
    string,
    { client: Client; ready: boolean; verify: boolean }
  > = new Map();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly clientFactory: ClientFactoryService,
  ) {}

  /**
   * Generates the Redis key for a given phone number.
   */
  private getRedisKey(phoneNumber: string): string {
    return `${this.redisClientPrefix}${phoneNumber}`;
  }

  /**
   * Retrieves the active WhatsApp client instance.
   * Throws an error if the client is not found or not ready.
   */
  getClient(phoneNumber: string): {
    client: Client;
    ready: boolean;
    verify: boolean;
  } {
    const clientData = this.clients.get(phoneNumber);
    if (!clientData) {
      const errorMsg = `Client for phone number ${phoneNumber} not found in memory`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    // Note: The 'ready' check here refers to the wweb.js client being initialized,
    // not necessarily verified via pairing code. Verification status is checked
    // separately if needed by the calling function (like in wwebjs.services).
    if (!clientData.ready) {
      const errorMsg = `Client for phone number ${phoneNumber} is not ready`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    this.logger.log(`Client ${phoneNumber} found in memory and ready.`);
    return clientData;
  }

  /**
   * Creates (or reinitializes) a WhatsApp client using LocalAuth and returns a pairingCode if needed.
   * Stores verification status in Redis.
   */
  async createVerificationCode(
    phoneNumber: string,
  ): Promise<{ clientId: string; pairingCode?: string }> {
    const clientId = phoneNumber;
    const redisKey = this.getRedisKey(clientId);
    this.logger.log(`Initializing WhatsApp client for: ${phoneNumber}`);

    // Check Redis for existing verification status (optional, but good practice)
    const existingData = await this.redisClient.get(redisKey);
    let isVerified = false;
    if (existingData) {
      try {
        const parsedData = JSON.parse(existingData) as ClientRedisData;
        isVerified = parsedData.verified;
        this.logger.log(
          `Found existing Redis data for ${phoneNumber}: verified=${isVerified}`,
        );
      } catch (e) {
        this.logger.error(
          `Failed to parse Redis data for ${phoneNumber}: ${existingData}`,
          e,
        );
        // Proceed as if no data exists
      }
    }

    // If client already exists in memory, destroy it before creating a new one
    if (this.clients.has(clientId)) {
      this.logger.warn(
        `Client ${clientId} already exists in memory. Destroying previous instance.`,
      );
      try {
        const oldClientData = this.clients.get(clientId);
        await oldClientData?.client.destroy();
      } catch (error) {
        this.logger.error(
          `Error destroying previous client instance for ${clientId}:`,
          error,
        );
      }
      this.clients.delete(clientId);
    }

    const client = this.clientFactory.createClient(phoneNumber);

    // Store the client instance immediately in memory, marked as not ready/verified yet
    this.clients.set(clientId, {
      client: client,
      ready: false, // Will be set true on 'ready' or 'qr'
      verify: false, // Will be set true on successful verification
    });

    return new Promise<{ clientId: string; pairingCode?: string }>(
      (resolve, reject) => {
        let resolved = false;
        let pairingCodeRequested = false;

        // Set a timeout to prevent hanging indefinitely
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.logger.error(
              `Timed out waiting for client event (ready/qr) for ${phoneNumber}`,
            );
            // Clean up client instance if timeout occurs before ready/qr
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
        }, 60000); // 60 second timeout

        // Set up loading screen logging for better debugging
        client.on('loading_screen', (percent, message) => {
          this.logger.log(
            `WhatsApp loading [${clientId}]: ${percent}% - ${
              message || 'Loading...'
            }`,
          );
        });

        // If a valid session exists, the client will quickly become ready.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        client.on('ready', async () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.logger.log(`Client ready for ${phoneNumber}`);

            // Update Redis to mark the client as verified.
            const dataToStore: ClientRedisData = { verified: true };
            await this.redisClient.set(redisKey, JSON.stringify(dataToStore));
            this.logger.log(
              `Stored verified status in Redis for ${phoneNumber}`,
            );

            // Update the in-memory client state.
            const currentClient = this.clients.get(clientId);
            if (currentClient) {
              currentClient.ready = true;
              currentClient.verify = true; // Ready implies verified in this flow
            } else {
              // Should not happen, but log if it does
              this.logger.warn(
                `Client ${clientId} not found in memory map during 'ready' event`,
              );
              this.clients.set(clientId, {
                client: client,
                ready: true,
                verify: true,
              });
            }
            resolve({ clientId });
          } else {
            this.logger.warn(
              `'ready' event received for ${phoneNumber} after promise was already resolved.`,
            );
          }
        });

        // In the absence of a valid session, the client emits a QR event.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        client.on('qr', (_qr: string) => {
          // Ignore further QR events if we've already resolved or requested code
          if (resolved || pairingCodeRequested) {
            this.logger.debug(
              `Ignoring extra QR event for ${phoneNumber} (resolved: ${resolved}, requested: ${pairingCodeRequested}).`,
            );
            return;
          }
          pairingCodeRequested = true; // Prevent multiple requests

          // Update in-memory state to ready (client is initialized enough for pairing)
          const currentClient = this.clients.get(clientId);
          if (currentClient) {
            currentClient.ready = true; // Ready to receive pairing code
          } else {
            this.logger.warn(
              `Client ${clientId} not found in memory map during 'qr' event`,
            );
            this.clients.set(clientId, {
              client: client,
              ready: true,
              verify: false,
            });
          }

          this.logger.log(
            `QR received for ${phoneNumber}, requesting pairing code...`,
          );
          void client
            .requestPairingCode(phoneNumber)
            .then(async (pairingCode: string) => {
              this.logger.log(
                `Pairing code received for ${phoneNumber}: ${pairingCode}`,
              );

              // Update Redis to mark the client as not verified yet.
              const dataToStore: ClientRedisData = { verified: false };
              await this.redisClient.set(redisKey, JSON.stringify(dataToStore));
              this.logger.log(
                `Stored unverified status in Redis for ${phoneNumber}`,
              );

              // Resolve the promise with the pairing code
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
                // Clean up client instance on pairing code failure
                this.clients.delete(clientId);
                client
                  .destroy()
                  .catch((e) =>
                    this.logger.error(
                      `Error destroying client on pairing code failure for ${phoneNumber}:`,
                      e,
                    ),
                  );
                reject(
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
            });
        });

        // Handle authentication failures.
        client.on('auth_failure', (error: unknown) => {
          this.logger.error(
            `Authentication failure for ${phoneNumber}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            // Clean up client instance on auth failure
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

        // Handle disconnections
        client.on('disconnected', (reason) => {
          this.logger.warn(
            `Client ${phoneNumber} disconnected: ${reason}. Removing from active clients.`,
          );
          // Remove from in-memory map on disconnect
          this.clients.delete(clientId);
          // Optionally update Redis status on disconnect? Depends on requirements.
          // For now, we assume re-connection requires re-verification.
          // const dataToStore: ClientRedisData = { verified: false };
          // this.redisClient.set(redisKey, JSON.stringify(dataToStore)).catch(e =>
          //   this.logger.error(`Failed to update Redis on disconnect for ${phoneNumber}`, e)
          // );
        });

        // Initialize the client after all event handlers are registered
        this.logger.log(`Starting client initialization for ${phoneNumber}...`);
        client.initialize().catch((error) => {
          this.logger.error(
            `Failed to initialize client for ${phoneNumber}:`,
            error,
          );
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            // Clean up client instance on initialization failure
            this.clients.delete(clientId);
            // No need to call destroy if initialize failed early
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    );
  }

  /**
   * Verifies the pairing code provided by the end user by updating Redis.
   * Note: This assumes the 'ready' event will fire on the client instance
   * after successful pairing, which will handle the final verification state.
   * This method primarily confirms the user action.
   */
  async verifyCode(phoneNumber: string): Promise<{ message: string }> {
    const clientId = phoneNumber;
    const redisKey = this.getRedisKey(clientId);
    this.logger.log(`Processing verification for phoneNumber: ${phoneNumber}`);

    const connection = this.clients.get(clientId);
    if (!connection) {
      // It's possible the client disconnected between create and verify
      const errorMsg = `Client for phone number ${phoneNumber} not found in memory during verification. It might have disconnected.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Check if client is ready (should be if QR was generated)
    if (!connection.ready) {
      const errorMsg = `Client ${phoneNumber} is not ready for verification.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Update Redis to mark as verified
    const dataToStore: ClientRedisData = { verified: true };
    await this.redisClient.set(redisKey, JSON.stringify(dataToStore));

    // Update in-memory state
    connection.verify = true;

    this.logger.log(
      `Client ${phoneNumber} marked as verified in Redis and memory. Waiting for 'ready' event for final confirmation.`,
    );
    // The actual confirmation happens when the 'ready' event fires after pairing.
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
      const parsedData = JSON.parse(data) as ClientRedisData;
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
