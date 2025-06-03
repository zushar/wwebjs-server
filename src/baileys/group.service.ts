import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Chat } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { GroupEntity } from './entityes/group.entity';

@Injectable()
export class GroupService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(GroupEntity)
    private chatEntityRepository: Repository<GroupEntity>,
  ) {}

  /**
   * Make sure a chat exists in the database
   */
  private async ensureChatExists(
    sessionId: string,
    chatId: string,
  ): Promise<GroupEntity> {
    let chat = await this.chatEntityRepository.findOne({
      where: { sessionId, id: chatId },
    });

    if (!chat) {
      chat = new GroupEntity();
      chat.sessionId = sessionId;
      chat.id = chatId;
      chat.name = '';
      chat.isGroup = chatId.endsWith('@g.us');

      await this.chatEntityRepository.save(chat);
    }

    return chat;
  }

  /**
   * Stores a chat using the GroupEntity
   */
  async storeEnhancedGroup(
    sessionId: string,
    chat: Chat,
  ): Promise<GroupEntity> {
    try {
      // Try to find an existing chat entity
      let groupEntity = await this.chatEntityRepository.findOne({
        where: {
          sessionId,
          id: chat.id,
        },
      });

      // If not found, create a new one
      if (!groupEntity) {
        groupEntity = new GroupEntity();
        groupEntity.sessionId = sessionId;
        groupEntity.id = chat.id;
      }

      // Update the entity using our helper method
      groupEntity.updateFromBaileysGroup(chat);

      // Save to database
      return await this.chatEntityRepository.save(groupEntity);
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
  ): Promise<GroupEntity | null> {
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
  ): Promise<[GroupEntity[], number]> {
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
      // Find in the groupEntity
      const groupEntity = await this.chatEntityRepository.findOne({
        where: { sessionId, id: chatId },
      });

      if (groupEntity) {
        // Update in the structure
        groupEntity.archived = isArchived;
        await this.chatEntityRepository.save(groupEntity);
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
