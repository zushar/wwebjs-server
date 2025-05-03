// packages/shard/src/wwebjs/connect.service.ts
import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ClientMeta, ClientType } from '@whatsapp-cluster/shared-lib';
import * as fs from 'fs/promises';
import Redis from 'ioredis';
import * as path from 'path';
import { Client } from 'whatsapp-web.js';
import { ProxyManagerService } from '../proxy/proxy-manager.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ClientState } from './client-meta.type';

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);
  private clients: Map<string, ClientState> = new Map();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly clientFactory: ClientFactoryService,
    private readonly proxyManager: ProxyManagerService,
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
      proxy: state.proxy,
    };
  }

  /**
   * Creates (or reinitializes) a WhatsApp client using LocalAuth and returns a pairingCode if needed.
   * Allocates a proxy if available.
   * Stores verification status in Redis.
   */
  async createVerificationCode(
    phoneNumber: string,
    clientType: ClientType,
    verifiedInitially = false, // Renamed for clarity
  ): Promise<{
    clientId: string;
    pairingCode?: string;
    message?: string;
    needsPairing?: boolean; // Add this for clarity
  }> {
    const clientId = phoneNumber;
    this.logger.log(`Initiating connection process for: ${clientId}`);

    const existingClientState = this.clients.get(clientId);
    if (existingClientState) {
       // Decide how to handle existing clients - maybe return status?
      if (existingClientState.verified && existingClientState.ready) {
        this.logger.log(`Client ${clientId} already connected and verified.`);
         return { clientId, message: 'Client already connected and verified', needsPairing: false };
      } else if (!existingClientState.verified && existingClientState.ready) {
         this.logger.log(`Client ${clientId} exists but needs pairing.`);
         // Might need to re-request pairing code or return existing state?
         // For simplicity, let's assume we just return the state for now.
         // A robust implementation might re-trigger QR/Pairing if needed.
         return { clientId, message: 'Client requires pairing code.', needsPairing: true }; // Assume needs pairing again if not verified
      } else {
          this.logger.log(`Client ${clientId} exists but is not ready. Waiting...`);
          // Potentially wait or return a specific status
           return { clientId, message: 'Client initialization in progress.', needsPairing: !existingClientState.verified };
      }
    }

    let allocatedProxy: string | null = null;
    try {
      allocatedProxy = this.proxyManager.allocate(); // Allocate before creating client
      if (allocatedProxy) {
        this.logger.log(`Successfully allocated proxy for ${clientId}: ${allocatedProxy}`);
      } else {
         this.logger.log(`Proceeding without proxy for ${clientId} as none were allocated/configured.`);
      }
    } catch (error) {
      this.logger.error(`Proxy allocation failed for ${clientId}: ${error.message}`, error.stack);
      // Rethrow or handle - for gRPC, rethrowing might be okay if controller catches it
      throw error; // Let the controller handle the gRPC response
    }
    // --- End Allocate Proxy ---

    const client = await this.clientFactory.createClient(phoneNumber, allocatedProxy); // Pass proxy to factory

    const newClientState: ClientState = {
      id: clientId,
      client: client,
      ready: false,
      verified: verifiedInitially,
      lastActive: Date.now(),
      clientType: clientType,
      proxy: allocatedProxy, // Store the allocated proxy
    };
    this.clients.set(clientId, newClientState);

    // Store unverified status in Redis immediately if pairing is expected
    if (!verifiedInitially) {
        await this.redisClient.set(
            this.getRedisKey(clientId),
            JSON.stringify(this.toClientMeta(newClientState)),
        );
        this.logger.log(`Stored initial (unverified) status in Redis for ${clientId}`);
    }


    return new Promise<{
      clientId: string;
      pairingCode?: string;
      message?: string;
      needsPairing?: boolean;
    }>((resolve, reject) => {
      let resolved = false;
      let pairingCodeRequested = false;

      const handleResolution = (result: { clientId: string; pairingCode?: string; message?: string; needsPairing?: boolean; }) => {
          if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(result);
          } else {
               this.logger.warn(`Event triggered for ${clientId} after promise was already resolved. Result: ${JSON.stringify(result)}`);
          }
      };

       const handleRejection = (error: Error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                this.logger.error(`Client connection failed for ${clientId}: ${error.message}`, error.stack);
                this.cleanupClient(clientId); // Use cleanup helper
                reject(error);
            }
        };


      const timeout = setTimeout(() => {
         handleRejection(new Error(`Timed out waiting for client event (ready/qr) for ${clientId}`));
      }, 90000); // Increased timeout to 90s

      client.on('loading_screen', (percent, message) => {
        this.logger.log(
          `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
        );
      });

      client.on('ready', async () => {
        this.logger.log(`Client ready for ${clientId}`);
        newClientState.ready = true;
        newClientState.verified = true; // 'ready' implies successful auth/pairing
        newClientState.lastActive = Date.now();
        this.clients.set(clientId, newClientState); // Update state in memory

        try {
            await this.redisClient.set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClientState)), // Store updated meta
            );
            this.logger.log(`Stored verified status in Redis for ${clientId}`);
            handleResolution({ clientId, message: 'Client is ready', needsPairing: false });
        } catch(redisError) {
            this.logger.error(`Failed to update Redis on 'ready' for ${clientId}: ${redisError.message}`, redisError.stack);
            // Decide how critical Redis failure is here. Maybe proceed but log error?
             handleResolution({ clientId, message: 'Client is ready (Redis update failed)', needsPairing: false });
        }
      });

      client.on('qr', (_qr: string) => {
        if (resolved || pairingCodeRequested) {
          this.logger.debug(
            `Ignoring extra QR event for ${clientId} (resolved: ${resolved}, requested: ${pairingCodeRequested}).`,
          );
          return;
        }
        pairingCodeRequested = true;
        newClientState.ready = true; // Mark as ready (can receive QR) but not verified
        newClientState.verified = false;
        this.clients.set(clientId, newClientState); // Update state

        this.logger.log(
          `QR received for ${clientId}, requesting pairing code...`,
        );
        void client
          .requestPairingCode(phoneNumber) // Use phoneNumber here
          .then(async (pairingCode: string) => {
            this.logger.log(
              `Pairing code received for ${clientId}: ${pairingCode}`,
            );
            // Redis status was already set as unverified earlier
            handleResolution({ clientId, pairingCode, needsPairing: true });
          })
          .catch((error: unknown) => {
             handleRejection(error instanceof Error ? error : new Error(`Failed to get pairing code: ${String(error)}`));
          });
      });

       client.on('auth_failure', (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            handleRejection(new Error('Authentication failure: ' + message));
        });

      client.on('disconnected', async (reason) => {
         this.logger.warn( `Client ${clientId} disconnected: ${reason}. Cleaning up.`);
         await this.cleanupClient(clientId); // Use cleanup helper
         // If the promise wasn't resolved yet (e.g., disconnect during initial pairing), reject it.
         if (!resolved) {
              handleRejection(new Error(`Client disconnected during setup: ${reason}`));
         }
      });

      this.logger.log(`Starting client initialization for ${clientId}...`);
      client.initialize().catch((error) => {
        // Improve error logging for better diagnostics
        if (error instanceof Error) {
          this.logger.error(`Client initialization failed for ${clientId}: ${error.message}`, error.stack);
          handleRejection(error);
        } else if (typeof error === 'object') {
          // Handle case where error is an object but not an Error instance
          try {
            const errorStr = JSON.stringify(error, Object.getOwnPropertyNames(error) || Object.keys(error));
            this.logger.error(`Client initialization failed for ${clientId} with object: ${errorStr}`);
            handleRejection(new Error(`Initialization failed: ${errorStr}`));
          } catch (jsonError) {
            this.logger.error(`Client initialization failed for ${clientId} with non-serializable object`, error);
            handleRejection(new Error(`Initialization failed with non-serializable object`));
          }
        } else {
          // Handle other error types
          this.logger.error(`Client initialization failed for ${clientId} with: ${String(error)}`);
          handleRejection(new Error(`Initialization failed: ${String(error)}`));
        }
      });
    });
  }

  /**
    * Cleans up client resources: destroys client, releases proxy, removes from map, deletes Redis key and session files.
  */
  private async cleanupClient(clientId: string): Promise<void> {
    const clientState = this.clients.get(clientId);
    if (!clientState) {
        this.logger.warn(`Attempted to clean up client ${clientId}, but it was not found in memory.`);
        return;
    }

    // 1. Release Proxy
    if (clientState.proxy) {
        this.proxyManager.release(clientState.proxy);
    }

    // 2. Remove from memory map
    this.clients.delete(clientId);
    this.logger.log(`Removed client ${clientId} from active map.`);

    // 3. Destroy wwebjs client
    try {
        await clientState.client.destroy();
        this.logger.log(`Destroyed wwebjs client instance for ${clientId}.`);
    } catch (e) {
        this.logger.error(`Error destroying client instance for ${clientId}:`, e.stack);
    }

    // 4. Delete Redis key
    try {
        await this.redisClient.del(this.getRedisKey(clientId));
        this.logger.log(`Deleted Redis key for ${clientId}.`);
    } catch (e) {
        this.logger.error(`Error deleting Redis key for ${clientId}:`, e.stack);
    }

    // 5. Delete session files (using fs/promises)
    const authPath = path.resolve('./sessions', `session-${clientId}`); // Use path.resolve
    try {
        await fs.rm(authPath, { recursive: true, force: true });
        this.logger.log(`Session files deleted for ${clientId} at ${authPath}`);
    } catch (err) {
        // Ignore error if directory doesn't exist (ENOENT)
        if (err.code !== 'ENOENT') {
            this.logger.error(`Error deleting session files for ${clientId} at ${authPath}:`, err);
        } else {
             this.logger.log(`Session directory ${authPath} not found, skipping deletion.`);
        }
    }
}


/**
 * Verifies the client state in memory and Redis.
 * This might be called after the 'ready' event or by the VerifyConnection endpoint.
 */
async verifyCode(phoneNumber: string): Promise<{ success: boolean, message: string }> {
  const clientId = phoneNumber;
  this.logger.log(`Processing verification check for clientId: ${clientId}`);

  const clientState = this.clients.get(clientId);

  if (!clientState) {
    // Maybe check Redis if not in memory?
     const meta = await this.getClientMeta(clientId);
     if (meta?.verified) {
         this.logger.log(`Client ${clientId} not in memory but verified in Redis. Needs re-initialization.`);
         // Consider triggering re-initialization or informing the user.
         return { success: true, message: 'Client session verified but requires re-initialization.' };
     } else {
          const errorMsg = `Client ${clientId} not found in memory or Redis during verification.`;
          this.logger.error(errorMsg);
          return { success: false, message: errorMsg };
     }
  }

   if (!clientState.ready) {
      const errorMsg = `Client ${clientId} is not ready for verification (still initializing/connecting).`;
      this.logger.warn(errorMsg);
      return { success: false, message: errorMsg };
   }

   if (!clientState.verified) {
      // This case implies pairing code was likely entered, but the 'ready' event hasn't fired yet,
      // or it fired but failed to update Redis. Let's update the state forcefully.
       this.logger.warn(`Client ${clientId} is ready but not marked verified. Marking as verified now.`);
       clientState.verified = true;
       clientState.lastActive = Date.now();
       this.clients.set(clientId, clientState);
       try {
           await this.redisClient.set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(clientState)),
           );
           this.logger.log(`Forcefully updated verification status in Redis for ${clientId}.`);
           return { success: true, message: 'Client verification confirmed.' };
       } catch (redisError) {
           this.logger.error(`Failed to update Redis during manual verification for ${clientId}: ${redisError.message}`, redisError.stack);
           return { success: false, message: 'Client verified in memory, but failed to update persistent state.' };
       }
   }

  this.logger.log(`Client ${clientId} is already ready and verified.`);
  return { success: true, message: 'Client already verified and ready.' };
}

// Add a dedicated disconnect method to be called by the controller
async disconnectClient(clientId: string): Promise<{ success: boolean, message: string }> {
    this.logger.log(`Disconnect requested for clientId: ${clientId}`);
    const clientState = this.clients.get(clientId);

    if (!clientState) {
        // Check Redis as well? Maybe delete stale Redis entry if found.
        const redisKey = this.getRedisKey(clientId);
        const existsInRedis = await this.redisClient.exists(redisKey);
        if (existsInRedis) {
            await this.redisClient.del(redisKey);
             this.logger.log(`Client ${clientId} not in memory, but removed stale Redis key.`);
             // Optionally try to remove session files too
             const authPath = path.resolve('./sessions', `session-${clientId}`);
             try { await fs.rm(authPath, { recursive: true, force: true }); } catch (e) { if (e.code !== 'ENOENT') this.logger.error(`Error deleting session files for inactive client ${clientId}:`, e);}
             return { success: true, message: 'Client not active, stale data cleaned up.' };
        } else {
            return { success: false, message: 'Client not found.' };
        }
    }

    try {
        await this.cleanupClient(clientId); // Use the centralized cleanup logic
        return { success: true, message: 'Client disconnected successfully.' };
    } catch (error) {
        this.logger.error(`Error during explicit disconnect for ${clientId}: ${error.message}`, error.stack);
        // Attempt cleanup even if destroy failed
         this.clients.delete(clientId);
         if (clientState.proxy) this.proxyManager.release(clientState.proxy);
         try { await this.redisClient.del(this.getRedisKey(clientId)); } catch (e) {/* ignore */}
        return { success: false, message: `Disconnect failed: ${error.message}` };
    }
}


// ... (isClientVerified remains mostly the same, might need minor logging adjustments)
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
