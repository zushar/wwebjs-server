// session-restore.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import Redis from 'ioredis';
import * as path from 'path';
import { ProxyManagerService } from '../proxy/proxy-manager.service';
import { ClientFactoryService } from './client-factory.service';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientState } from './client-meta.type';
import { ClientSessionManagerService } from './client-session-manager.service';
import { SessionPersistenceService } from './session-persistence.service';

const SESSIONS_BASE_PATH = path.resolve(process.cwd(), './sessions');

@Injectable()
export class SessionRestoreService {
  private readonly logger = new Logger(SessionRestoreService.name);

  constructor(
    private readonly clientFactory: ClientFactoryService,
    private readonly proxyManager: ProxyManagerService,
    private readonly sessionManager: ClientSessionManagerService,
    private readonly persistence: SessionPersistenceService,
    private readonly lifecycle: ClientLifecycleService,
  ) {}

 /**
   * Scans the session directory, reads Redis metadata, and attempts to
   * re-initialize clients that have persisted sessions and were verified.
   */
  async restorePersistedClients(): Promise<void> {
    try {
          // Ensure the base sessions directory exists
          await fs.mkdir(SESSIONS_BASE_PATH, { recursive: true });
          this.logger.log(`Reading sessions from: ${SESSIONS_BASE_PATH}`);
    
          const entries = await fs.readdir(SESSIONS_BASE_PATH, { withFileTypes: true });
          const sessionDirs = entries.filter(
            (entry) => entry.isDirectory() && entry.name.startsWith('session-'),
          );
    
          this.logger.log(`Found ${sessionDirs.length} potential session directories.`);
    
          for (const dir of sessionDirs) {
            const clientId = dir.name.substring('session-'.length);
            if (!clientId) {
              this.logger.warn(`Skipping invalid session directory name: ${dir.name}`);
              continue;
            }
    
            this.logger.log(`Checking persisted session for clientId: ${clientId}`);
    
            // Check if client is already managed (e.g., during development hot-reloads)
            if (this.sessionManager.getClient(clientId)) {
                this.logger.log(`Client ${clientId} is already managed in memory, skipping restore.`);
                continue;
            }
    
            // 1. Retrieve metadata from Redis
            const clientMeta = await this.persistence.getClientMeta(clientId);
    
            if (!clientMeta) {
              this.logger.warn(
                `No Redis metadata found for persisted session ${clientId}. Cannot restore. Consider cleaning up session directory ${dir.name}.`,
              );
              // Optionally: Clean up the session directory if no Redis record exists
              // await this.cleanupSessionFiles(clientId);
              continue;
            }
    
            // 2. Only restore if the client was previously verified
            if (!clientMeta.verified) {
              this.logger.log(
                `Session for ${clientId} exists but was not verified according to Redis. Skipping restore. It might require re-pairing.`,
              );
               // Optionally: Clean up the session directory if not verified?
               // await this.cleanupSessionFiles(clientId);
              continue;
            }
    
            // 3. Attempt to re-initialize
            this.logger.log(
              `Restoring verified client ${clientId} (Type: ${clientMeta.type}, Proxy: ${clientMeta.proxy || 'None'})...`,
            );
    
            let proxyAllocated = false;
            try {
            
              if (clientMeta.proxy) {
                const success = this.proxyManager.incrementUsage(clientMeta.proxy);
                if (success) {
                  this.logger.log(`Successfully incremented usage count for proxy ${clientMeta.proxy} during restore of ${clientId}.`);
                  proxyAllocated = true;
                } else {
                     this.logger.error(`Failed to re-increment usage for proxy ${clientMeta.proxy} for client ${clientId} during restore. Proxy might be full or removed. Client will start without proxy.`);
                     clientMeta.proxy = null; 
                }
              }
    
    
              const client = await this.clientFactory.createClient(
                clientId // Use the proxy from Redis
              );
    
              const restoredClientState: ClientState = {
                id: clientId,
                client: client,
                ready: false, // Will be set to true by 'ready' event
                verified: true, // Assume verified since we're restoring
                lastActive: clientMeta.lastActive || Date.now(), // Use stored time or now
                clientType: clientMeta.type,
                proxy: clientMeta.proxy,
              };
    
              // Add to in-memory map *before* initializing
              this.sessionManager.setClientState(clientId, restoredClientState);
    
              // Setup listeners *before* calling initialize
              this.lifecycle.setupClientListeners(clientId, restoredClientState);
    
              // Initialize the client (don't await here, let it run in background)
              // The 'ready' or 'disconnected'/'auth_failure' events will handle state updates.
              client.initialize().catch((initError) => {
                // Handle initialization errors specifically for restored clients
                this.logger.error(
                  `Error initializing restored client ${clientId}: ${initError.message}`,
                  initError.stack,
                );
                // Ensure cleanup happens even if initialization promise rejects
                this.handleRestoredClientInitializationFailure(clientId);
              });
    
              this.logger.log(`Initialization started for restored client ${clientId}. Waiting for 'ready' event...`);
    
            } catch (restoreError: any) {
              this.logger.error(
                `Failed to restore client ${clientId}: ${restoreError.message}`,
                restoreError.stack,
              );
               // If proxy count was incremented but client creation failed, release it.
               if (proxyAllocated && clientMeta.proxy) {
                this.proxyManager.release(clientMeta.proxy);
              }
              // Optionally delete the problematic session dir?
               // await this.cleanupSessionFiles(clientId);
            }
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to read session directory ${SESSIONS_BASE_PATH}: ${error.message}`,
            error.stack,
          );
        }
      }

     /**
     * Handles cleanup when a restored client fails its background initialization.
     */
    private handleRestoredClientInitializationFailure(clientId: string): void {
       // Use a timeout to ensure cleanup runs even if disconnect/auth_failure events don't fire quickly
       setTimeout(async () => {
           if (this.sessionManager.getClient(clientId)) { // Check if cleanup wasn't already triggered by an event
               this.logger.error(`Restored client ${clientId} failed to initialize properly. Triggering cleanup.`);
               await this.lifecycle.cleanupClient(clientId);
           }
       }, 5000); // Wait 5 seconds before forced cleanup
    }
}
