import { forwardRef, Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AnyMessageContent,
  proto,
  WAMessageUpdate,
} from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { ConnectionService } from './connection.service';
import { MessageEntity } from './entityes/message.entity';

// Define message types for better type safety
export type MessageTypes =
  | 'text'
  | 'image'
  | 'document'
  | 'video'
  | 'audio'
  | 'location';

// Interface for message results
export interface MessageResult {
  to: string;
  success: boolean;
  error?: string;
}

// Custom interfaces for our message updates - extending the Baileys types
interface MessageReaction {
  key?: {
    participant?: string;
    remoteJid?: string;
  };
  text?: string;
}

interface ExtendedMessageUpdate {
  reactions?: MessageReaction[];
  edit?: {
    text?: string;
  };
  delete?: boolean;
  status?: string;
}

// Custom interfaces for receipts
interface ExtendedMessageReceipt {
  readTimestamp?: number;
  deliveredTimestamp?: number;
  playedTimestamp?: number;
  type?: string;
  [key: string]: unknown;
}

@Injectable()
export class MessageService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(MessageEntity)
    private messageRepository: Repository<MessageEntity>,
    @Inject(forwardRef(() => ConnectionService))
    private connectionService: ConnectionService,
  ) {}

  async sendMessage(
    sessionId: string,
    to: string,
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{ success: boolean; messageId?: string }> {
    const connection = this.connectionService.getConnection(sessionId);
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

  async storeMessage(
    sessionId: string,
    message: proto.IWebMessageInfo,
  ): Promise<void> {
    if (!message.key?.id) return;

    const chatId = message.key.remoteJid;
    if (!chatId) return;

    try {
      // Create a new message entity
      const messageEntity = new MessageEntity();
      messageEntity.sessionId = sessionId;
      messageEntity.chatId = chatId;
      messageEntity.id = message.key.id;

      // Use the helper method to populate all fields
      messageEntity.updateFromBaileysMessage(message);

      // Save to database
      await this.messageRepository.save(messageEntity);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to store message ${message.key.id}:`, err);
    }
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

  async getMessageByKey(
    sessionId: string,
    remoteJid: string,
    id: string,
    fromMe?: boolean,
  ): Promise<proto.IMessage | undefined> {
    try {
      // Find the message in the database
      const messageEntity = await this.messageRepository.findOne({
        where: {
          sessionId,
          chatId: remoteJid,
          id,
          ...(fromMe !== undefined ? { fromMe } : {}),
        },
      });

      if (!messageEntity || !messageEntity.rawData) {
        return undefined;
      }

      // Type check and access the message property safely
      const rawData = messageEntity.rawData as { message?: proto.IMessage };
      return rawData?.message;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to retrieve message (${id}) from database:`,
        err,
      );
      return undefined;
    }
  }

  async deleteAllMessagesInChat(
    sessionId: string,
    chatId: string,
  ): Promise<void> {
    try {
      await this.messageRepository.delete({
        sessionId,
        chatId,
      });
      this.logger.log(
        `Deleted all messages for chat ${chatId} in session ${sessionId}`,
        'MessageService',
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to delete messages for chat ${chatId} in session ${sessionId}:`,
        err,
      );
    }
  }

  /**
   * Deletes a specific message from the database
   */
  async deleteMessage(
    sessionId: string,
    chatId: string,
    messageId: string,
    fromMe?: boolean,
  ): Promise<void> {
    try {
      const conditions: Record<string, unknown> = {
        sessionId,
        chatId,
        id: messageId,
      };

      if (fromMe !== undefined) {
        conditions.fromMe = fromMe;
      }

      await this.messageRepository.delete(conditions);
      this.logger.log(
        `Deleted message ${messageId} from chat ${chatId} in session ${sessionId}`,
        'MessageService',
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to delete message ${messageId} from chat ${chatId}:`,
        err,
      );
    }
  }

  /**
   * Updates a message in the database with new content or metadata
   */
  async updateMessage(
    sessionId: string,
    chatId: string,
    messageId: string,
    update: WAMessageUpdate & ExtendedMessageUpdate,
  ): Promise<void> {
    try {
      const message = await this.messageRepository.findOne({
        where: {
          sessionId,
          chatId,
          id: messageId,
        },
      });

      if (!message) {
        this.logger.warn(
          `Message ${messageId} not found for update in chat ${chatId}`,
          'MessageService',
        );
        return;
      }

      if (update.edit) {
        // Handle edited message by storing both versions
        const originalText = message.text;
        message.text = update.edit.text || message.text;

        // Store edit history if we have raw data
        if (message.rawData) {
          const typedRawData = message.rawData as Record<string, unknown>;

          // Initialize edit history if it doesn't exist
          if (!typedRawData.editHistory) {
            typedRawData.editHistory = [];
          }

          // Add the original to history
          const editHistory = typedRawData.editHistory as Array<unknown>;
          editHistory.push({
            previousText: originalText,
            timestamp: new Date().toISOString(),
          });

          // Update edited timestamp
          typedRawData.editedAt = new Date().toISOString();

          // Update the raw data
          message.rawData = typedRawData;
        }
      }

      // If the message is marked as deleted
      if (update.delete) {
        message.isDeleted = true;
      }

      // Save updated message
      await this.messageRepository.save(message);
      this.logger.log(
        `Updated message ${messageId} in chat ${chatId}`,
        'MessageService',
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to update message ${messageId} in chat ${chatId}:`,
        err,
      );
    }
  }

  /**
   * Updates the receipt status of a message (read, delivered)
   */
  async updateMessageReceipt(
    sessionId: string,
    chatId: string,
    messageId: string,
    receipt: ExtendedMessageReceipt,
  ): Promise<void> {
    try {
      const message = await this.messageRepository.findOne({
        where: {
          sessionId,
          chatId,
          id: messageId,
        },
      });

      if (!message) {
        this.logger.warn(
          `Message ${messageId} not found for receipt update in chat ${chatId}`,
          'MessageService',
        );
        return;
      }

      // Store the full receipt data in rawData for reference
      if (message.rawData) {
        const typedRawData = message.rawData as Record<string, unknown>;

        if (!typedRawData.receipts) {
          typedRawData.receipts = [];
        }

        const receipts = typedRawData.receipts as Array<
          Record<string, unknown>
        >;
        receipts.push({
          timestamp: new Date().toISOString(),
          readTimestamp: receipt.readTimestamp,
          deliveredTimestamp: receipt.deliveredTimestamp,
          playedTimestamp: receipt.playedTimestamp,
          type: receipt.type,
        });

        // Update the raw data
        message.rawData = typedRawData;
      }

      await this.messageRepository.save(message);
      this.logger.log(
        `Updated receipt for message ${messageId} in chat ${chatId}`,
        'MessageService',
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to update receipt for message ${messageId} in chat ${chatId}:`,
        err,
      );
    }
  }

  /**
   * Get messages for a chat with pagination
   */
  async getChatMessages(
    sessionId: string,
    chatId: string,
    options: {
      limit?: number;
      before?: number; // timestamp
      fromMe?: boolean;
    } = {},
  ): Promise<MessageEntity[]> {
    try {
      const query = this.messageRepository
        .createQueryBuilder('message')
        .where('message.sessionId = :sessionId', { sessionId })
        .andWhere('message.chatId = :chatId', { chatId })
        .orderBy('message.timestamp', 'DESC');

      if (options.before) {
        query.andWhere('message.timestamp < :before', {
          before: options.before,
        });
      }

      if (options.fromMe !== undefined) {
        query.andWhere('message.fromMe = :fromMe', { fromMe: options.fromMe });
      }

      if (options.limit) {
        query.take(options.limit);
      }

      return query.getMany();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to get messages for chat ${chatId} in session ${sessionId}:`,
        err,
      );
      return [];
    }
  }

  /**
   * Delete messages from a chat that match specific conditions
   */
  async deleteMessagesConditional(
    sessionId: string,
    chatId: string,
    conditions: {
      before?: number; // timestamp
      fromMe?: boolean;
      isDeleted?: boolean;
      mediaType?: string;
    } = {},
  ): Promise<number> {
    try {
      const queryBuilder = this.messageRepository
        .createQueryBuilder('message')
        .delete()
        .from(MessageEntity)
        .where('message.sessionId = :sessionId', { sessionId })
        .andWhere('message.chatId = :chatId', { chatId });

      if (conditions.before) {
        queryBuilder.andWhere('message.timestamp < :before', {
          before: conditions.before,
        });
      }

      if (conditions.fromMe !== undefined) {
        queryBuilder.andWhere('message.fromMe = :fromMe', {
          fromMe: conditions.fromMe,
        });
      }

      if (conditions.isDeleted !== undefined) {
        queryBuilder.andWhere('message.isDeleted = :isDeleted', {
          isDeleted: conditions.isDeleted,
        });
      }

      if (conditions.mediaType) {
        queryBuilder.andWhere(`message.mediaInfo->>'type' = :mediaType`, {
          mediaType: conditions.mediaType,
        });
      }

      const result = await queryBuilder.execute();
      return result.affected || 0;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to delete messages conditionally for chat ${chatId} in session ${sessionId}:`,
        err,
      );
      return 0;
    }
  }
}
