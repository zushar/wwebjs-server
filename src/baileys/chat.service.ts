import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Chat, proto } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { ChatEntity } from './entityes/chat.entity';
import { MessageEntity } from './entityes/message.entity';

@Injectable()
export class ChatService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(ChatEntity)
    private chatEntityRepository: Repository<ChatEntity>,
    @InjectRepository(MessageEntity)
    private messageEntityRepository: Repository<MessageEntity>,
  ) {}

  /**
   * Store a chat message directly in the database
   */
  async storeChatMessage(
    sessionId: string,
    message: proto.IWebMessageInfo,
  ): Promise<void> {
    try {
      const chatId = message.key?.remoteJid;
      if (!chatId) {
        this.logger.warn('Cannot store message: missing remoteJid');
        return;
      }

      // Make sure the chat exists
      await this.ensureChatExists(sessionId, chatId);

      // Create message entity
      const messageEntity = new MessageEntity();
      messageEntity.sessionId = sessionId;
      messageEntity.chatId = chatId;
      messageEntity.id = message.key.id || `local-${Date.now()}`;
      messageEntity.fromMe = message.key.fromMe || false;
      messageEntity.sender = message.key.participant || chatId;

      // Extract text if available
      if (message.message) {
        if (message.message.conversation) {
          messageEntity.text = message.message.conversation;
        } else if (message.message.extendedTextMessage?.text) {
          messageEntity.text = message.message.extendedTextMessage.text;
        }
      }

      messageEntity.timestamp = message.messageTimestamp
        ? Number(message.messageTimestamp)
        : Date.now() / 1000;

      messageEntity.rawData = message;

      await this.messageEntityRepository.save(messageEntity);

      // Update the last message info in the chat
      await this.updateChatLastMessage(sessionId, chatId, messageEntity);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to store chat message:`, err);
    }
  }

  /**
   * Make sure a chat exists in the database
   */
  private async ensureChatExists(
    sessionId: string,
    chatId: string,
  ): Promise<ChatEntity> {
    let chat = await this.chatEntityRepository.findOne({
      where: { sessionId, id: chatId },
    });

    if (!chat) {
      chat = new ChatEntity();
      chat.sessionId = sessionId;
      chat.id = chatId;
      chat.name = '';
      chat.isGroup = chatId.endsWith('@g.us');

      await this.chatEntityRepository.save(chat);
    }

    return chat;
  }

  /**
   * Update the last message information for a chat
   */
  private async updateChatLastMessage(
    sessionId: string,
    chatId: string,
    message: MessageEntity,
  ): Promise<void> {
    await this.chatEntityRepository.update(
      { sessionId, id: chatId },
      {
        lastMessageId: message.id,
        lastMessageText: message.text || '(media message)',
        lastMessageTimestamp: message.timestamp,
        conversationTimestamp: message.timestamp,
      },
    );
  }

  /**
   * Stores a chat using the ChatEntity
   */
  async storeEnhancedChat(sessionId: string, chat: Chat): Promise<ChatEntity> {
    try {
      // Try to find an existing chat entity
      let chatEntity = await this.chatEntityRepository.findOne({
        where: {
          sessionId,
          id: chat.id,
        },
      });

      // If not found, create a new one
      if (!chatEntity) {
        chatEntity = new ChatEntity();
        chatEntity.sessionId = sessionId;
        chatEntity.id = chat.id;
      }

      // Update the entity using our helper method
      chatEntity.updateFromBaileysChat(chat);

      // Save to database
      return await this.chatEntityRepository.save(chatEntity);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to store enhanced chat ${chat.id}:`, err);
      throw err;
    }
  }

  /**
   * Get a chat by its JID
   */
  async getChatByJid(
    sessionId: string,
    jid: string,
  ): Promise<ChatEntity | null> {
    return this.chatEntityRepository.findOne({
      where: { sessionId, id: jid },
    });
  }

  /**
   * Get all chats for a session with optional filtering
   */
  async getChats(
    sessionId: string,
    options?: {
      archived?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<[ChatEntity[], number]> {
    const query = this.chatEntityRepository
      .createQueryBuilder('chat')
      .where('chat.sessionId = :sessionId', { sessionId });

    if (options?.archived !== undefined) {
      query.andWhere('chat.archived = :archived', {
        archived: options.archived,
      });
    }

    // Add sorting: pinned chats first, then by last message timestamp
    query
      .orderBy('chat.pinned', 'ASC', 'NULLS LAST')
      .addOrderBy('chat.conversationTimestamp', 'DESC');

    if (options?.limit) {
      query.take(options.limit);
    }

    if (options?.offset) {
      query.skip(options.offset);
    }

    return query.getManyAndCount();
  }

  /**
   * Updates the archive status of a chat
   */
  async updateArchiveStatus(
    sessionId: string,
    chatId: string,
    isArchived: boolean,
  ): Promise<void> {
    try {
      // Find in the ChatEntity
      const chatEntity = await this.chatEntityRepository.findOne({
        where: { sessionId, id: chatId },
      });

      if (chatEntity) {
        // Update in the structure
        chatEntity.archived = isArchived;
        await this.chatEntityRepository.save(chatEntity);
        this.logger.log(
          `Updated archive status for ${chatId} to ${isArchived}`,
        );
      } else {
        // Create the chat if it doesn't exist
        await this.ensureChatExists(sessionId, chatId);
        await this.chatEntityRepository.update(
          { sessionId, id: chatId },
          { archived: isArchived },
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to update archive status for ${chatId}`, err);
    }
  }

  /**
   * Updates group participants in the database
   */
  async updateGroupParticipants(
    sessionId: string,
    groupId: string,
    participants: string[],
    action: 'add' | 'remove' | 'promote' | 'demote' | 'modify',
  ): Promise<void> {
    try {
      // Find the existing chat
      const existingChat = await this.chatEntityRepository.findOne({
        where: { sessionId, id: groupId },
      });

      if (!existingChat) {
        this.logger.warn(
          `Group ${groupId} not found for participant update in session ${sessionId}`,
        );
        return;
      }

      // Initialize metadata if needed
      if (!existingChat.metadata) {
        existingChat.metadata = {
          participants: [],
        };
      }

      // Initialize participants array if it doesn't exist
      if (!existingChat.metadata.participants) {
        existingChat.metadata.participants = [];
      }

      // Update based on action
      switch (action) {
        case 'add':
          for (const jid of participants) {
            if (!existingChat.metadata.participants.some((p) => p.id === jid)) {
              existingChat.metadata.participants.push({
                id: jid,
                isAdmin: false,
                isSuperAdmin: false,
              });
            }
          }
          break;
        case 'remove':
          existingChat.metadata.participants =
            existingChat.metadata.participants.filter(
              (p) => !participants.includes(p.id),
            );
          break;
        case 'promote':
        case 'demote':
          for (const jid of participants) {
            const participant = existingChat.metadata.participants.find(
              (p) => p.id === jid,
            );
            if (participant) {
              participant.isAdmin = action === 'promote';
            }
          }
          break;
        case 'modify':
          // Handle modify action
          for (const jid of participants) {
            const participant = existingChat.metadata.participants.find(
              (p) => p.id === jid,
            );
            if (participant) {
              // You might need to handle specific modifications if Baileys provides them
            }
          }
      }

      // Save the updated chat
      await this.chatEntityRepository.save(existingChat);

      this.logger.log(
        `Updated ${participants.length} participants for group ${groupId} in session ${sessionId}: ${action}`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to update participants for group ${groupId} in session ${sessionId}:`,
        err,
      );
    }
  }
}
