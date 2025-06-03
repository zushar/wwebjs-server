import { Boom } from '@hapi/boom';
import { Inject, Injectable, LoggerService, forwardRef } from '@nestjs/common';
import makeWASocket, {
  Browsers,
  Chat,
  ConnectionState,
  DisconnectReason,
  GroupMetadata,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import * as fs from 'fs';
import {
  WINSTON_MODULE_NEST_PROVIDER,
  WINSTON_MODULE_PROVIDER,
} from 'nest-winston';
import * as NodeCache from 'node-cache';
import * as path from 'path';
import { LoggerUtil } from 'src/utils/logget.util';
import { Logger as WinstonLogger } from 'winston';
import { WhatsAppLoggerService } from '../logging/whatsapp-logger.service';
import { ChatService } from './chat.service';
import { InMemoryChatData } from './interfaces/chat-data.interface';
import { MessageService } from './message.service';

@Injectable()
export class ConnectionService {
  private connections: Map<string, Connection> = new Map();
  private readonly sessionsDir: string;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectInterval = 5000;
  private chatStore = new Map<string, Map<string, InMemoryChatData>>();
  private groupCache = new NodeCache({
    stdTTL: 3600,
    maxKeys: 1000,
    checkperiod: 120,
    useClones: false,
  });
  private readonly sessionLogsDir: string;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly rawWinston: WinstonLogger,
    private readonly whatsappLogger: WhatsAppLoggerService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
  ) {
    const cwd = process.cwd();
    if (!cwd) {
      this.logger.error('Unable to determine working directory');
      throw new Error('Unable to determine working directory');
    }
    this.sessionsDir = path.join(cwd, 'sessions');
    this.sessionLogsDir = path.join(cwd, 'session_logs');
    this.logger.log(
      `Sessions directory: ${this.sessionsDir}`,
      'ConnectionService',
    );
    if (!fs.existsSync(this.sessionLogsDir)) {
      fs.mkdirSync(this.sessionLogsDir, { recursive: true });
    }
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  async createConnection(
    sessionId: string,
    phoneNumber: string,
    user: string = 'zushar',
  ): Promise<{ status: string }> {
    // Use the enhanced logger for Baileys
    const baileyLogger = LoggerUtil.createBaileysLogger(
      sessionId,
      this.rawWinston,
    );

    if (this.connections.has(sessionId)) {
      this.whatsappLogger.logConnectionEvent(sessionId, 'already-exists', {
        status: this.connections.get(sessionId)!.status,
      });
      return { status: this.connections.get(sessionId)!.status };
    }

    const formattedNumber = phoneNumber.replace(/\D/g, '');
    const sessionDir = path.join(this.sessionsDir, sessionId);
    const isNewSession = !fs.existsSync(sessionDir);

    // Log session creation details
    this.whatsappLogger.logConnectionEvent(sessionId, 'creating', {
      isNewSession,
      phoneNumber: formattedNumber,
      user,
    });

    // Initialize chat store for this session
    if (!this.chatStore.has(sessionId)) {
      this.chatStore.set(sessionId, new Map<string, InMemoryChatData>());
    }

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

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileyLogger),
      },
      browser: Browsers.ubuntu('Chrome'),
      mobile: false,
      printQRInTerminal: false, // Server environment doesn't need terminal QR
      connectTimeoutMs: 60000, // 60 second connection timeout
      defaultQueryTimeoutMs: 30000, // 30 second query timeout
      logger: baileyLogger,
      markOnlineOnConnect: true, // Show as online when connected
      syncFullHistory: false, // Limits initial history download
      getMessage: async (key) => {
        if (!key.remoteJid || !key.id) {
          return undefined;
        }

        try {
          // Get the message from the database
          const message = await this.messageService.getMessageByKey(
            sessionId,
            key.remoteJid,
            key.id,
            key.fromMe === null ? undefined : key.fromMe,
          );

          return message || undefined;
        } catch (error) {
          this.whatsappLogger.logError(
            sessionId,
            error,
            `getMessage for ${key.remoteJid}/${key.id}`,
          );
          return undefined;
        }
      },
      cachedGroupMetadata: async (jid): Promise<GroupMetadata | undefined> => {
        // Try to get from cache first
        const cached = this.groupCache.get(jid);
        if (
          cached &&
          typeof cached === 'object' &&
          cached !== null &&
          'id' in cached &&
          'subject' in cached &&
          'participants' in cached
        ) {
          return cached as GroupMetadata;
        }

        // If not in cache, fetch it and store for future use
        try {
          const metadata = await sock.groupMetadata(jid);
          this.groupCache.set(jid, metadata);
          return metadata;
        } catch (error) {
          this.whatsappLogger.logError(
            sessionId,
            error,
            `fetchGroupMetadata for ${jid}`,
          );
          return undefined;
        }
      },
      // Resource optimization
      msgRetryCounterCache: new NodeCache({
        stdTTL: 60 * 10, // 10 minutes
        maxKeys: 1000,
      }),
      shouldIgnoreJid: (jid) => jid.startsWith('status@broadcast'), // Ignore status messages
      emitOwnEvents: true, // Important for tracking sent messages
      // Request rate limiting to avoid bans
      retryRequestDelayMs: 3000, // 3 second base delay between retries
      // Initialization optimization
      fireInitQueries: true, // Get group data immediately on connect
    });

    const connection: Connection = {
      socket: sock,
      pairingCode: null,
      status: 'connecting',
      reconnectAttempts: 0,
    };

    this.whatsappLogger.logConnectionEvent(sessionId, 'init', { isNewSession });

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
              this.whatsappLogger.logConnectionEvent(
                sessionId,
                'pairing-code-generated',
                { code },
              );
            } catch (error) {
              this.whatsappLogger.logError(
                sessionId,
                error,
                'requestPairingCode',
              );
            }
          })();
        }
      };

      sock.ev.on('connection.update', onRegister);
    }

    if (connection.socket) {
      // Handle connection updates
      connection.socket.ev.on(
        'connection.update',
        (update: Partial<ConnectionState>) => {
          const { connection: connectionStatus, lastDisconnect, qr } = update;

          this.whatsappLogger.logConnectionEvent(sessionId, 'update', {
            connectionStatus,
            hasQr: !!qr,
            hasDisconnect: !!lastDisconnect,
          });

          if (connectionStatus === 'open') {
            connection.status = 'connected';
            connection.reconnectAttempts = 0;
            this.whatsappLogger.logConnectionEvent(sessionId, 'connected', {
              timestamp: new Date().toISOString(),
            });
          }

          if (connectionStatus === 'close') {
            const boomErr = lastDisconnect?.error as Boom | undefined;
            const code = boomErr?.output?.statusCode;

            this.whatsappLogger.logError(
              sessionId,
              boomErr || 'Connection closed',
              `connection-closed code=${code}`,
            );

            if (code === Number(DisconnectReason.loggedOut)) {
              this.whatsappLogger.logConnectionEvent(sessionId, 'logged-out', {
                code,
              });

              const sessionDir = path.join(this.sessionsDir, sessionId);
              if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                this.whatsappLogger.logConnectionEvent(
                  sessionId,
                  'session-deleted',
                  { reason: 'logged-out' },
                );
                this.connections.delete(sessionId);
                return;
              }
            }

            if (code === 405) {
              this.whatsappLogger.logConnectionEvent(sessionId, 'blocked', {
                code,
              });

              connection.status = 'blocked';

              const sessionDir = path.join(this.sessionsDir, sessionId);
              if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                this.whatsappLogger.logConnectionEvent(
                  sessionId,
                  'session-deleted',
                  { reason: 'blocked' },
                );
              }

              this.connections.delete(sessionId);
              return;
            }

            if (code === Number(DisconnectReason.restartRequired)) {
              this.whatsappLogger.logConnectionEvent(
                sessionId,
                'restart-required',
                { code },
              );

              this.connections.delete(sessionId);

              void this.createConnection(sessionId, phoneNumber, user);
              return;
            }

            if (connection.reconnectAttempts < this.maxReconnectAttempts) {
              connection.reconnectAttempts++;
              this.whatsappLogger.logConnectionEvent(
                sessionId,
                'reconnecting',
                {
                  attempt: connection.reconnectAttempts,
                  maxAttempts: this.maxReconnectAttempts,
                  interval: this.reconnectInterval,
                },
              );

              setTimeout(() => {
                void this.createConnection(sessionId, phoneNumber, user);
              }, this.reconnectInterval);
            } else {
              connection.status = 'disconnected';
              this.connections.delete(sessionId);
              this.whatsappLogger.logConnectionEvent(
                sessionId,
                'max-reconnect-attempts',
                {
                  attempts: this.maxReconnectAttempts,
                  status: 'disconnected',
                },
              );
            }
          }

          if (connectionStatus === 'connecting') {
            connection.status = 'connecting';
            this.whatsappLogger.logConnectionEvent(sessionId, 'connecting', {
              timestamp: new Date().toISOString(),
            });
          }
        },
      );

      // creds.update
      connection.socket.ev.on('creds.update', () => {
        saveCreds().catch((error: unknown) => {
          this.whatsappLogger.logError(sessionId, error, 'saveCreds');
        });
      });

      // Handle messaging-history.set
      connection.socket.ev.on(
        'messaging-history.set',
        this.wrapAsyncHandler(async ({ chats: newChats }) => {
          // Process new chats - filter for groups only
          if (Array.isArray(newChats)) {
            const groupChats = newChats.filter((chat) =>
              chat.id.endsWith('@g.us'),
            );

            for (const chat of groupChats) {
              try {
                await this.chatService.storeEnhancedChat(sessionId, chat);
              } catch (error) {
                this.logger.error(
                  `Failed to store group chat ${chat.id}:`,
                  error,
                );
              }
            }
          }
        }),
      );

      // Handle chat upserts - filter for groups only
      connection.socket.ev.on(
        'chats.upsert',
        this.wrapAsyncHandler(async (newChats) => {
          if (Array.isArray(newChats)) {
            const groupChats = newChats.filter((chat) =>
              chat.id.endsWith('@g.us'),
            );

            for (const chat of groupChats) {
              await this.chatService.storeEnhancedChat(sessionId, chat);
            }
          }
        }),
      );

      // Handle chat updates - filter for groups only
      connection.socket.ev.on(
        'chats.update',
        this.wrapAsyncHandler(async (updates: Partial<Chat>[]) => {
          for (const update of updates) {
            if (update.id && update.id.endsWith('@g.us')) {
              // Get the existing chat first
              const existingChat = await this.chatService.getChatByJid(
                sessionId,
                update.id,
              );
              if (existingChat) {
                // Merge the update with existing data
                const updatedChat = { ...existingChat, ...update } as Chat;
                await this.chatService.storeEnhancedChat(
                  sessionId,
                  updatedChat,
                );
              }

              // Handle archive status specially (for backward compatibility)
              if ('archived' in update) {
                const isArchived = Boolean(update.archived);
                await this.chatService.updateArchiveStatus(
                  sessionId,
                  update.id,
                  isArchived,
                );
              }
            }
          }
        }),
      );

      // Handle incoming message updates
      // connection.socket.ev.on('messages.upsert', ({ messages, type }) => {
      //   if (type === 'notify') {
      //     // These are new messages that should be stored
      //     for (const message of messages) {
      //       try {
      //         // Check for valid message data
      //         if (message.key?.id && message.key.remoteJid) {
      //           // Log incoming message (optional)
      //           this.logger.debug?.(
      //             `Received message from ${message.key.fromMe ? 'self' : 'others'}: ${message.key.id}`,
      //             { sessionId, chatJid: message.key.remoteJid },
      //           );

      //           // Store in database
      //           void this.messageService.storeMessage(sessionId, message);
      //         }
      //       } catch (error) {
      //         const err =
      //           error instanceof Error ? error : new Error(String(error));
      //         this.logger.error(
      //           `Failed to process incoming message ${message.key?.id || 'unknown'}:`,
      //           err,
      //         );
      //       }
      //     }
      //   }
      // });

      // Handle message deletions
      // connection.socket.ev.on('messages.delete', (data) => {
      //   try {
      //     if ('all' in data && data.jid) {
      //       // All messages in a chat were deleted
      //       this.logger.log(
      //         `All messages deleted in chat ${data.jid}`,
      //         'MessageService',
      //       );
      //       void this.messageService.deleteAllMessagesInChat(
      //         sessionId,
      //         data.jid,
      //       );
      //     } else if (
      //       'keys' in data &&
      //       Array.isArray(data.keys) &&
      //       data.keys.length > 0
      //     ) {
      //       // Specific messages were deleted
      //       this.logger.log(
      //         `Specific messages deleted ${data.keys[0]?.remoteJid ? `in chat ${data.keys[0].remoteJid}` : '(unknown chat)'}`,
      //         'MessageService',
      //       );

      //       for (const key of data.keys) {
      //         if (key.remoteJid && key.id) {
      //           void this.messageService.deleteMessage(
      //             sessionId,
      //             key.remoteJid,
      //             key.id,
      //             key.fromMe === null ? undefined : key.fromMe,
      //           );
      //         }
      //       }
      //     }
      //   } catch (error) {
      //     const err = error instanceof Error ? error : new Error(String(error));
      //     this.logger.error('Failed to process message deletion event:', err);
      //   }
      // });

      // Handle message updates (reactions, edits, etc.)
      // connection.socket.ev.on('messages.update', (updates) => {
      //   for (const update of updates) {
      //     try {
      //       if (
      //         update.key &&
      //         update.key.remoteJid &&
      //         update.key.id &&
      //         update.update
      //       ) {
      //         this.logger.debug?.(
      //           `Message update for ${update.key.id}: ${Object.keys(update.update).join(', ')}`,
      //           { sessionId, chatJid: update.key.remoteJid },
      //         );

      //         void this.messageService.updateMessage(
      //           sessionId,
      //           update.key.remoteJid,
      //           update.key.id,
      //           update,
      //         );
      //       }
      //     } catch (error) {
      //       const err =
      //         error instanceof Error ? error : new Error(String(error));
      //       this.logger.error(
      //         `Failed to process message update for ${update.key?.id || 'unknown'}:`,
      //         err,
      //       );
      //     }
      //   }
      // });
    }

    this.connections.set(sessionId, connection);
    return { status: connection.status };
  }

  getConnection(sessionId: string): Connection | undefined {
    return this.connections.get(sessionId);
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
        this.whatsappLogger.logConnectionEvent(sessionId, 'logout', {
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.whatsappLogger.logError(sessionId, error, 'logout');
      }
    }

    this.connections.delete(sessionId);
    return { success: true };
  }

  async restoreSessions(): Promise<void> {
    try {
      this.logger.log('Restoring sessions from disk...', 'ConnectionService');
      const sessionDirs = fs.readdirSync(this.sessionsDir);

      for (const sessionId of sessionDirs) {
        const sessionInfo = path.join(
          this.sessionsDir,
          sessionId,
          'session-info.json',
        );

        if (fs.existsSync(sessionInfo)) {
          try {
            const info = JSON.parse(
              fs.readFileSync(sessionInfo, 'utf8'),
            ) as SessionInfo;
            if (info.phoneNumber) {
              this.whatsappLogger.logConnectionEvent(sessionId, 'restoring', {
                phoneNumber: info.phoneNumber,
                createdAt: info.createdAt,
              });

              await this.createConnection(sessionId, info.phoneNumber);
            }
          } catch (error) {
            this.whatsappLogger.logError(sessionId, error, 'restore-session');
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to restore sessions: ${error instanceof Error ? error.message : String(error)}`,
        'ConnectionService',
      );
    }
  }
  private async appendToSessionLog(
    sessionId: string,
    logContent: string,
  ): Promise<void> {
    const logFilePath = path.join(
      this.sessionLogsDir,
      `${sessionId}_history_sync.txt`,
    );
    try {
      await fs.promises.appendFile(
        logFilePath,
        `\n${new Date().toISOString()}\n${logContent}\n`,
      );
    } catch (error) {
      this.whatsappLogger.logError(
        sessionId,
        error,
        `Failed to write to session history log file: ${logFilePath}`,
      );
    }
  }
  private wrapAsyncHandler<T>(
    handler: (data: T) => Promise<void>,
  ): (data: T) => void {
    return (data: T) => {
      void handler(data).catch((error: unknown) => {
        this.logger.error(
          `Error in async event handler: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    };
  }
}
