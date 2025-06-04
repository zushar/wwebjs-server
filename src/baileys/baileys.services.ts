import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ConnectionService } from './connection.service';
import { GroupService } from './group.service';
import { MessageService } from './message.service';

// Add the MessageTypes type if it doesn't exist

@Injectable()
export class BaileysService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly connectionService: ConnectionService,
    private readonly groupService: GroupService,
    private readonly messageService: MessageService,
  ) {}

  async onModuleInit() {
    await this.connectionService.restoreSessions();
  }

  async createConnection(
    sessionId: string,
    phoneNumber: string,
    user: string = 'zushar',
  ): Promise<{ status: string }> {
    return this.connectionService.createConnection(
      sessionId,
      phoneNumber,
      user,
    );
  }

  getPairingCode(sessionId: string): { pairingCode: string } {
    return this.connectionService.getPairingCode(sessionId);
  }

  getConnectionStatus(sessionId: string): { status: string } {
    return this.connectionService.getConnectionStatus(sessionId);
  }

  getActiveSessions(): { sessionId: string; status: string }[] {
    return this.connectionService.getActiveSessions();
  }

  async closeConnection(sessionId: string): Promise<{ success: boolean }> {
    return this.connectionService.closeConnection(sessionId);
  }

  async sendMessage(
    sessionId: string,
    to: string,
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{ success: boolean; messageId?: string }> {
    return this.messageService.sendMessage(sessionId, to, content, type);
  }

  async sendBulkMessages(
    sessionId: string,
    recipients: string[],
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{
    success: boolean;
    results: any[];
  }> {
    return this.messageService.sendBulkMessages(
      sessionId,
      recipients,
      content,
      type,
    );
  }

  // NEW: Send message to multiple groups
  async sendGroupMessages(
    sessionId: string,
    groupIds: string[],
    message: string,
  ): Promise<{
    success: boolean;
    results: Array<{
      groupId: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }>;
  }> {
    const connection = this.connectionService.getConnection(sessionId);

    if (!connection) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!connection.socket) {
      throw new Error(`Socket not available for session ${sessionId}`);
    }

    if (connection.status !== 'connected') {
      throw new Error(
        `Session ${sessionId} is not connected. Status: ${connection.status}`,
      );
    }

    const results: Array<{
      groupId: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }> = [];

    // Send message to each group
    for (const groupId of groupIds) {
      try {
        // Validate group ID format
        if (!groupId.endsWith('@g.us')) {
          results.push({
            groupId,
            success: false,
            error: 'Invalid group ID format. Must end with @g.us',
          });
          continue;
        }

        // Send the message
        const sentMessage = await connection.socket.sendMessage(groupId, {
          text: message,
        });

        results.push({
          groupId,
          success: true,
          messageId: sentMessage?.key?.id ?? undefined,
        });

        this.logger.log(
          `Message sent to group ${groupId} in session ${sessionId}`,
        );

        // Add a small delay between messages to avoid rate limiting
        if (groupIds.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          groupId,
          success: false,
          error: errorMessage,
        });

        this.logger.error(
          `Failed to send message to group ${groupId} in session ${sessionId}: ${errorMessage}`,
        );
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      success: successCount > 0,
      results,
    };
  }

  // function to clear group chat
  async clearGroupChat(sessionId: string, groupId: string): Promise<void> {
    try {
      const group = await this.groupService.getChatByJid(sessionId, groupId);
      if (!group) {
        this.logger.warn(`No messages found in chat ${groupId} to clear.`);
        return;
      }

      const connection = this.connectionService.getConnection(sessionId);
      if (!connection?.socket) {
        throw new Error(`Socket not available for session ${sessionId}`);
      }

      const jid = group.id;
      if (!jid) {
        throw new Error(`Invalid group ID: ${groupId}`);
      }

      if (!group.lastMessageId || !group.lastMessageTimestamp) {
        this.logger.warn(`No last message found in group ${groupId} to clear.`);
        return;
      }

      await connection.socket.chatModify(
        {
          clear: true,
          lastMessages: [
            {
              key: {
                id: group.lastMessageId,
                remoteJid: jid,
                fromMe: false,
              },
              messageTimestamp: group.lastMessageTimestamp,
            },
          ],
        },
        jid,
      );

      this.logger.log(
        `Successfully cleared group chat ${groupId} in session ${sessionId}`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to clear group chat ${groupId}:`, err);
      throw err;
    }
  }

  async clearMultipleGroupChats(
    sessionId: string,
    groupIds: string[],
  ): Promise<{
    success: boolean;
    results: Array<{
      groupId: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    const results: Array<{
      groupId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const groupId of groupIds) {
      try {
        await this.clearGroupChat(sessionId, groupId);
        results.push({
          groupId,
          success: true,
        });

        // Add delay between operations to avoid rate limiting
        if (groupIds.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          groupId,
          success: false,
          error: errorMessage,
        });

        this.logger.error(
          `Failed to clear group chat ${groupId}: ${errorMessage}`,
        );
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      success: successCount > 0,
      results,
    };
  }
}
