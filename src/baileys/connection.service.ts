import { Boom } from '@hapi/boom';
import { forwardRef, Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import makeWASocket, {
  Browsers,
  ConnectionState,
  DisconnectReason,
  GroupMetadata,
  makeCacheableSignalKeyStore,
  proto,
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
import { Repository } from 'typeorm';
import { Logger as WinstonLogger } from 'winston';
import { WhatsAppLoggerService } from '../logging/whatsapp-logger.service';
import { GroupEntity } from './entityes/group.entity';
import { GroupService } from './group.service';
import { WChat } from './interfaces/chat-data.interface';
import { MessageService } from './message.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Long = require('long');
@Injectable()
export class ConnectionService {
  private connections: Map<string, Connection> = new Map();
  private readonly sessionsDir: string;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectInterval = 5000;
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
    public readonly whatsappLogger: WhatsAppLoggerService,
    @Inject(forwardRef(() => GroupService))
    public readonly groupService: GroupService,
    @Inject(forwardRef(() => MessageService))
    public readonly messageService: MessageService,
    @InjectRepository(GroupEntity)
    private groupRepository: Repository<GroupEntity>,
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
    const sessionInfo: SessionInfo = {
      phoneNumber,
      createdAt: new Date().toISOString(),
      createdBy: user,
      didBootstrap: false,
    };
    if (isNewSession) {
      fs.mkdirSync(sessionDir, { recursive: true });
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
      browser: Browsers.windows('chrome'),
      mobile: false,
      printQRInTerminal: false, // Server environment doesn't need terminal QR
      connectTimeoutMs: 60000, // 60 second connection timeout
      defaultQueryTimeoutMs: 30000, // 30 second query timeout
      logger: baileyLogger,
      markOnlineOnConnect: true, // Show as online when connected
      syncFullHistory: false, // Limits initial history download
      keepAliveIntervalMs: 30000, // 30 seconds keep-alive
      // getMessage: async (key) => {
      //   if (!key.remoteJid || !key.id) {
      //     return undefined;
      //   }

      //   try {
      //     // Get the message from the database
      //     const message = await this.messageService.getMessageByKey(
      //       sessionId,
      //       key.remoteJid,
      //       key.id,
      //       key.fromMe === null ? undefined : key.fromMe,
      //     );

      //     return message || undefined;
      //   } catch (error) {
      //     this.whatsappLogger.logError(
      //       sessionId,
      //       error,
      //       `getMessage for ${key.remoteJid}/${key.id}`,
      //     );
      //     return undefined;
      //   }
      // },
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
    let didBootstrap = false;
    const infoPath = path.join(sessionDir, 'session-info.json');
    if (fs.existsSync(infoPath)) {
      const raw = fs.readFileSync(infoPath, 'utf-8');
      const sessionData = JSON.parse(raw) as SessionInfo;
      didBootstrap = sessionData.didBootstrap ?? false;
    }
    const connection: Connection = {
      socket: sock,
      pairingCode: null,
      status: 'connecting',
      reconnectAttempts: 0,
      didBootstrap,
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
        this.wrapAsyncHandler(async (update: Partial<ConnectionState>) => {
          const { connection: connectionStatus, lastDisconnect, qr } = update;
          console.dir(update, { depth: null, colors: true });
          this.whatsappLogger.logConnectionEvent(sessionId, 'update', {
            connectionStatus,
            hasQr: !!qr,
            hasDisconnect: !!lastDisconnect,
          });
          if (connectionStatus === 'open' && !connection.didBootstrap) {
            connection.didBootstrap = true;
            sessionInfo.didBootstrap = true;
            fs.writeFileSync(infoPath, JSON.stringify(sessionInfo, null, 2));
            connection.status = 'updating';
            connection.reconnectAttempts = 0;
            this.whatsappLogger.logConnectionEvent(sessionId, 'connected', {
              timestamp: new Date().toISOString(),
            });
            const allGroups =
              await connection.socket.groupFetchAllParticipating();
            const rows: Partial<GroupEntity>[] = [];
            for (const [jid, meta] of Object.entries(allGroups)) {
              rows.push({
                sessionId,
                chatid: jid,
                chatName: meta.subject,
                groupSize: meta.size,
                archived: false, // Default to false, adjust as needed
                participants: meta.participants,
              });
              this.groupCache.set(jid, meta);
            }
            if (rows.length) {
              try {
                await this.groupRepository.upsert(rows, [
                  'sessionId',
                  'chatid',
                ]);
                this.whatsappLogger.logConnectionEvent(
                  sessionId,
                  'groups-fetched',
                  { count: rows.length },
                );
              } catch (error) {
                this.whatsappLogger.logError(
                  sessionId,
                  error,
                  'upsertGroupsOnConnect',
                );
              }
            }
            connection.status = 'connected';
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
              connection.status = 'logged-out';
              connection.socket.end(undefined);
              this.whatsappLogger.logConnectionEvent(sessionId, 'logged-out', {
                code,
              });
              this.closeConnection(sessionId).catch((error) => {
                this.whatsappLogger.logError(
                  sessionId,
                  error,
                  'closeConnectionOnLogout',
                );
              });
              return;
            }

            if (code === 405) {
              // Remove all listeners by properly closing the connection
              connection.socket.end(undefined);
              this.whatsappLogger.logConnectionEvent(sessionId, 'blocked', {
                code,
              });
              connection.status = 'blocked';
              this.closeConnection(sessionId).catch((error) => {
                this.whatsappLogger.logError(
                  sessionId,
                  error,
                  'closeConnectionOnBlocked',
                );
              });
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
              this.closeConnection(sessionId).catch((error) => {
                this.whatsappLogger.logError(
                  sessionId,
                  error,
                  'closeConnectionOnMaxReconnectAttempts',
                );
              });
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
        }),
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
        this.wrapAsyncHandler(
          async ({
            chats: newChats,
            messages: newMessages,
            syncType: syncType,
            progress: progress,
            isLatest: isLatest,
          }) => {
            console.log(
              `messaging-history.set event received syncType: ${syncType} progress: ${progress} isLatest: ${isLatest}`,
            );
            if (Array.isArray(newChats)) {
              const groupChats = newChats.filter((chat) =>
                chat.id.endsWith('@g.us'),
              );
              const chatsToUpsert = groupChats.map((chat) => {
                const lastMessage =
                  chat.messages?.[chat.messages.length - 1]?.message;
                return {
                  sessionId,
                  chatid: chat.id,
                  chatName: chat.name,
                  archived: chat.archived,
                  messageParticipant: lastMessage?.participant,
                  messageId: lastMessage?.key?.id,
                  fromMe: lastMessage?.key?.fromMe,
                  messageTimestamp: lastMessage?.messageTimestamp,
                  messageText: lastMessage?.message?.conversation || null,
                  asNewMessage: true,
                };
              });
              if (chatsToUpsert.length > 0) {
                try {
                  await this.groupRepository.upsert(chatsToUpsert, [
                    'sessionId',
                    'chatid',
                  ]);
                } catch (error) {
                  this.logger.error(
                    'Failed to batch upsert group chats:',
                    error,
                  );
                }
              }
            }
            // Filter out non-group messages
            if (Array.isArray(newMessages)) {
              // Fix: Add return statement to filter
              const groupMessages = newMessages.filter((message) => {
                return message.key.remoteJid?.endsWith('@g.us');
              });
              const messagesToUpdate: WChat[] = [];
              for (const message of groupMessages) {
                try {
                  if (message.key.remoteJid) {
                    const cachedChat = await this.groupRepository.findOne({
                      where: { sessionId, chatid: message.key.remoteJid },
                    });
                    if (
                      cachedChat &&
                      cachedChat.messageTimestamp &&
                      message.messageTimestamp
                    ) {
                      if (
                        this.toNumberTimestamp(message.messageTimestamp) >=
                          this.toNumberTimestamp(cachedChat.messageTimestamp) &&
                        cachedChat.messageTimestamp &&
                        message.messageTimestamp
                      ) {
                        messagesToUpdate.push({
                          ...cachedChat,
                          messageId: message.key.id,
                          fromMe: message.key.fromMe,
                          messageParticipant: message.participant,
                          messageTimestamp: message.messageTimestamp,
                          messageText: message.message?.conversation || null,
                          asNewMessage: true,
                        });
                        console.log(
                          `Queued update for cached chat ${message.key.remoteJid} with new message`,
                        );
                      }
                    }
                  }
                } catch (error) {
                  // a) print it raw
                  console.error(
                    `🛑 Failed to process group message ${message.key.id}:`,
                    error,
                  );
                  // b) send to Nest/Winston with real stack
                  this.logError(
                    `Failed to process group message ${message.key.id}`,
                    error,
                  );
                }
              }

              // Batch update all messages
              if (messagesToUpdate.length > 0) {
                try {
                  await this.groupRepository.upsert(messagesToUpdate, [
                    'sessionId',
                    'chatid',
                  ]);
                  console.log(
                    `Batch updated ${messagesToUpdate.length} group messages`,
                  );
                } catch (error) {
                  this.logger.error(
                    'Failed to batch update group messages:',
                    error,
                  );
                }
              }
            }
          },
        ),
      );

      // Handle chat upserts - filter for groups only
      connection.socket.ev.on(
        'chats.upsert',
        this.wrapAsyncHandler(async (newChats) => {
          console.log(
            `chats.upsert event received with ${newChats.length} chats`,
          );
          const rows = newChats
            .filter((c) => this.isGroupJid(c.id))
            .map((c) => {
              console.log(
                `Preparing upsert for group ${c.name} with chatid: ${c.id}`,
              );
              console.dir(c, { depth: null, colors: true });
              return {
                sessionId,
                chatid: c.id,
                chatName: c.name,
                archived: c.archived,
              } as Partial<GroupEntity>;
            });
          if (rows.length) {
            await this.groupRepository.upsert(rows, ['sessionId', 'chatid']);
          }
        }),
      );

      // Handle chat updates - filter for groups only
      connection.socket.ev.on(
        'chats.update',
        this.wrapAsyncHandler(async (updates: proto.IConversation[]) => {
          console.log(
            `chats.update event received with ${updates.length} updates`,
          );
          for (const u of updates) {
            if (!this.isGroupJid(u.id)) continue;

            // Build the upsert row with only real changes
            const row: Partial<GroupEntity> = {
              sessionId,
              chatid: u.id,
            };

            // Archive/unarchive
            if (typeof u.archived === 'boolean') {
              row.archived = u.archived;
              console.log(
                `Updating archive status for group ${u.id} to ${u.archived}`,
              );
            }

            // Name change
            if (typeof u.name === 'string') {
              row.chatName = u.name;
            }

            // Last­-message metadata (if present)
            const last = u.messages?.at(-1)?.message;
            if (last?.key) {
              row.messageId = last.key.id;
              row.fromMe = last.key.fromMe;
              row.messageParticipant = last.key.participant;
              row.messageTimestamp = last.messageTimestamp;
            }

            // Prune out any undefined fields to avoid accidental overwrites
            const sanitized = Object.fromEntries(
              Object.entries(row).filter(([, v]) => v !== undefined),
            ) as Partial<GroupEntity>;

            // Only upsert if there’s something beyond sessionId/chatid
            if (Object.keys(sanitized).length > 2) {
              console.log(`Upserting ${u.id} with`, sanitized);
              await this.groupRepository.upsert(sanitized, [
                'sessionId',
                'chatid',
              ]);
            }
          }
        }),
      );

      // Handle incoming message updates
      connection.socket.ev.on(
        'messages.upsert',
        this.wrapAsyncHandler(async ({ messages, type, requestId }) => {
          console.log(
            `messages.upsert event received type: ${type} requestId: ${requestId}`,
          );
          for (const message of messages) {
            if (!message.key.remoteJid?.endsWith('@g.us')) continue;
            await this.groupRepository.upsert(
              [
                {
                  sessionId,
                  chatid: message.key.remoteJid,
                  messageId: message.key.id,
                  messageTimestamp: message.messageTimestamp,
                  messageText: message.message?.conversation || null,
                  fromMe: message.key.fromMe,
                  messageParticipant: message.participant,
                  asNewMessage: true,
                },
              ],
              ['sessionId', 'chatid'],
            );
          }
        }),
      );
      // connection.socket.ev.on(
      //   'messages.update',
      //   this.wrapAsyncHandler(async (newMessages) => {
      //     console.log(
      //       `messages.update event received with ${newMessages.length} updates`,
      //     );
      //     if (Array.isArray(newMessages)) {
      //       // Fix: Add return statement to filter
      //       const groupMessages = newMessages.filter((message) => {
      //         return message.key.remoteJid?.endsWith('@g.us');
      //       });
      //       for (const message of groupMessages) {
      //         if (
      //           message.key.id &&
      //           (await this.groupRepository.findOne({
      //             where: { sessionId, messageId: message.key.id },
      //           }))
      //         ) {
      //           this.groupRepository
      //             .update(
      //               { sessionId, messageId: message.key.id },
      //               {
      //                 messageParticipant: message.key.participant,
      //                 asNewMessage: true,
      //               },
      //             )
      //             .catch((error) => {
      //               this.logger.error(
      //                 `Failed to update group message ${message.key.id}:`,
      //                 error,
      //               );
      //             });
      //         }
      //       }
      //     }
      //   }),
      // );

      connection.socket.ev.on(
        'groups.upsert',
        this.wrapAsyncHandler(async (groups: GroupMetadata[]) => {
          console.log(
            `groups.upsert event received with ${groups.length} groups`,
          );
          if (!Array.isArray(groups) || groups.length === 0) return;

          // Prepare upsert rows for all groups
          const rows = groups.map((g) => ({
            sessionId,
            chatid: g.id,
            chatName: g.subject,
            groupSize: g.size,
            participants: g.participants,
          }));

          try {
            await this.groupRepository.upsert(rows, ['sessionId', 'chatid']);
            console.log(`groups.upsert: upserted ${rows.length} group metas`);
          } catch (err) {
            this.logger.error('groups.upsert failed', err);
          }
        }),
      );
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
    if (!connection) throw new Error('Session not found');

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

    // -- delete the session directory on disk --
    const sessionDir = path.join(this.sessionsDir, sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        this.emptyDir(sessionDir);
        fs.rmdirSync(sessionDir);
        this.whatsappLogger.logConnectionEvent(sessionId, 'session-deleted', {
          reason: 'manual-logout',
        });
      } catch (err) {
        this.whatsappLogger.logError(sessionId, err, 'delete-session-dir');
      }
    }
    await this.groupRepository.delete({ sessionId }).catch((error) => {
      this.whatsappLogger.logError(sessionId, error, 'deleteGroupDataOnLogout');
    });
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
  private toNumberTimestamp(a: number | Long | undefined) {
    if (a === undefined) {
      console.warn('toNumberTimestamp received undefined');
      return 0; // Default to 0 for undefined timestamps
    }
    if (Long && typeof Long.isLong === 'function' && Long.isLong(a)) {
      return a.toNumber();
    }
    return a;
  }
  private logError(context: string, err: unknown) {
    if (err instanceof Error) {
      // Nest LoggerService.error signature: error(msg: string, trace?: string, ctx?: string)
      this.logger.error(
        `${context}: ${err.message}`,
        err.stack,
        'ConnectionService',
      );
    } else {
      // non-Error thrown – serialize it
      let dump: string;
      if (typeof err === 'object' && err !== null) {
        try {
          dump = JSON.stringify(err, null, 2);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_jsonError) {
          // Handle circular references or other JSON serialization errors
          dump = `[Unserializable object: ${Object.prototype.toString.call(err)}]`;
          // Try to extract some properties if possible
          try {
            dump += ` Properties: ${JSON.stringify(Object.keys(err))}`;
          } catch {
            // If we can't even get the keys, just give up
          }
        }
      } else {
        dump = String(err);
      }
      this.logger.error(`${context}: ${dump}`, undefined, 'ConnectionService');
    }
  }
  private emptyDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      // recursive + force will delete files or directories
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
  private isGroupJid(jid?: string): boolean {
    return !!jid && jid.endsWith('@g.us');
  }
}
