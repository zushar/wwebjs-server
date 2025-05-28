// wwebjs.services.ts
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import WAWebJS, { Chat, Client } from 'whatsapp-web.js';
import { ConnectService } from './connect.service';

@Injectable()
export class WwebjsServices {
  private readonly logger = new Logger(WwebjsServices.name);

  constructor(private readonly connectService: ConnectService) {}

  /**
   * Retrieves a verified client from memory or Redis.
   * If the client is not verified, it throws a ForbiddenException.
   * If the client is not found in memory, it attempts to restore it from Redis.
   */
  private async getVerifiedClient(clientId: string): Promise<Client> {
    try {
      let clientState = this.connectService.getClient(clientId);
      if (clientState === undefined) {
        const redisClientMeta =
          await this.connectService.getClientMeta(clientId);
        this.logger.log(
          `Client ${clientId} not found in memory, attempting to restore from Redis.`,
        );
        if (!redisClientMeta) {
          const errorMsg = `Client ${clientId} not found in memory or Redis.`;
          this.logger.error(errorMsg);
          throw new ForbiddenException(errorMsg);
        } else {
          const result = await this.connectService.createVerificationCode(
            clientId,
            redisClientMeta.type,
          );
          if (result.message?.includes('disconnected')) {
            throw new ForbiddenException(
              `Client ${clientId} is disconnected or does not exist.`,
            );
          }
          clientState = this.connectService.getClient(clientId);
        }
      }
      if (!clientState) {
        throw new ForbiddenException(
          `Client ${clientId} is not ready or invalid.`,
        );
      }
      return clientState.client;
    } catch {
      throw new ForbiddenException(
        `Client ${clientId} is not verified or does not exist.`,
      );
    }
  }

  /**
   * Sends a message using the specified WhatsApp client.
   */
  async sendMessage(
    clientId: string,
    recipient: string,
    message: string,
  ): Promise<WAWebJS.Message> {
    this.logger.log(
      `Attempting to send message from ${clientId} to ${recipient}`,
    );
    let client: Client;
    let formattedRecipient = '';
    try {
      client = await this.getVerifiedClient(clientId);
      this.logger.log(
        `Client ${clientId} is verified and ready for sending messages.`,
      );
      formattedRecipient = recipient.includes('@')
        ? recipient
        : `${recipient}@c.us`;
      const msgResult = await client.sendMessage(formattedRecipient, message);
      this.logger.log(
        `Message sent successfully from ${clientId} to ${formattedRecipient}`,
      );
      return msgResult;
    } catch (error) {
      this.logger.error(
        `Error sending message from ${clientId} to ${formattedRecipient}:`,
        error,
      );
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.forceMemoryCleanup();
    }
  }

  /**
   * Gets all group chats for the specified client.
   */
  async getAllGroups(
    clientId: string,
  ): Promise<{ groups: { id: string; name: string }[] }> {
    this.logger.log(`Fetching all groups for clientId: ${clientId}`);
    const client = await this.getVerifiedClient(clientId);

    try {
      const allChats = await client.getChats();
      const groups = allChats
        .filter((chat: Chat) => chat.isGroup)
        .map((chat: Chat) => ({
          id: chat.id._serialized,
          name: chat.name,
        }));
      this.logger.log(
        `Found ${groups.length} groups for clientId: ${clientId}`,
      );
      return { groups };
    } catch (error) {
      this.logger.error(`Error fetching groups for ${clientId}:`, error);
      throw new InternalServerErrorException(
        `Failed to fetch groups: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.forceMemoryCleanup();
    }
  }

  /**
   * Gets all archived group chats for the specified client.
   */
  async getAllGroupsInArchive(
    clientId: string,
  ): Promise<{ archivedGroups: { id: string; name: string }[] }> {
    this.logger.log(`Fetching archived groups for clientId: ${clientId}`);
    try {
      const client = await this.getVerifiedClient(clientId);
      this.logger.log(
        `Client ${clientId} is verified and ready for fetching archived groups.`,
      );
      const clientState = await client.getState();
      this.logger.log(`Client state: ${clientState}`);
      const allChats = await client.getChats();
      const archivedGroups = allChats
        .filter((chat: Chat) => chat.isGroup && chat.archived)
        .map((chat: Chat) => ({
          id: chat.id._serialized,
          name: chat.name,
        }));
      this.logger.log(
        `Found ${archivedGroups.length} archived groups for clientId: ${clientId}`,
      );
      return { archivedGroups };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(
        `Error fetching archived groups for ${clientId}:`,
        error,
      );
      throw new InternalServerErrorException(
        `Failed to fetch archived groups: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.forceMemoryCleanup();
    }
  }

  /**
   * Deletes all messages from all archived groups.
   */
  async deleteAllMessagesFromArchivedGroups(
    clientId: string,
  ): Promise<{ deletedFromGroups: string[] }> {
    this.logger.log(
      `Deleting all messages from archived groups for clientId: ${clientId}`,
    );
    const client = await this.getVerifiedClient(clientId);

    try {
      const allChats = await client.getChats();
      const archivedGroups = allChats.filter(
        (chat: Chat) => chat.isGroup && chat.archived,
      );
      const deletedFromGroups: string[] = [];

      for (const group of archivedGroups) {
        try {
          await group.clearMessages();
          deletedFromGroups.push(group.id._serialized);
          this.logger.log(
            `Cleared messages from archived group ${group.id._serialized}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to clear messages from archived group ${group.id._serialized}:`,
            err,
          );
        }
      }
      this.forceMemoryCleanup();
      return { deletedFromGroups };
    } catch (error) {
      this.forceMemoryCleanup();
      this.logger.error(
        `Error deleting messages from archived groups for ${clientId}:`,
        error,
      );
      throw new InternalServerErrorException(
        `Failed to delete messages from archived groups: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Deletes all messages from specific groups.
   */
  async deleteMessagesFromGroups(
    clientId: string,
    groupIds: string[],
  ): Promise<{ deletedFromGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Deleting messages from specific groups for clientId: ${clientId}`,
    );
    const client = await this.getVerifiedClient(clientId);

    const deletedFromGroups: string[] = [];
    const invalidGroupIds: string[] = [];

    for (const groupId of groupIds) {
      try {
        const chat = await client.getChatById(groupId);
        if (!chat || !chat.isGroup) {
          this.logger.warn(
            `Group ID ${groupId} is invalid or not a group for clientId: ${clientId}`,
          );
          invalidGroupIds.push(groupId);
          continue;
        }
        await chat.clearMessages();
        deletedFromGroups.push(groupId);
        this.logger.log(
          `Cleared messages from group ${groupId} for clientId: ${clientId}`,
        );
      } catch (error) {
        this.logger.error(
          `Error clearing messages from group ${groupId} for clientId: ${clientId}:`,
          error,
        );
        invalidGroupIds.push(groupId);
      }
    }
    this.forceMemoryCleanup();
    return { deletedFromGroups, invalidGroupIds };
  }

  /**
   * Sends a message to specific groups.
   */
  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((res) => setTimeout(res, delay));
  }

  async sendMessageToGroups(
    clientId: string,
    groupIds: string[],
    message: string,
  ): Promise<{ sentToGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Sending message to specific groups for clientId: ${clientId}`,
    );
    const sentToGroups: string[] = [];
    const invalidGroupIds: string[] = [];
    let currentGroupId = '';

    try {
      const client = await this.getVerifiedClient(clientId);

      for (const groupId of groupIds) {
        currentGroupId = groupId;

        const chat = await client.getChatById(groupId);
        if (!chat || !chat.isGroup) {
          this.logger.warn(
            `Group ID ${groupId} is invalid or not a group for clientId: ${clientId}`,
          );
          invalidGroupIds.push(groupId);
          continue;
        }

        // השהייה אקראית לפני השליחה
        await this.randomDelay(1200, 2000);

        await client.sendMessage(groupId, message);
        sentToGroups.push(groupId);
        this.logger.log(
          `Sent message to group ${groupId} for clientId: ${clientId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error sending message to group ${currentGroupId} for clientId: ${clientId}:`,
        error,
      );
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // אם אירעה שגיאה במהלך שליחה, נסמן את הקבוצה הנוכחית כבלתי תקינה
      invalidGroupIds.push(currentGroupId);
    }

    this.forceMemoryCleanup();
    return { sentToGroups, invalidGroupIds };
  }

  /**
   * Deletes a client from memory.
   */
  deleteClient(clientId: string): void {
    this.logger.log(`Deleting client with clientId: ${clientId}`);
    this.connectService.removeClient(clientId);
  }

  forceMemoryCleanup(): void {
    this.logger.log('Forcing memory cleanup');
    // הפעל garbage collection באופן יזום
    if (global.gc) {
      global.gc();
    }
  }
}
