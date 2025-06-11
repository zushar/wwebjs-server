import { forwardRef, Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Chat, ChatModification, proto } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { ConnectionService } from './connection.service';
import { GroupEntity } from './entityes/group.entity';
import { WChat } from './interfaces/chat-data.interface';

@Injectable()
export class GroupService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(GroupEntity)
    private chatEntityRepository: Repository<GroupEntity>,
    @Inject(forwardRef(() => ConnectionService))
    private readonly connectionService: ConnectionService,
  ) {}

  /**
   * Make sure a chat exists in the database.
   * If it doesn't, we insert a bare-bones record with only sessionId and id.
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
      // We no longer set `isGroup` here (that column was removed from the entity).
      chat.name = ''; // at minimum, give this a default so the row is valid
      await this.chatEntityRepository.save(chat);
    }

    return chat;
  }

  /**
   * Stores (or updates) a chat using the GroupEntity.
   * We look up by (sessionId, chat.id); if it doesn't exist, we create it,
   * then call updateFromBaileysGroup(...) and persist.
   */
  async storeEnhancedGroup(
    sessionId: string,
    chat: Chat,
  ): Promise<GroupEntity> {
    try {
      let groupEntity = await this.chatEntityRepository.findOne({
        where: { sessionId, id: chat.id },
      });

      if (!groupEntity) {
        groupEntity = new GroupEntity();
        groupEntity.sessionId = sessionId;
        groupEntity.id = chat.id!;
      }

      groupEntity.updateFromBaileysGroup(chat);
      return await this.chatEntityRepository.save(groupEntity);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to store enhanced chat ${chat.id}:`, err);
      throw err;
    }
  }

  /**
   * Lookup a chat by its JID (within a given session).
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
   * Get all chats for a session (with optional "archived" filter).
   * Returns [entities[], totalCount].
   */
  async getGroups(
    sessionId: string,
    options?: { archived?: boolean },
  ): Promise<[GroupEntity[], number]> {
    const qb = this.chatEntityRepository
      .createQueryBuilder('chat')
      .where('chat.sessionId = :sessionId', { sessionId });

    if (options?.archived !== undefined) {
      qb.andWhere('chat.archived = :archived', { archived: options.archived });
    }

    // pin first (NULLs last), then most-recent conversationTimestamp
    qb.orderBy('chat.pinned', 'ASC', 'NULLS LAST').addOrderBy(
      'chat.conversationTimestamp',
      'DESC',
    );

    return qb.getManyAndCount();
  }

  /**
   * Update the "archived" flag on a chat. If the chat doesn't exist yet,
   * we create a bare-bones row via ensureChatExists, then set archived.
   */
  async updateArchiveStatus(
    sessionId: string,
    chatId: string,
    isArchived: boolean,
  ): Promise<void> {
    try {
      const groupEntity = await this.chatEntityRepository.findOne({
        where: { sessionId, id: chatId },
      });

      if (groupEntity) {
        groupEntity.archived = isArchived;
        await this.chatEntityRepository.save(groupEntity);
        this.logger.log(
          `Updated archive status for ${chatId} to ${isArchived}`,
        );
      } else {
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
   * Updates the group's participant list in the database.
   *
   * Now that IGroupParticipant = { userJid: string; rank?: Rank | null },
   * we operate on existingChat.participant: proto.IGroupParticipant[] | null.
   */
  async updateGroupParticipants(
    sessionId: string,
    groupId: string,
    participants: proto.IGroupParticipant[],
    action: 'add' | 'remove' | 'promote' | 'demote' | 'modify',
  ): Promise<void> {
    try {
      const existingChat = await this.chatEntityRepository.findOne({
        where: { sessionId, id: groupId },
      });

      if (!existingChat) {
        this.logger.warn(
          `Group ${groupId} not found for participant update in session ${sessionId}`,
        );
        return;
      }

      // Ensure the "participant" array is initialized
      if (!Array.isArray(existingChat.participant)) {
        existingChat.participant = [];
      }

      switch (action) {
        case 'add':
          for (const newP of participants) {
            // Only push if userJid is not already in existingChat.participant
            const already = existingChat.participant.some(
              (p) => p.userJid === newP.userJid,
            );
            if (!already) {
              existingChat.participant.push({
                userJid: newP.userJid,
                // If the caller provided a rank, use it; otherwise default to REGULAR
                rank:
                  newP.rank != null
                    ? newP.rank
                    : proto.GroupParticipant.Rank.REGULAR,
              });
            }
          }
          break;

        case 'remove':
          // Filter out any existing entries whose userJid matches one of participants[]
          existingChat.participant = existingChat.participant.filter(
            (p) => !participants.some((remP) => remP.userJid === p.userJid),
          );
          break;

        case 'promote':
          // "Promote" means set rank = ADMIN for each listed userJid
          for (const promoP of participants) {
            const match = existingChat.participant.find(
              (p) => p.userJid === promoP.userJid,
            );
            if (match) {
              match.rank = proto.GroupParticipant.Rank.ADMIN;
            }
          }
          break;

        case 'demote':
          // "Demote" means set rank = REGULAR for each listed userJid
          for (const demoP of participants) {
            const match = existingChat.participant.find(
              (p) => p.userJid === demoP.userJid,
            );
            if (match) {
              match.rank = proto.GroupParticipant.Rank.REGULAR;
            }
          }
          break;

        case 'modify':
          // "Modify" lets you update whatever `rank` was passed.
          // If more fields existed on IGroupParticipant, you would update them here.
          for (const modP of participants) {
            const match = existingChat.participant.find(
              (p) => p.userJid === modP.userJid,
            );
            if (match && modP.rank != null) {
              match.rank = modP.rank;
            }
          }
          break;
      }

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
  async clearMultipleGroupChats(
    sessionId: string,
    groupIds?: string[],
  ): Promise<{
    results: { groupId: string; success: boolean; error?: string }[];
  }> {
    const results: {
      groupId: string;
      success: boolean;
      error?: string;
    }[] = [];

    // Get connection for the given sessionId
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
    const socket = connection.socket;
    const chats = this.connectionService.getChats();

    let groupsToClear: WChat[] = [];

    if (!groupIds || groupIds.length === 0) {
      // Find all archived groups for this session
      groupsToClear = Array.from(chats.values()).filter(
        (chat) => chat.archived === true,
      );
    } else {
      // Find only the specified groups for this session
      groupsToClear = Array.from(chats.values()).filter(
        (chat) => chat.chatid != null && groupIds.includes(chat.chatid),
      );
    }

    for (const group of groupsToClear) {
      console.log('--- Processing group:', group.chatid, '---');
      console.dir(group, { depth: null, colors: true });
      try {
        if (
          group.messageTimestamp &&
          group.messageId &&
          group.fromMe !== null &&
          group.chatid
        ) {
          // --- הדפסת המשתנים לפני השליחה ל-chatModify ---
          const chatModifyPayload: ChatModification = {
            delete: true,
            lastMessages: [
              {
                key: {
                  id: group.messageId,
                  remoteJid: group.chatid,
                  fromMe: group.fromMe,
                },
                messageTimestamp: group.messageTimestamp,
              },
            ],
          };

          console.log('--- Sending to chatModify: ---');
          console.dir(chatModifyPayload, { depth: null, colors: true });
          console.log('--- Target group ID:', group.chatid, '---');
          // --- סוף הדפסת המשתנים ---

          await socket.chatModify(chatModifyPayload, group.chatid);
          await socket.chatModify(
            {
              archive: true,
              lastMessages: [
                {
                  key: {
                    id: group.messageId,
                    remoteJid: group.chatid,
                    fromMe: group.fromMe,
                  },
                  messageTimestamp: group.messageTimestamp,
                },
              ],
            },
            group.chatid,
          );
          this.logger.log(
            `Successfully cleared group ${group.chatid} in session ${sessionId}`,
          );
          results.push({ groupId: group.chatid ?? 'unknown', success: true });
        } else {
          console.warn(
            `Could not find valid last message info for group: ${group.chatid}`,
          );
          results.push({
            groupId: group.chatid ?? 'unknown',
            success: false,
            error: 'No valid last message info',
          });
        }
      } catch (error) {
        results.push({
          groupId: group.chatid ?? 'unknown',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { results };
  }
}
