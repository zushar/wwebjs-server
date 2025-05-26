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
    this.logger.log(`checking client for phone number: ${phoneNumber}`);

    // אם הלקוח כבר קיים
    const clientData: ClientState | undefined = this.clients.get(clientId);
    if (clientData) {
      // רק אם הלקוח מוכן, נחזיר את המסר שהוא מוכן ומוסמך
      if (clientData.ready) {
        this.logger.log(`Client ${clientId} already exists and is ready.`);
        return {
          clientId: clientData.id,
          message: 'Client already exists and is ready',
        };
      }
      // אם הלקוח קיים אבל לא מוכן (עדיין בתהליך אימות)
      this.logger.log(`Client ${clientId} exists but is still authenticating.`);
      return {
        clientId: clientData.id,
        message: 'Client exists and is authenticating',
      };
    }

    // יצירת לקוח חדש
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
      let initialResponseSent = false;
      let pairingCodeRequested = false;

      const timeout = setTimeout(() => {
        if (!initialResponseSent) {
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
      }, 600000);

      // כאשר מתקבל קוד QR
      client.on('qr', () => {
        if (initialResponseSent || pairingCodeRequested) {
          this.logger.debug(
            `Ignoring extra QR event for ${phoneNumber} (initial response already sent: ${initialResponseSent}, requested: ${pairingCodeRequested}).`,
          );
          return;
        }

        pairingCodeRequested = true;

        this.logger.log(
          `QR received for ${phoneNumber}, requesting pairing code...`,
        );

        void client
          .requestPairingCode(phoneNumber)
          .then(async (pairingCode: string) => {
            this.logger.log(
              `Pairing code received for ${phoneNumber}: ${pairingCode}`,
            );

            // שמירת מצב הלקוח בRedis (עדיין לא מוכן)
            await this.redisClient.set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClient)),
            );

            if (!initialResponseSent) {
              initialResponseSent = true;
              clearTimeout(timeout);
              // החזרת קוד הצימוד למשתמש - השלב הראשון
              resolve({ clientId, pairingCode });
            }
          })
          .catch((error: unknown) => {
            this.logger.error(
              `Failed to get pairing code for ${phoneNumber}:`,
              error,
            );
            if (!initialResponseSent) {
              initialResponseSent = true;
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

      // כאשר הלקוח מוכן
      client.on('ready', () => {
        clearTimeout(timeout);
        this.logger.log(`Client ready event received for ${phoneNumber}`);

        // הערה: אירוע ready עשוי להתקבל לפני שהלקוח באמת מוכן לשימוש.
        // נמתין למצב טעינה של 100% או זמן מספיק ללא עדכוני טעינה.

        // הגדרת משתנים למעקב אחר הטעינה לפני השימוש בהם
        let lastLoadingUpdate = Date.now();
        let lastLoadingPercentage = 0;
        let readyMarked = false;

        // פונקציה לסימון הלקוח כמוכן - נשתמש בה בכל מקום שבו נרצה לסמן "מוכן"
        const markAsReady = () => {
          // בדיקה שהלקוח לא סומן כבר כמוכן
          if (readyMarked) {
            return;
          }
          readyMarked = true;

          // נקה את הטיימר וההאזנה
          clearInterval(readyCheckInterval);
          client.off('loading_screen', loadingHandler);

          this.logger.log(
            `Client fully loaded for ${phoneNumber}, marking as ready`,
          );
          newClient.ready = true;
          newClient.lastActive = Date.now();
          this.clients.set(clientId, newClient);

          // עדכון מצב הלקוח בRedis למוכן
          void this.redisClient
            .set(
              this.getRedisKey(clientId),
              JSON.stringify(this.toClientMeta(newClient)),
            )
            .catch((error) => {
              this.logger.error(
                `Failed to store Redis data for ${phoneNumber} on ready:`,
                error,
              );
            });

          // אם לא שלחנו עדיין תשובה ראשונית
          if (!initialResponseSent) {
            initialResponseSent = true;
            resolve({ clientId, message: 'Client is ready' });
          }
        };

        // מאזין לאירועי טעינה
        const loadingHandler = (percent: number, message: string) => {
          lastLoadingUpdate = Date.now();
          lastLoadingPercentage = percent;
          this.logger.log(
            `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
          );

          // אם הגענו ל-100%, נסמן כמוכן מיד
          if (percent >= 100) {
            this.logger.log(`Client reached 100% loading for ${phoneNumber}`);
            markAsReady();
          }
        };

        // הוספת מאזין זמני לאירועי טעינה
        client.on('loading_screen', loadingHandler);

        // בדיקה קבועה אם לא ראינו עדכוני טעינה חדשים זמן רב מספיק
        // או אם אחוז הטעינה גבוה מספיק
        const readyCheckInterval = setInterval(() => {
          this.logger.log(
            `Checking loading status: ${lastLoadingPercentage}%, last update: ${Date.now() - lastLoadingUpdate}ms ago`,
          );

          // בדיקה אם:
          // 1. לא קיבלנו עדכון טעינה במשך יותר מ-5 שניות
          // 2. אחוז הטעינה האחרון היה לפחות 95%
          if (
            Date.now() - lastLoadingUpdate > 5000 &&
            lastLoadingPercentage >= 95
          ) {
            this.logger.log(
              `No loading updates for 5+ seconds with ${lastLoadingPercentage}% progress, assuming client is ready`,
            );
            markAsReady();
          }
        }, 2000); // בדיקה כל 2 שניות

        // להוסיף טיימר מקסימלי למקרה שלעולם לא נגיע ל-100% או לא נקבל עדכוני טעינה
        setTimeout(() => {
          if (!readyMarked) {
            this.logger.warn(
              `Maximum waiting time reached for ${phoneNumber}, marking as ready anyway`,
            );
            markAsReady();
          }
        }, 30000); // 30 שניות מקסימום לאחר אירוע ready
      });

      // אירוע הטעינה הרגיל להיות רק לרישום (ללא טיפול בסטטוס)
      client.on('loading_screen', (percent, message) => {
        this.logger.log(
          `WhatsApp loading [${clientId}]: ${percent}% - ${message || 'Loading...'}`,
        );
      });

      // אירועי שגיאה אחרים
      client.on('auth_failure', (error: unknown) => {
        this.logger.error(
          `Authentication failure for ${phoneNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (!initialResponseSent) {
          initialResponseSent = true;
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

      // לוגיקת התנתקות
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
        // שימוש בנתיב מתאים למחיקת קבצי אימות
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
        if (!initialResponseSent) {
          initialResponseSent = true;
          clearTimeout(timeout);
          this.clients.delete(clientId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  /**
   * בדיקת סטטוס חיבור של לקוח
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
