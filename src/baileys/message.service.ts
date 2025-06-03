import { Inject, Injectable, LoggerService, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AnyMessageContent, proto } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { MessageParserUtil } from '../utils/message-parser.util';
import { ConnectionService } from './connection.service';
import { MessageData } from './entityes/chat-data.entity';

@Injectable()
export class MessageService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(MessageData)
    private messageRepository: Repository<MessageData>,
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
      // Extract message content based on message type
      const messageContent = MessageParserUtil.extractMessageContent(message);

      // Create the entity first to avoid type issues
      const messageEntity = new MessageData();
      messageEntity.id = message.key.id;
      messageEntity.sessionId = sessionId;
      messageEntity.chatId = chatId;
      messageEntity.fromMe = Boolean(message.key.fromMe);
      messageEntity.senderJid =
        message.key.participant ||
        message.participant ||
        message.key.remoteJid ||
        undefined;
      messageEntity.messageContent = messageContent;

      // Handle messageTimestamp properly
      const timestamp =
        typeof message.messageTimestamp === 'number'
          ? new Date(message.messageTimestamp * 1000)
          : new Date();
      messageEntity.timestamp = timestamp;

      await this.messageRepository.save(messageEntity);
    } catch (error) {
      this.logger.error(`Failed to store message ${message.key.id}:`, error);
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
      const messageData = await this.messageRepository.findOne({
        where: {
          sessionId,
          chatId: remoteJid,
          id,
          ...(fromMe !== undefined ? { fromMe } : {}),
        },
      });

      if (!messageData || !messageData.messageContent) {
        return undefined;
      }

      // Return the message content
      return messageData.messageContent as unknown as proto.IMessage;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve message (${id}) from database:`,
        error,
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
      this.logger.error(
        `Failed to delete messages for chat ${chatId} in session ${sessionId}:`,
        error,
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
      const conditions: any = {
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
      this.logger.error(
        `Failed to delete message ${messageId} from chat ${chatId}:`,
        error,
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
    update: any,
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

      // Handle different types of updates
      if (update.reactions) {
        // If the messageContent is stored as a string, parse it first
        let content =
          typeof message.messageContent === 'string'
            ? JSON.parse(message.messageContent)
            : message.messageContent;

        // Update reactions
        content = {
          ...content,
          reactions: update.reactions,
        };

        message.messageContent = content;
      }

      if (update.edit) {
        // Handle edited message content
        let content =
          typeof message.messageContent === 'string'
            ? JSON.parse(message.messageContent)
            : message.messageContent;

        // Store both original and edited content
        content = {
          ...content,
          editHistory: content.editHistory || [],
          editedAt: new Date().toISOString(),
        };

        // Add original to history before replacing
        content.editHistory.push({
          previous: { ...content },
          timestamp: new Date().toISOString(),
        });

        // Update with new content
        Object.assign(content, update.edit);

        message.messageContent = content;
      }

      // Add other update handlers as needed

      await this.messageRepository.save(message);
      this.logger.log(
        `Updated message ${messageId} in chat ${chatId}`,
        'MessageService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to update message ${messageId} in chat ${chatId}:`,
        error,
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
    receipt: any,
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

      // Update receipt information
      const content =
        typeof message.messageContent === 'string'
          ? JSON.parse(message.messageContent)
          : message.messageContent;

      // Store receipt information
      message.messageContent = {
        ...content,
        receipt: {
          ...content.receipt,
          ...receipt,
          updatedAt: new Date().toISOString(),
        },
      };

      await this.messageRepository.save(message);
      this.logger.log(
        `Updated receipt for message ${messageId} in chat ${chatId}`,
        'MessageService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to update receipt for message ${messageId} in chat ${chatId}:`,
        error,
      );
    }
  }
}
