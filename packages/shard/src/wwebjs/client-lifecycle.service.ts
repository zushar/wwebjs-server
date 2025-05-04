// client-lifecycle.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientType } from '@whatsapp-cluster/shared-lib';
import fs from 'fs/promises';
import Redis from 'ioredis';
import path from 'path';
import { REDIS_CLIENT } from 'src/redis/redis.module';
import { ProxyManagerService } from '../proxy/proxy-manager.service';
import { ClientFactoryService } from './client-factory.service';
import { ClientState } from './client-meta.type';
import { ClientSessionManagerService } from './client-session-manager.service';
import { SessionPersistenceService } from './session-persistence.service';

@Injectable()
export class ClientLifecycleService {
  private readonly logger = new Logger(ClientLifecycleService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly clientFactory: ClientFactoryService,
    private readonly proxyManager: ProxyManagerService,
    private readonly sessionManager: ClientSessionManagerService,
    private readonly persistence: SessionPersistenceService,
  ) {}

  /**
   * Creates (or reinitializes) a WhatsApp client using LocalAuth and returns a pairingCode if needed.
   * Allocates a proxy if available.
   * Stores verification status in Redis.
   */
  async createVerificationCode(
    phoneNumber: string,
    clientType: ClientType,
    verifiedInitially = false,
  ): Promise<{
    clientId: string;
    pairingCode?: string;
    message?: string;
    needsPairing?: boolean;
  }> {
    const clientId = phoneNumber;
    this.logger.log(`Initiating connection process for: ${clientId}`);

    // בדיקה אם הקליינט כבר קיים
    const existingClientState = this.sessionManager.getClientState(clientId);
    if (existingClientState) {
      // Decide how to handle existing clients - maybe return status?
      if (existingClientState.verified && existingClientState.ready) {
        this.logger.log(`Client ${clientId} already connected and verified.`);
        return { clientId, message: 'Client already connected and verified', needsPairing: false };
      } else if (!existingClientState.verified && existingClientState.ready) {
        this.logger.log(`Client ${clientId} exists but needs pairing.`);
        return { clientId, message: 'Client requires pairing code.', needsPairing: true };
      } else {
        this.logger.log(`Client ${clientId} exists but is not ready. Waiting...`);
        return { clientId, message: 'Client initialization in progress.', needsPairing: !existingClientState.verified };
      }
    }

    // הקצאת פרוקסי
    let allocatedProxy: string | null = null;
    try {
      allocatedProxy = this.proxyManager.allocate();
      if (allocatedProxy) {
        this.logger.log(`Successfully allocated proxy for ${clientId}: ${allocatedProxy}`);
      } else {
        this.logger.log(`Proceeding without proxy for ${clientId} as none were allocated/configured.`);
      }
    } catch (error) {
      this.logger.error(`Proxy allocation failed for ${clientId}: ${error.message}`, error.stack);
      throw error;
    }

    // יצירת קליינט חדש
    const client = await this.clientFactory.createClient(phoneNumber, allocatedProxy);

    const newClientState: ClientState = {
      id: clientId,
      client: client,
      ready: false,
      verified: verifiedInitially,
      lastActive: Date.now(),
      clientType: clientType,
      proxy: allocatedProxy,
    };
    this.sessionManager.setClientState(clientId, newClientState);

    // שמירת סטטוס ראשוני ב-Redis
    if (!verifiedInitially) {
      await this.redisClient.set(
        this.persistence.getRedisKey(clientId),
        JSON.stringify(this.sessionManager.toClientMeta(newClientState)),
      );
      this.logger.log(`Stored initial (unverified) status in Redis for ${clientId}`);
    }

    // החזרת Promise שיתממש כאשר הקליינט מוכן או כאשר מתקבל קוד צימוד
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
          this.cleanupClient(clientId);
          reject(error);
        }
      };

      const timeout = setTimeout(() => {
        handleRejection(new Error(`Timed out waiting for client event (ready/qr) for ${clientId}`));
      }, 90000);

      // הגדרת מאזינים לאירועים
      this.setupClientListeners(
        clientId,
        newClientState,
        false,
        handleResolution,
        handleRejection
      );

      // התחלת אתחול הקליינט
      this.logger.log(`Starting client initialization for ${clientId}...`);
      client.initialize().catch((error) => {
        if (error instanceof Error) {
          this.logger.error(`Client initialization failed for ${clientId}: ${error.message}`, error.stack);
          handleRejection(error);
        } else if (typeof error === 'object' && error !== null) {
          try {
            const errorStr = JSON.stringify(error, Object.getOwnPropertyNames(error) || Object.keys(error));
            this.logger.error(`Client initialization failed for ${clientId} with object: ${errorStr}`);
            handleRejection(new Error(`Initialization failed: ${errorStr}`));
          } catch (jsonError) {
            this.logger.error(`Client initialization failed for ${clientId} with non-serializable object`, error);
            handleRejection(new Error(`Initialization failed with non-serializable object`));
          }
        } else {
          this.logger.error(`Client initialization failed for ${clientId} with: ${String(error)}`);
          handleRejection(new Error(`Initialization failed: ${String(error)}`));
        }
      });
    });
  }

  /**
   * Cleans up client resources: destroys client, releases proxy, removes from map, deletes Redis key and session files.
   */
  async cleanupClient(clientId: string): Promise<void> {
    const clientState = this.sessionManager.getClientState(clientId);

    // הסרה מהמפה בזיכרון
    if (!this.sessionManager.removeClient(clientId)) {
      this.logger.warn(`Attempted to clean up client ${clientId}, but it was not found in the active map.`);
    } else {
      this.logger.log(`Removed client ${clientId} from active map.`);
    }

    if (!clientState) {
      this.logger.warn(`No client state found for ${clientId} during cleanup details execution.`);
      await this.persistence.cleanupRedisAndFiles(clientId);
      return;
    }

    // שחרור פרוקסי
    if (clientState.proxy) {
      this.proxyManager.release(clientState.proxy);
      this.logger.log(`Released proxy ${clientState.proxy} for client ${clientId}.`);
    }

    // הריסת קליינט
    if (clientState.client) {
      try {
        await clientState.client.destroy();
        this.logger.log(`Destroyed wwebjs client instance for ${clientId}.`);
      } catch (e: any) {
        this.logger.error(`Error destroying client instance for ${clientId}: ${e.message}`, e.stack);
      }
    } else {
      this.logger.warn(`No client instance found in state for ${clientId} during destroy attempt.`);
    }

    // מחיקת מפתח Redis וקבצי סשן
    await this.persistence.cleanupRedisAndFiles(clientId);
  }

  /**
   * Disconnects a client and cleans up its state.
   */
  async disconnectClient(clientId: string): Promise<{ success: boolean, message: string }> {
    this.logger.log(`Disconnect requested for clientId: ${clientId}`);
    const clientState = this.sessionManager.getClientState(clientId);

    if (!clientState) {
      // בדיקה אם יש מידע ב-Redis
      const redisKey = this.persistence.getRedisKey(clientId);
      const existsInRedis = await this.redisClient.exists(redisKey);
      if (existsInRedis) {
        await this.redisClient.del(redisKey);
        this.logger.log(`Client ${clientId} not in memory, but removed stale Redis key.`);
        // ניסיון למחוק גם קבצי סשן
        const authPath = path.resolve('./sessions', `session-${clientId}`);
        try {
          await fs.rm(authPath, { recursive: true, force: true });
        } catch (e: any) {
          if (e.code !== 'ENOENT') {
            this.logger.error(`Error deleting session files for inactive client ${clientId}:`, e);
          }
        }
        return { success: true, message: 'Client not active, stale data cleaned up.' };
      } else {
        return { success: false, message: 'Client not found.' };
      }
    }

    try {
      await this.cleanupClient(clientId);
      return { success: true, message: 'Client disconnected successfully.' };
    } catch (error: any) {
      this.logger.error(`Error during explicit disconnect for ${clientId}: ${error.message}`, error.stack);
      // ניסיון לנקות משאבים גם אם הניתוק נכשל
      this.sessionManager.removeClient(clientId);
      if (clientState.proxy) this.proxyManager.release(clientState.proxy);
      try {
        await this.redisClient.del(this.persistence.getRedisKey(clientId));
      } catch (e) {/* ignore */}
      return { success: false, message: `Disconnect failed: ${error.message}` };
    }
  }

  /**
   * Verifies the client state in memory and Redis.
   */
  async verifyCode(phoneNumber: string): Promise<{ success: boolean, message: string }> {
    const clientId = phoneNumber;
    this.logger.log(`Processing verification check for clientId: ${clientId}`);

    const clientState = this.sessionManager.getClientState(clientId);

    if (!clientState) {
      // בדיקה ב-Redis אם לא נמצא בזיכרון
      const meta = await this.persistence.getClientMeta(clientId);
      if (meta?.verified) {
        this.logger.log(`Client ${clientId} not in memory but verified in Redis. Needs re-initialization.`);
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
      // עדכון סטטוס אימות
      this.logger.warn(`Client ${clientId} is ready but not marked verified. Marking as verified now.`);
      clientState.verified = true;
      clientState.lastActive = Date.now();
      this.sessionManager.setClientState(clientId, clientState);
      try {
        await this.redisClient.set(
          this.persistence.getRedisKey(clientId),
          JSON.stringify(this.sessionManager.toClientMeta(clientState)),
        );
        this.logger.log(`Forcefully updated verification status in Redis for ${clientId}.`);
        return { success: true, message: 'Client verification confirmed.' };
      } catch (redisError: any) {
        this.logger.error(`Failed to update Redis during manual verification for ${clientId}: ${redisError.message}`, redisError.stack);
        return { success: false, message: 'Client verified in memory, but failed to update persistent state.' };
      }
    }

    this.logger.log(`Client ${clientId} is already ready and verified.`);
    return { success: true, message: 'Client already verified and ready.' };
  }

  /**
   * Sets up event listeners for a client instance.
   * Works for both new and restored clients.
   */
  setupClientListeners(
    clientId: string,
    state: ClientState,
    isRestored: boolean = false,
    resolveCallback?: (result: any) => void,
    rejectCallback?: (error: Error) => void
  ): void {
    const { client } = state;

    // מאזין למסך טעינה
    client.on('loading_screen', (percent, message) => {
      this.logger.log(
        `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
      );
    });

    // מאזין לאירוע 'ready'
    client.on('ready', async () => {
      if (isRestored) {
        this.logger.log(`Restored client ${clientId} is ready!`);
      } else {
        this.logger.log(`Client ready for ${clientId}`);
      }

      // עדכון סטטוס
      state.ready = true;
      state.verified = true;
      state.lastActive = Date.now();
      this.sessionManager.setClientState(clientId, state);

      try {
        // שמירה ב-Redis
        await this.redisClient.set(
          this.persistence.getRedisKey(clientId),
          JSON.stringify(this.sessionManager.toClientMeta(state)),
        );
        this.logger.log(`Stored verified status in Redis for ${clientId}`);

        // רק לקליינטים חדשים - קריאה ל-resolveCallback
        if (!isRestored && resolveCallback) {
          resolveCallback({ clientId, message: 'Client is ready', needsPairing: false });
        }
      } catch (redisError: any) {
        this.logger.error(`Failed to update Redis on 'ready' for ${clientId}: ${redisError.message}`, redisError.stack);
        // רק לקליינטים חדשים - קריאה ל-resolveCallback עם הודעת שגיאה
        if (!isRestored && resolveCallback) {
          resolveCallback({ clientId, message: 'Client is ready (Redis update failed)', needsPairing: false });
        }
      }
    });

    // מאזין לאירוע 'qr' (רק רלוונטי לקליינטים חדשים)
    if (!isRestored) {
      client.on('qr', (_qr: string) => {
        // בדיקה אם כבר טופל
        if (resolveCallback && state.id === clientId) {
          state.ready = true;
          state.verified = false;
          this.sessionManager.setClientState(clientId, state);

          this.logger.log(`QR received for ${clientId}, requesting pairing code...`);
          void client
            .requestPairingCode(clientId)
            .then(async (pairingCode: string) => {
              this.logger.log(`Pairing code received for ${clientId}: ${pairingCode}`);
              resolveCallback({ clientId, pairingCode, needsPairing: true });
            })
            .catch((error: unknown) => {
              if (rejectCallback) {
                rejectCallback(error instanceof Error ? error : new Error(`Failed to get pairing code: ${String(error)}`));
              }
            });
        }
      });
    }

    // מאזין לאירוע 'auth_failure'
    client.on('auth_failure', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Authentication failure for client ${clientId}: ${message}. Cleaning up.`);
      void this.cleanupClient(clientId);

      // רק לקליינטים חדשים - קריאה ל-rejectCallback
      if (!isRestored && rejectCallback) {
        rejectCallback(new Error('Authentication failure: ' + message));
      }
    });

    // מאזין לאירוע 'disconnected'
    client.on('disconnected', async (reason: string | any) => {
      // בדיקה אם הקליינט עדיין קיים במפה (למניעת כפילות ניקוי)
      if (this.sessionManager.hasClient(clientId)) {
        this.logger.warn(`Client ${clientId} disconnected: ${reason}. Cleaning up.`);
        await this.cleanupClient(clientId);

        // רק לקליינטים חדשים - קריאה ל-rejectCallback
        if (!isRestored && rejectCallback && !state.verified) {
          rejectCallback(new Error(`Client disconnected during setup: ${reason}`));
        }
      } else {
        this.logger.log(`Client ${clientId} received disconnect event after cleanup started, ignoring.`);
      }
    });
  }
}
