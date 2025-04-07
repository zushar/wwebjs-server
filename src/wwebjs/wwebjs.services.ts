// wwebjs.services.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConnectService } from './connect.service';
import { Chat } from 'whatsapp-web.js'; // Import Chat type

@Injectable()
export class WwebjsServices {
  private readonly logger = new Logger(WwebjsServices.name);

  constructor(private readonly connectService: ConnectService) {}

  /**
   * Helper function to get the client and check verification status from Redis.
   */
  private async getVerifiedClient(phoneNumber: string) {
    const connection = this.connectService.getClient(phoneNumber); // Gets in-memory client

    // Check verification status in Redis before proceeding
    const isVerified = await this.connectService.isClientVerified(phoneNumber);
    if (!isVerified) {
      const errorMsg = `Client for phone number ${phoneNumber} is not verified. Please complete the pairing process.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg); // Or a specific HTTP exception like ForbiddenException
    }

    // Also check the in-memory 'verify' flag which is set during the verifyCode flow
    // This adds an extra layer, ensuring the verify endpoint was hit for pairing code flows.
    if (!connection.verify) {
      const errorMsg = `Client for phone number ${phoneNumber} has not completed the verification step.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    return connection.client;
  }

  /**
   * Sends a message using the specified WhatsApp client.
   * Ensures the client is verified before sending.
   */
  async sendMessage(
    phoneNumber: string,
    recipient: string,
    message: string,
  ): Promise<unknown> {
    this.logger.log(
      `Attempting to send message from ${phoneNumber} to ${recipient}`,
    );
    const client = await this.getVerifiedClient(phoneNumber); // Checks verification
    const formattedRecipient = recipient.includes('@')
      ? recipient
      : `${recipient}@c.us`;
    this.logger.log(
      `Client ${phoneNumber} verified. Sending message to formatted recipient: ${formattedRecipient}`,
    );
    try {
      const msgResult = await client.sendMessage(formattedRecipient, message);
      this.logger.log(
        `Message sent successfully from ${phoneNumber} to ${formattedRecipient}`,
      );
      return msgResult;
    } catch (error) {
      this.logger.error(
        `Error sending message from ${phoneNumber} to ${formattedRecipient}:`,
        error,
      );
      throw error; // Re-throw the error to be handled by NestJS
    }
  }

  /**
   * Gets all archived group chats for the specified client.
   * Ensures the client is verified.
   */
  async getAllGroupsInArchive(phoneNumber: string): Promise<Chat[]> {
    this.logger.log(
      `Attempting to fetch archived groups for phoneNumber: ${phoneNumber}`,
    );
    const client = await this.getVerifiedClient(phoneNumber); // Checks verification
    this.logger.log(`Client ${phoneNumber} verified. Fetching chats.`);

    try {
      const allChats = await client.getChats();
      this.logger.log(
        `Fetched ${allChats.length} total chats for phoneNumber: ${phoneNumber}`,
      );
      const groupsInArchive = allChats.filter(
        (chat) => chat.isGroup && chat.archived,
      );
      this.logger.log(
        `Found ${groupsInArchive.length} archived groups for phoneNumber: ${phoneNumber}`,
      );
      return groupsInArchive;
    } catch (error) {
      this.logger.error(
        `Error fetching chats/archived groups for ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Sends a message to a specific group using the specified client.
   * Ensures the client is verified.
   */
  async sendMessageToGroup(
    phoneNumber: string,
    groupId: string,
    message: string,
  ): Promise<unknown> {
    this.logger.log(
      `Attempting to send message to group ${groupId} from phoneNumber: ${phoneNumber}`,
    );
    const client = await this.getVerifiedClient(phoneNumber); // Checks verification
    this.logger.log(
      `Client ${phoneNumber} verified. Sending message to group ${groupId}.`,
    );

    try {
      const msgResult = await client.sendMessage(groupId, message);
      this.logger.log(
        `Message sent successfully to group ${groupId} from ${phoneNumber}`,
      );
      return msgResult;
    } catch (error) {
      this.logger.error(
        `Error sending message to group ${groupId} from ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clears messages from a specific group chat.
   * Ensures the client is verified.
   */
  async clearGroupChat(
    phoneNumber: string,
    groupId: string,
  ): Promise<{ message: string }> {
    this.logger.log(
      `Attempting to clear group chat ${groupId} from phoneNumber: ${phoneNumber}`,
    );
    const client = await this.getVerifiedClient(phoneNumber); // Checks verification
    this.logger.log(
      `Client ${phoneNumber} verified. Clearing chat for group ${groupId}.`,
    );

    try {
      const chat = await client.getChatById(groupId);
      if (!chat) {
        const errorMsg = `Chat with ID ${groupId} not found for client ${phoneNumber}`;
        this.logger.error(errorMsg);
        // Use NestJS specific exception for better HTTP response
        throw new NotFoundException(errorMsg);
      }
      if (!chat.isGroup) {
        const errorMsg = `Chat with ID ${groupId} is not a group chat.`;
        this.logger.error(errorMsg);
        throw new Error(errorMsg); // Or BadRequestException
      }

      const success = await chat.clearMessages();
      if (!success) {
        // wweb.js clearMessages usually returns true on success, false/throws on failure
        const errorMsg = `Failed to clear chat with ID ${groupId} (API returned false)`;
        this.logger.error(errorMsg);
        throw new Error(errorMsg); // Or InternalServerErrorException
      }

      this.logger.log(`Chat with ID ${groupId} cleared successfully`);
      return { message: 'Group chat cleared successfully' };
    } catch (error) {
      this.logger.error(
        `Error clearing group chat ${groupId} for ${phoneNumber}:`,
        error,
      );
      // Re-throw if it's not already a handled exception
      if (error instanceof NotFoundException || error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Failed to clear group chat: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Clears messages from multiple group chats.
   * Ensures the client is verified.
   */
  async clearGroupsChat(
    phoneNumber: string,
    chatIds: string[],
  ): Promise<{ message: string; cleared: string[]; failed: string[] }> {
    this.logger.log(
      `Attempting to clear multiple group chats for phoneNumber: ${phoneNumber}`,
    );
    const client = await this.getVerifiedClient(phoneNumber); // Checks verification
    this.logger.log(
      `Client ${phoneNumber} verified. Clearing ${chatIds.length} chats.`,
    );

    const clearedChats: string[] = [];
    const failedChats: string[] = [];

    for (const chatId of chatIds) {
      try {
        const chat = await client.getChatById(chatId);
        if (!chat) {
          this.logger.error(
            `Chat with ID ${chatId} not found for client ${phoneNumber}`,
          );
          failedChats.push(chatId);
          continue; // Skip to the next chat ID
        }
        if (!chat.isGroup) {
          this.logger.error(`Chat with ID ${chatId} is not a group chat.`);
          failedChats.push(chatId);
          continue;
        }

        const success = await chat.clearMessages();
        if (success) {
          clearedChats.push(chatId);
          this.logger.log(`Chat with ID ${chatId} cleared successfully`);
        } else {
          this.logger.error(
            `Failed to clear chat with ID ${chatId} (API returned false)`,
          );
          failedChats.push(chatId);
        }
      } catch (error) {
        this.logger.error(
          `Error clearing chat ${chatId} for ${phoneNumber}:`,
          error,
        );
        failedChats.push(chatId);
      }
    }

    this.logger.log(
      `Finished clearing chats for ${phoneNumber}. Cleared: ${clearedChats.length}, Failed: ${failedChats.length}`,
    );

    if (failedChats.length > 0) {
      // You might want to throw an error or return a specific status code
      // if any chats failed. Here, we return lists of successes and failures.
      return {
        message: `Completed clearing chats. Some chats failed.`,
        cleared: clearedChats,
        failed: failedChats,
      };
    }

    return {
      message: 'All specified group chats cleared successfully',
      cleared: clearedChats,
      failed: failedChats,
    };
  }
}
