import { Boom } from '@hapi/boom';
import { Inject, Injectable, LoggerService, forwardRef } from '@nestjs/common';
import makeWASocket, {
  Browsers,
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

// Define interfaces
// interface SessionInfo {
//   phoneNumber: string;
//   createdAt: string;
//   createdBy: string;
// }

// interface Connection {
//   socket: ReturnType<typeof makeWASocket>;
//   pairingCode: string | null;
//   status: 'connecting' | 'pairing' | 'connected' | 'disconnected' | 'blocked';
//   reconnectAttempts: number;
// }

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
    this.logger.log(
      `Sessions directory: ${this.sessionsDir}`,
      'ConnectionService',
    );
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
        const cached = this.groupCache.get(jid) as GroupMetadata | undefined;
        if (cached) return cached;

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

      // messaging-history.set
      connection.socket.ev.on(
        'messaging-history.set',
        ({
          chats: newChats,
          contacts: newContacts,
          messages: newMessages,
          syncType,
        }) => {
          this.whatsappLogger.logConnectionEvent(sessionId, 'history-set', {
            syncType,
            chatsCount: newChats.length,
            contactsCount: newContacts.length,
            messagesCount: newMessages.length,
          });

          // Store the chats, contacts, and messages in the chat store
          if (!this.chatStore.has(sessionId)) {
            this.chatStore.set(sessionId, new Map<string, InMemoryChatData>());
          }
          const sessionChats = this.chatStore.get(sessionId)!;

          // Process and log chats
          if (newChats.length > 0) {
            this.whatsappLogger.logConnectionEvent(sessionId, 'new-chats', {
              count: newChats.length,
              chatIds: newChats.map((chat) => chat.id).slice(0, 10), // Log first 10 only
            });

            // Store each chat in database
            for (const chat of newChats) {
              void this.chatService.storeChat(sessionId, chat);

              // Also add to in-memory store
              if (!sessionChats.has(chat.id)) {
                sessionChats.set(chat.id, {
                  chatId: chat.id,
                  messages: [],
                });
              }
            }
          }

          // Process and log contacts
          if (newContacts.length > 0) {
            this.whatsappLogger.logConnectionEvent(sessionId, 'new-contacts', {
              count: newContacts.length,
              contactIds: newContacts.map((contact) => contact.id).slice(0, 10), // Log first 10 only
            });
            // Optionally store contacts if needed
          }

          // Process and log messages
          if (newMessages.length > 0) {
            this.whatsappLogger.logConnectionEvent(sessionId, 'new-messages', {
              count: newMessages.length,
              messageIds: newMessages
                .map((msg) => msg.key.id || 'unknown-id')
                .slice(0, 10), // Log first 10 only
            });

            // Store each message in database
            for (const message of newMessages) {
              void this.messageService.storeMessage(sessionId, message);

              // Also add to in-memory store if we have the chat
              const chatId = message.key.remoteJid;
              if (chatId && sessionChats.has(chatId)) {
                const chatData = sessionChats.get(chatId)!;
                chatData.messages.push(message);
              }
            }
          }
        },
      );

      // Handle chat updates
      connection.socket.ev.on('chats.update', (updates) => {
        this.whatsappLogger.logConnectionEvent(sessionId, 'chats-update', {
          count: updates.length,
        });

        for (const update of updates) {
          // Check if archive status is included in the update
          if (update.id && 'archive' in update) {
            const isArchived = Boolean(update.archive);
            this.whatsappLogger.logConnectionEvent(
              sessionId,
              'chat-archive-change',
              {
                chatId: update.id,
                isArchived,
              },
            );

            // Update the database with new archive status
            void this.chatService.updateChatArchiveStatus(
              sessionId,
              update.id,
              isArchived,
            );
          }
        }
      });

      // Handle incoming message updates
      connection.socket.ev.on('messages.upsert', ({ messages }) => {
        for (const message of messages) {
          if (!message.key.fromMe) {
            this.whatsappLogger.logMessageEvent(
              sessionId,
              'received',
              message.key.remoteJid || 'unknown',
              {
                messageId: message.key.id,
                timestamp: message.messageTimestamp,
              },
            );

            // Store in memory
            this.chatService.storeChatMessage(sessionId, message);
            // Also store in database
            void this.messageService.storeMessage(sessionId, message);
          }
        }
      });

      // Handle group updates
      connection.socket.ev.on('groups.update', (updates) => {
        this.whatsappLogger.logConnectionEvent(sessionId, 'groups-update', {
          count: updates.length,
        });

        for (const update of updates) {
          const jid = update.id;
          if (jid && this.groupCache.has(jid)) {
            const current = this.groupCache.get(jid) as GroupMetadata;
            if (current) {
              // Type-safe spread - create a new object with both properties
              this.groupCache.set(jid, {
                ...current,
                ...update,
              });

              this.whatsappLogger.logConnectionEvent(
                sessionId,
                'group-metadata-updated',
                {
                  groupId: jid,
                  updateFields: Object.keys(update).filter((k) => k !== 'id'),
                },
              );
            }
          }
        }
      });

      // Handle message deletions
      connection.socket.ev.on('messages.delete', (data) => {
        if ('all' in data) {
          // All messages in a chat were deleted
          const jid = data.jid;
          this.whatsappLogger.logMessageEvent(sessionId, 'all-deleted', jid, {
            timestamp: new Date().toISOString(),
          });

          void this.messageService.deleteAllMessagesInChat(sessionId, jid);
        } else if ('keys' in data) {
          // Specific messages were deleted
          const messageKeys = data.keys;
          this.whatsappLogger.logMessageEvent(
            sessionId,
            'some-deleted',
            messageKeys[0]?.remoteJid || 'unknown',
            { count: messageKeys.length },
          );

          for (const key of messageKeys) {
            void this.messageService.deleteMessage(
              sessionId,
              key.remoteJid || '',
              key.id || '',
              key.fromMe === null ? undefined : key.fromMe,
            );
          }
        }
      });

      // Handle message updates (reactions, edits, etc.)
      connection.socket.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          if (update.key && update.update) {
            this.whatsappLogger.logMessageEvent(
              sessionId,
              'updated',
              update.key.remoteJid || 'unknown',
              {
                messageId: update.key.id,
                updateFields: Object.keys(update.update),
              },
            );

            void this.messageService.updateMessage(
              sessionId,
              update.key.remoteJid || '',
              update.key.id || '',
              update.update,
            );
          }
        }
      });

      // Handle changes in group participants
      connection.socket.ev.on('group-participants.update', (update) => {
        const { id, participants, action } = update;
        this.whatsappLogger.logConnectionEvent(
          sessionId,
          'group-participants',
          {
            groupId: id,
            action,
            count: participants.length,
            participants: participants.slice(0, 5), // Log only first 5 for brevity
          },
        );

        // Update group metadata in cache
        if (this.groupCache.has(id)) {
          const metadata = this.groupCache.get(id) as GroupMetadata;
          if (metadata && metadata.participants) {
            if (action === 'add') {
              for (const jid of participants) {
                // Add new participants
                metadata.participants.push({
                  id: jid,
                  isAdmin: false,
                  isSuperAdmin: false,
                });
              }
            } else if (action === 'remove') {
              // Remove participants
              metadata.participants = metadata.participants.filter(
                (p) => !participants.includes(p.id),
              );
            } else if (action === 'promote' || action === 'demote') {
              // Update admin status
              for (const jid of participants) {
                const participant = metadata.participants.find(
                  (p) => p.id === jid,
                );
                if (participant) {
                  participant.isAdmin = action === 'promote';
                }
              }
            }
            this.groupCache.set(id, metadata);
          }
        }

        // Update database
        void this.chatService.updateGroupParticipants(
          sessionId,
          id,
          participants,
          action,
        );
      });

      // Handle contact updates
      connection.socket.ev.on('contacts.update', (updates) => {
        this.whatsappLogger.logConnectionEvent(sessionId, 'contacts-update', {
          count: updates.length,
        });

        for (const update of updates) {
          if (update.id) {
            this.whatsappLogger.logConnectionEvent(
              sessionId,
              'contact-updated',
              {
                contactId: update.id,
                updateFields: Object.keys(update).filter((k) => k !== 'id'),
              },
            );

            // Update contact in database
            void this.chatService.updateContact(sessionId, update);
          }
        }
      });

      // Handle new contacts
      connection.socket.ev.on('contacts.upsert', (contacts) => {
        this.whatsappLogger.logConnectionEvent(sessionId, 'contacts-upsert', {
          count: contacts.length,
        });

        for (const contact of contacts) {
          void this.chatService.storeContact(sessionId, contact);
        }
      });

      // Handle chat updates more comprehensively
      connection.socket.ev.on('chats.upsert', (newChats) => {
        this.whatsappLogger.logConnectionEvent(sessionId, 'chats-upsert', {
          count: newChats.length,
        });

        for (const chat of newChats) {
          void this.chatService.storeChat(sessionId, chat);
        }
      });

      // Handle message status updates (read, delivered)
      connection.socket.ev.on('message-receipt.update', (updates) => {
        for (const { key, receipt } of updates) {
          if (key.remoteJid) {
            // Determine receipt type based on available timestamps
            let receiptType = 'unknown';
            if ('readTimestamp' in receipt) receiptType = 'read';
            else if ('deliveredTimestamp' in receipt) receiptType = 'delivered';
            else if ('playedTimestamp' in receipt) receiptType = 'played';

            this.whatsappLogger.logMessageEvent(
              sessionId,
              'receipt-update',
              key.remoteJid,
              {
                messageId: key.id,
                receiptType,
                timestamp: new Date().toISOString(),
              },
            );

            void this.messageService.updateMessageReceipt(
              sessionId,
              key.remoteJid,
              key.id || '',
              receipt,
            );
          }
        }
      });
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
}
