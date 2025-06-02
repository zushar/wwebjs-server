// src/baileys/baileys.service.ts
import { Boom } from '@hapi/boom';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import type { WASocket } from '@whiskeysockets/baileys';
import makeWASocket, {
  AnyMessageContent,
  Browsers,
  ConnectionState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import * as fs from 'fs';
import {
  WINSTON_MODULE_NEST_PROVIDER,
  WINSTON_MODULE_PROVIDER,
} from 'nest-winston';
import * as path from 'path';
import type Pino from 'pino';
import { inspect } from 'util';
import { type Logger as WinstonLogger } from 'winston';
import WebSocket from 'ws';
@Injectable()
export class BaileysService {
  private connections = new Map<string, Connection>();
  private readonly sessionsDir: string;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectInterval = 5000;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly rawWinston: WinstonLogger,
  ) {
    const cwd = process.cwd();
    if (!cwd) {
      this.logger.error('Unable to determine working directory');
      throw new Error('Unable to determine working directory');
    }
    this.sessionsDir = path.join(cwd, 'sessions');
    this.logger.log(
      `Sessions directory: ${this.sessionsDir}`,
      'BaileysService',
    );
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
    void this.restoreSessions();
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
    user: string = 'zushar',
  ): Promise<{ status: string }> {
    const baileyLogger = this.createBaileysLogger(sessionId);
    if (this.connections.has(sessionId)) {
      this.logger.warn(
        `Session ${sessionId} already exists. Returning existing status.`,
      );
      return { status: this.connections.get(sessionId)!.status };
    }
    const formattedNumber = phoneNumber.replace(/\D/g, '');
    const sessionDir = path.join(this.sessionsDir, sessionId);
    const isNewSession = !fs.existsSync(sessionDir);

    if (isNewSession) {
      fs.mkdirSync(sessionDir, { recursive: true });
      const sessionInfo: SessionInfo = {
        phoneNumber,
        createdAt: new Date().toISOString(),
        createdBy: user,
      };
      fs.writeFileSync(
        path.join(sessionDir, 'session-info.json'),
        JSON.stringify(sessionInfo, null, 2),
      );
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          this.createBaileysLogger(sessionId),
        ),
      },
      browser: Browsers.windows('Chrome'),
      mobile: false,
      printQRInTerminal: false,
      logger: baileyLogger,
    }) as unknown as WASocket;

    const connection: Connection = {
      socket: sock,
      pairingCode: null,
      status: 'connecting',
      reconnectAttempts: 0,
    };
    this.logger.log(`isNewSession: ${isNewSession}`);
    if (isNewSession) {
      const onRegister = (update: Partial<ConnectionState>) => {
        if (update.qr) {
          // uninstall ourselves immediately
          sock.ev.off('connection.update', onRegister);

          // now do the async work, but don't return it
          void (async () => {
            try {
              const code = await sock.requestPairingCode(formattedNumber);
              connection.pairingCode = code;
              connection.status = 'pairing';
              this.logger.log(`Pairing code for ${sessionId}: ${code}`);
            } catch (raw) {
              const err = raw instanceof Error ? raw : new Error(String(raw));
              this.logger.error(
                `Failed to request pairing code for ${sessionId}:`,
                err,
              );
            }
          })();
        }
      };

      sock.ev.on('connection.update', onRegister);
    }
    const ws = sock.ws;
    ws.on('message', (data: WebSocket.Data) => {
      const buf =
        typeof data === 'string'
          ? Buffer.from(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);

      this.rawWinston
        .child({ session: sessionId, direction: 'IN' })
        .debug(buf.toString('hex'));
    });

    // 3) Monkey‐patch send so you log every outgoing frame
    const origSend = ws.send.bind(ws) as typeof ws.send;
    const patchedSend: typeof ws.send = (...args) => {
      const data = args[0];
      const buf =
        typeof data === 'string'
          ? Buffer.from(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);

      this.rawWinston
        .child({ session: sessionId, direction: 'OUT' })
        .debug(buf.toString('hex'));

      return origSend(...args);
    };
    // Cast back to the socket's send-signature
    ws.send = patchedSend;

    if (connection.socket) {
      // Handle connection updates
      connection.socket.ev.on(
        'connection.update',
        (update: Partial<ConnectionState>) => {
          const { connection: connectionStatus, lastDisconnect } = update;
          this.logger.log(
            `Connection update for ${sessionId}: ${JSON.stringify(update)}`,
          );
          if (connectionStatus === 'open') {
            connection.status = 'connected';
            connection.reconnectAttempts = 0;
            this.logger.log(`Connection ${sessionId} is now connected`);
          }
          if (connectionStatus === 'close') {
            const boomErr = lastDisconnect?.error as Boom | undefined;
            const code = boomErr?.output?.statusCode;
            this.logger.error(
              `Connection closed for ${sessionId}: statusCode=${code}`,
            );
            if (code === Number(DisconnectReason.loggedOut)) {
              this.logger.warn(`Logged out. Deleting session ${sessionId}`);
              const sessionDir = path.join(this.sessionsDir, sessionId);
              if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                this.logger.log(
                  `🗑️ Deleted corrupted session data for ${sessionId}`,
                );
                this.connections.delete(sessionId);
                return;
              }
            }
            if (code === 405) {
              this.logger.warn(
                `🚫 WhatsApp blocked connection. Cleaning session ${sessionId}`,
              );
              connection.status = 'blocked';

              // מחק credentials פגומים
              const sessionDir = path.join(this.sessionsDir, sessionId);
              if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                this.logger.log(
                  `🗑️ Deleted corrupted session data for ${sessionId}`,
                );
              }

              this.connections.delete(sessionId);
              return;
            }
            if (code === Number(DisconnectReason.restartRequired)) {
              this.logger.warn(
                `Restart required for session ${sessionId}. Recreating socket…`,
              );

              this.connections.delete(sessionId);

              void this.createConnection(sessionId, phoneNumber, user);
              return;
            }
            if (connection.reconnectAttempts < this.maxReconnectAttempts) {
              connection.reconnectAttempts++;
              this.logger.log(
                `Reconnecting ${sessionId} (${connection.reconnectAttempts}/${this.maxReconnectAttempts})…`,
              );
              setTimeout(() => {
                void this.createConnection(sessionId, phoneNumber, user);
              }, this.reconnectInterval);
            } else {
              connection.status = 'disconnected';
              this.connections.delete(sessionId);
              this.logger.warn(
                `Permanently closed ${sessionId} after ${this.maxReconnectAttempts} attempts`,
              );
            }
          }
          if (connectionStatus === 'connecting') {
            connection.status = 'connecting';
            this.logger.log(
              `Connecting ${sessionId}...dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd`,
            );
          }
        },
      );
      // Handle credentials update
      connection.socket.ev.on('creds.update', () => {
        saveCreds().catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.logger.error(
            `Failed to save credentials for ${sessionId}:`,
            error,
          );
        });
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
  private createBaileysLogger(sessionId: string): Pino.Logger {
    // 1) make a child Winston logger so every entry has { session: sessionId }
    const childW = this.rawWinston.child({ session: sessionId });

    // 2) our JSON replacer: when you hit a Buffer or Uint8Array, dump it as full hex
    const binaryReplacer = (_key: string, val: any): any => {
      if (Buffer.isBuffer(val)) {
        // "aabbcc..." full hex string
        return val.toString('hex');
      }
      if (ArrayBuffer.isView(val)) {
        // TypedArrays (Uint8Array, etc)
        return Buffer.from(val as Uint8Array).toString('hex');
      }
      return val;
    };

    // 3) stringify each argument, with fallback to inspect()
    const formatArgs = (args: unknown[]): string => {
      return args
        .map((arg) => {
          if (typeof arg === 'string') {
            return arg;
          }

          try {
            // pretty‐print JSON with 2 spaces, but hex‐dump any buffers
            return JSON.stringify(arg, binaryReplacer, 2);
          } catch {
            // circular or non‐JSONable → fallback to util.inspect
            return inspect(arg, {
              depth: null,
              maxArrayLength: null,
              // showProxy, breakLength, etc… tweak as you like
            });
          }
        })
        .join(' ');
    };

    // 4) build a minimal Pino‐shaped adapter and cast it
    const adapter = {
      level: childW.level,
      silent: false,

      trace: (...a: unknown[]) => childW.verbose?.(formatArgs(a)),
      debug: (...a: unknown[]) => childW.debug?.(formatArgs(a)),
      info: (...a: unknown[]) => childW.info?.(formatArgs(a)),
      warn: (...a: unknown[]) => childW.warn?.(formatArgs(a)),
      error: (...a: unknown[]) => childW.error?.(formatArgs(a)),
      fatal: (...a: unknown[]) => childW.error?.(formatArgs(a)),

      child: () => adapter,
    } as unknown as Pino.Logger;

    return adapter;
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
  getErrorReasonAndLocation(error: unknown): {
    reason?: string;
    location?: string;
  } {
    if (
      typeof error === 'object' &&
      error !== null &&
      'data' in error &&
      typeof (error as { data: unknown }).data === 'object' &&
      (error as { data: unknown }).data !== null
    ) {
      const data = (error as { data: { reason?: string; location?: string } })
        .data;
      return {
        reason: typeof data.reason === 'string' ? data.reason : undefined,
        location: typeof data.location === 'string' ? data.location : undefined,
      };
    }
    return {};
  }
}
