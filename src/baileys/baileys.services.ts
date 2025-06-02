import { Boom } from '@hapi/boom';
import { Injectable, Logger } from '@nestjs/common';
import makeWASocket, {
  AnyMessageContent,
  Browsers,
  ConnectionState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import {
  Connection,
  MessageResult,
  MessageTypes,
  SessionInfo,
} from './baileys.types';

interface ILogger {
  level: string;
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  trace: (...args: any[]) => void;
  fatal: (...args: any[]) => void;
  child: () => ILogger;
}
@Injectable()
export class BaileysService {
  private readonly logger = new Logger(BaileysService.name);
  private connections: Map<string, Connection> = new Map();
  private readonly sessionsDir = path.join(process.cwd(), 'sessions');
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectInterval = 5000; // 5 seconds

  constructor() {
    // Ensure process.cwd() is available and properly used
    const currentDir = process.cwd();
    if (!currentDir) {
      this.logger.error('Unable to determine current working directory');
      throw new Error('Unable to determine current working directory');
    }

    this.sessionsDir = path.join(currentDir, 'sessions');
    this.logger.log(`Sessions directory set to: ${this.sessionsDir}`);

    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    // Restore previous sessions
    // void this.restoreSessions();
  }
  private async restoreSessions(): Promise<void> {
    try {
      const sessionDirs = fs.readdirSync(this.sessionsDir);

      for (const sessionId of sessionDirs) {
        const sessionInfo = path.join(
          this.sessionsDir,
          sessionId,
          'session-info.json',
        );

        if (fs.existsSync(sessionInfo)) {
          try {
            // Properly type the parsed JSON
            const info = JSON.parse(
              fs.readFileSync(sessionInfo, 'utf8'),
            ) as SessionInfo;
            if (info.phoneNumber) {
              this.logger.log(`Restoring session ${sessionId}...`);
              await this.createConnection(sessionId, info.phoneNumber);
            }
          } catch (error) {
            this.logger.error(`Failed to restore session ${sessionId}`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to restore sessions', error);
    }
  }

  async createConnection(
    sessionId: string,
    phoneNumber: string,
  ): Promise<{ status: string }> {
    if (this.connections.has(sessionId)) {
      const connection = this.connections.get(sessionId);
      return { status: connection ? connection.status : 'not_found' };
    }

    const sessionDir = path.join(this.sessionsDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });

      // Save session info for future restoration
      const sessionInfo: SessionInfo = {
        phoneNumber,
        createdAt: new Date().toISOString(),
        createdBy: 'zushar', // Current user from context
      };

      fs.writeFileSync(
        path.join(sessionDir, 'session-info.json'),
        JSON.stringify(sessionInfo),
      );
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const connection: Connection = {
      socket: null,
      pairingCode: null,
      status: 'connecting',
      reconnectAttempts: 0,
    };

    // Format the phone number to ensure it's valid
    const formattedPhoneNumber = phoneNumber.startsWith('+')
      ? phoneNumber.substring(1)
      : phoneNumber;

    connection.socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      logger: this.createBaileysLogger(sessionId),
    });

    // Request pairing code after socket is created
    if (connection.socket) {
      setTimeout(() => {
        void (async () => {
          if (connection.socket && connection.status !== 'connected') {
            try {
              const code =
                await connection.socket.requestPairingCode(
                  formattedPhoneNumber,
                );
              connection.pairingCode = code;
              connection.status = 'pairing';
              this.logger.log(`Pairing code for ${sessionId}: ${code}`);
            } catch (error) {
              this.logger.error(
                `Failed to request pairing code for ${sessionId}:`,
                error,
              );
            }
          }
        })();
      }, 3000); // Wait a bit before requesting the code
    }

    if (connection.socket) {
      // Handle connection updates
      connection.socket.ev.on(
        'connection.update',
        (update: Partial<ConnectionState>) => {
          const { connection: connectionStatus, lastDisconnect } = update;

          if (connectionStatus === 'close') {
            const error = lastDisconnect?.error;
            this.logger.error(
              `Connection closed with details: ${JSON.stringify(error)}`,
            );
            if (error) {
              this.logger.error(
                `Error code: ${(error as Boom).output?.statusCode}`,
              );
              this.logger.error(`Error message: ${error.message}`);
            }
            const statusCode = (lastDisconnect?.error as Boom)?.output
              ?.statusCode;
            // Use the DisconnectReason enum instead of hardcoded value
            const shouldReconnect =
              statusCode !== Number(DisconnectReason.loggedOut) &&
              connection.reconnectAttempts < this.maxReconnectAttempts;

            if (shouldReconnect) {
              connection.reconnectAttempts++;
              this.logger.log(
                `Connection ${sessionId} closed. Reconnect attempt ${connection.reconnectAttempts}/${this.maxReconnectAttempts}`,
              );

              setTimeout(() => {
                this.createConnection(sessionId, phoneNumber).catch((error) =>
                  this.logger.error(`Failed to reconnect ${sessionId}:`, error),
                );
              }, this.reconnectInterval);
            } else {
              connection.status = 'disconnected';
              this.connections.delete(sessionId);
              this.logger.warn(
                `Connection ${sessionId} permanently closed. ${
                  statusCode === Number(DisconnectReason.loggedOut)
                    ? 'Logged out from device'
                    : 'Max reconnect attempts reached'
                }`,
              );
            }
          } else if (connectionStatus === 'open') {
            connection.status = 'connected';
            connection.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
            this.logger.log(`Connection ${sessionId} is now connected`);
          }
        },
      );

      // Handle credentials update
      connection.socket.ev.on('creds.update', () => {
        saveCreds().catch((error) =>
          this.logger.error(
            `Failed to save credentials for ${sessionId}:`,
            error,
          ),
        );
      });

      // Handle incoming messages
      connection.socket.ev.on('messages.upsert', ({ messages }) => {
        for (const message of messages) {
          if (!message.key.fromMe) {
            this.logger.log(
              `New message in ${sessionId} from ${message.key.remoteJid}`,
            );
            // Here you could implement webhook notifications or message queuing
          }
        }
      });
    }

    this.connections.set(sessionId, connection);
    return { status: connection.status };
  }

  // Implement a proper logger that matches the ILogger interface
  private createBaileysLogger(sessionId: string): ILogger {
    return {
      level: 'info',
      info: (...args: any[]) =>
        this.logger.log(`[${sessionId}] INFO: ${args.join(' ')}`),
      debug: (...args: any[]) =>
        this.logger.debug(`[${sessionId}] DEBUG: ${args.join(' ')}`),
      warn: (...args: any[]) =>
        this.logger.warn(`[${sessionId}] WARN: ${args.join(' ')}`),
      error: (...args: any[]) =>
        this.logger.error(`[${sessionId}] ERROR: ${args.join(' ')}`),
      trace: (...args: any[]) =>
        this.logger.verbose(`[${sessionId}] TRACE: ${args.join(' ')}`),
      fatal: (...args: any[]) =>
        this.logger.error(`[${sessionId}] FATAL: ${args.join(' ')}`),
      child: () => this.createBaileysLogger(`${sessionId}:child`),
    };
  }

  getPairingCode(sessionId: string): { pairingCode: string } {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      throw new Error('Session not found');
    }

    if (!connection.pairingCode) {
      throw new Error('Pairing code not available yet');
    }

    return { pairingCode: connection.pairingCode };
  }

  getConnectionStatus(sessionId: string): { status: string } {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      throw new Error('Session not found');
    }

    return { status: connection.status };
  }

  getActiveSessions(): { sessionId: string; status: string }[] {
    return Array.from(this.connections.entries()).map(
      ([sessionId, connection]) => ({
        sessionId,
        status: connection.status,
      }),
    );
  }

  async closeConnection(sessionId: string): Promise<{ success: boolean }> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      throw new Error('Session not found');
    }

    if (connection.socket) {
      try {
        await connection.socket.logout();
      } catch (error) {
        this.logger.error(`Error during logout for ${sessionId}:`, error);
      }
    }

    this.connections.delete(sessionId);
    return { success: true };
  }

  async sendMessage(
    sessionId: string,
    to: string,
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{ success: boolean; messageId?: string }> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      throw new Error('Session not found');
    }

    if (connection.status !== 'connected') {
      throw new Error('Connection is not ready');
    }

    if (!connection.socket) {
      throw new Error('Socket is not initialized');
    }

    // Format the number to ensure it's valid
    const formattedNumber = to.includes('@s.whatsapp.net')
      ? to
      : `${to.replace(/[^\d]/g, '')}@s.whatsapp.net`;

    let messageContent: AnyMessageContent;

    // Prepare message content based on type
    switch (type) {
      case 'text':
        messageContent = { text: content as string };
        break;
      case 'image':
        if (typeof content === 'string') {
          // If content is a URL or base64 string
          messageContent = {
            image: { url: content },
            caption:
              typeof content === 'object' && 'caption' in content
                ? (content as { caption?: string }).caption || ''
                : '',
          };
        } else {
          // If content is an object with more options
          const imageContent = content as { url?: string; caption?: string };
          messageContent = {
            image: { url: imageContent.url || '' },
            caption: imageContent.caption || '',
          };
        }
        break;
      case 'document':
        if (typeof content === 'object' && 'url' in content) {
          messageContent = {
            document: { url: (content as { url: string }).url },
            fileName:
              (content as { fileName?: string }).fileName || 'document.pdf',
            mimetype:
              (content as { mimetype?: string }).mimetype || 'application/pdf',
          };
        } else {
          messageContent = {
            document: { url: content as string },
            fileName: 'document.pdf',
            mimetype: 'application/pdf',
          };
        }
        break;
      case 'video':
        if (typeof content === 'object' && 'url' in content) {
          messageContent = {
            video: { url: (content as { url: string }).url },
            caption: (content as { caption?: string }).caption || '',
          };
        } else {
          messageContent = {
            video: { url: content as string },
            caption: '',
          };
        }
        break;
      case 'audio':
        if (typeof content === 'object' && 'url' in content) {
          messageContent = {
            audio: { url: (content as { url: string }).url },
            ptt: (content as { ptt?: boolean }).ptt || false,
          };
        } else {
          messageContent = {
            audio: { url: content as string },
            ptt: false,
          };
        }
        break;
      case 'location':
        if (
          typeof content === 'object' &&
          'degreesLatitude' in content &&
          'degreesLongitude' in content
        ) {
          const locationContent = content as {
            degreesLatitude: number;
            degreesLongitude: number;
            name?: string;
          };
          messageContent = {
            location: {
              degreesLatitude: locationContent.degreesLatitude,
              degreesLongitude: locationContent.degreesLongitude,
              name: locationContent.name || '',
            },
          };
        } else {
          throw new Error(
            'Location content must include degreesLatitude and degreesLongitude',
          );
        }
        break;
      default:
        messageContent = {
          text: typeof content === 'string' ? content : JSON.stringify(content),
        };
    }

    try {
      const sentMsg = await connection.socket.sendMessage(
        formattedNumber,
        messageContent,
      );
      return {
        success: true,
        messageId: sentMsg?.key?.id || undefined,
      };
    } catch (error) {
      const errorObj = error as Error;
      this.logger.error(
        `Failed to send message to ${to} from ${sessionId}:`,
        errorObj,
      );
      throw new Error(`Failed to send message: ${errorObj.message}`);
    }
  }

  async sendBulkMessages(
    sessionId: string,
    recipients: string[],
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{
    success: boolean;
    results: MessageResult[];
  }> {
    const results: MessageResult[] = [];

    for (const recipient of recipients) {
      try {
        await this.sendMessage(sessionId, recipient, content, type);
        results.push({ to: recipient, success: true });
      } catch (error) {
        const errorObj = error as Error;
        results.push({
          to: recipient,
          success: false,
          error: errorObj.message,
        });
      }

      // Add a small delay between messages to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return {
      success: results.some((r) => r.success),
      results,
    };
  }
}
