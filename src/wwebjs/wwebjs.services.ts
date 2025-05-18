// wwebjs.services.ts
import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/redis/redis.module';
import { Chat, Client } from 'whatsapp-web.js';
import { ConnectService } from './connect.service';

@Injectable()
export class WwebjsServices {
  private readonly logger = new Logger(WwebjsServices.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly connectService: ConnectService,
  ) {}

  /**
   * Retrieves a verified client from memory or Redis.
   * If the client is not verified, it throws a ForbiddenException.
   * If the client is not found in memory, it attempts to restore it from Redis.
   */
  private async getVerifiedClient(clientId: string): Promise<Client> {
    let clientState: { client: Client; ready: boolean } | undefined = undefined;

    try {
      clientState = this.connectService.getClient(clientId);
    } catch (e) {
      this.logger.warn(
        `Client ${clientId} not found in memory. Attempting to restore from Redis...`,
      );
    }

    if (!clientState) {
      this.logger.log(`Re-initializing client ${clientId} from Redis...`);
      const redisClientMeta = await this.connectService.getClientMeta(clientId);
      if (!redisClientMeta) {
        const errorMsg = `Client ${clientId} not found in Redis.`;
        this.logger.error(errorMsg);
        throw new ForbiddenException(errorMsg);
      }
      // Re-initialize the client (this should add it to memory)
      await this.connectService.createVerificationCode(
        clientId,
        redisClientMeta.type,
      );
      // Wait for the client to be ready in memory
      let retries = 10;
      while (retries-- > 0) {
        try {
          clientState = this.connectService.getClient(clientId);
          if (clientState && clientState.ready) {
            break;
          }
        } catch (e) {
          // Not ready yet
        }
        await new Promise((res) => setTimeout(res, 1000)); // Wait 1 second
      }
      if (!clientState || !clientState.ready) {
        const errorMsg = `Failed to re-initialize client for clientId ${clientId} from Redis.`;
        this.logger.error(errorMsg);
        throw new ForbiddenException(errorMsg);
      }
    }
    return clientState.client;
  }

  /**
   * Sends a message using the specified WhatsApp client.
   */
  async sendMessage(
    clientId: string,
    recipient: string,
    message: string,
  ): Promise<unknown> {
    this.logger.log(
      `Attempting to send message from ${clientId} to ${recipient}`,
    );
    const client = await this.getVerifiedClient(clientId);
    const formattedRecipient = recipient.includes('@')
      ? recipient
      : `${recipient}@c.us`;
    try {
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
      throw new InternalServerErrorException(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    }
  }

  /**
   * Gets all archived group chats for the specified client.
   */
  async getAllGroupsInArchive(
    clientId: string,
  ): Promise<{ archivedGroups: { id: string; name: string }[] }> {
    this.logger.log(`Fetching archived groups for clientId: ${clientId}`);
    const client = await this.getVerifiedClient(clientId);

    try {
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
      this.logger.error(
        `Error fetching archived groups for ${clientId}:`,
        error,
      );
      throw new InternalServerErrorException(
        `Failed to fetch archived groups: ${error instanceof Error ? error.message : String(error)}`,
      );
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

      return { deletedFromGroups };
    } catch (error) {
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

    return { deletedFromGroups, invalidGroupIds };
  }

  /**
   * Sends a message to specific groups.
   */
  async sendMessageToGroups(
    clientId: string,
    groupIds: string[],
    message: string,
  ): Promise<{ sentToGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Sending message to specific groups for clientId: ${clientId}`,
    );
    const client = await this.getVerifiedClient(clientId);

    const sentToGroups: string[] = [];
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
        await client.sendMessage(groupId, message);
        sentToGroups.push(groupId);
        this.logger.log(
          `Sent message to group ${groupId} for clientId: ${clientId}`,
        );
      } catch (error) {
        this.logger.error(
          `Error sending message to group ${groupId} for clientId: ${clientId}:`,
          error,
        );
        invalidGroupIds.push(groupId);
      }
    }

    return { sentToGroups, invalidGroupIds };
  }
  /**
   * Deletes a client from memory.
   */
  deleteClient(clientId: string): void {
    this.logger.log(`Deleting client with clientId: ${clientId}`);
    this.connectService.removeClient(clientId);
  }
}
