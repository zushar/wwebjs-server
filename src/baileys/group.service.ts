import { forwardRef, Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MinimalMessage } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { In, Repository } from 'typeorm';
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
   * Lookup a chat by its JID (within a given session).
   */
  async getChatByJid(
    sessionId: string,
    jid: string,
  ): Promise<GroupEntity | null> {
    return this.chatEntityRepository.findOne({
      where: { sessionId, chatid: jid },
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
    const whereClause: {
      sessionId: string;
      archived?: boolean;
    } = { sessionId };

    // Add archived filter if specified
    if (options?.archived !== undefined) {
      whereClause.archived = options.archived;
    }

    return this.chatEntityRepository.findAndCount({
      where: whereClause,
    });
  }

  async clearMultipleGroupChats(
    sessionId: string,
    groupIds?: string[],
  ): Promise<{
    results: {
      groupId: string;
      chatName: string;
      success: boolean;
      error?: string;
    }[];
  }> {
    const results: {
      groupId: string;
      chatName: string;
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

    let groupsToClear: WChat[] = [];

    if (!groupIds || groupIds.length === 0) {
      // Find all archived groups for this session
      groupsToClear = await this.chatEntityRepository.find({
        where: { sessionId, archived: true, asNewMessage: true },
      });
      if (groupsToClear.length === 0) {
        this.logger.warn(`No archived groups found for session ${sessionId}.`);
        return { results: [] };
      }
    } else {
      // Find only the specified groups for this session
      groupsToClear = await this.chatEntityRepository.find({
        where: {
          sessionId,
          chatid: In(groupIds),
          asNewMessage: true,
        },
      });
      if (groupsToClear.length === 0) {
        this.logger.warn(
          `No groups found for session ${sessionId} with specified IDs: ${groupIds.join(
            ', ',
          )}.`,
        );
        return { results: [] };
      }
    }
    let numGroups = 0;
    for (const group of groupsToClear) {
      numGroups++;
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
          const minimal: MinimalMessage = {
            key: {
              id: group.messageId,
              remoteJid: group.chatid,
              fromMe: group.fromMe,
              participant: group.messageParticipant,
            },
            messageTimestamp: group.messageTimestamp,
          };

          console.log('--- Sending to chatModify: ---');
          console.dir(minimal, { depth: null, colors: true });
          console.log('--- Target group ID:', group.chatid, '---');
          // --- סוף הדפסת המשתנים ---

          await socket.chatModify(
            { delete: true, lastMessages: [minimal] },
            group.chatid,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 1000 + 500),
          );
          await socket.chatModify(
            { archive: true, lastMessages: [minimal] },
            group.chatid,
          );
          this.logger.log(
            `Successfully cleared group ${group.chatid} in session ${sessionId}`,
          );
          results.push({
            groupId: group.chatid ?? 'unknown',
            chatName: group.chatName ?? 'Unknown Group',
            success: true,
          });
          await this.chatEntityRepository.update(
            { sessionId, chatid: group.chatid },
            { archived: true, asNewMessage: false },
          );
        } else {
          console.warn(
            `Could not find valid last message info for group: ${group.chatid}`,
          );
          results.push({
            groupId: group.chatid ?? 'unknown',
            chatName: group.chatName ?? 'Unknown Group',
            success: false,
            error: 'No valid last message info',
          });
        }
      } catch (error) {
        results.push({
          groupId: group.chatid ?? 'unknown',
          chatName: group.chatName ?? 'Unknown Group',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (numGroups >= 30) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 1000 + 500),
        );
        numGroups = 0;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 1000 + 500),
      );
    }

    return { results };
  }
}
