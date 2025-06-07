import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';

// DTOs for request validation
export class CreateConnectionDto {
  phoneNumber: string;
}

export class SendMessageDto {
  to: string;
  content: string | object;
  type?: 'text' | 'image' | 'document' | 'video' | 'audio' | 'location';
}
export class SendGroupMessageDto {
  groupIds: string[];
  message: string;
}
export class SendBulkMessagesDto {
  recipients: string[];
  content: string | object;
  type?: 'text' | 'image' | 'document' | 'video' | 'audio' | 'location';
}
export class DeleteGroupMessagesDto {
  clientId: string;
  groupIds: string[];
}

import { BaileysService } from './baileys.services';
import { GroupService } from './group.service';

@Controller('whatsapp')
export class BaileysController {
  private readonly logger = new Logger(BaileysController.name);
  constructor(
    private readonly baileysService: BaileysService,
    private readonly groupService: GroupService,
  ) {}

  @Post('sessions/:sessionId')
  async createConnection(
    @Param('sessionId') sessionId: string,
    @Body() createConnectionDto: CreateConnectionDto,
  ) {
    try {
      return await this.baileysService.createConnection(
        sessionId,
        createConnectionDto.phoneNumber,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create connection';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('sessions/:sessionId/pairing-code')
  getPairingCode(@Param('sessionId') sessionId: string) {
    try {
      return this.baileysService.getPairingCode(sessionId);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get pairing code';
      throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
    }
  }

  @Get('sessions/:sessionId/status')
  getConnectionStatus(@Param('sessionId') sessionId: string) {
    try {
      return this.baileysService.getConnectionStatus(sessionId);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to get connection status';
      throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
    }
  }

  @Get('sessions')
  getActiveSessions() {
    return this.baileysService.getActiveSessions();
  }

  @Delete('sessions/:sessionId')
  async closeConnection(@Param('sessionId') sessionId: string) {
    try {
      return await this.baileysService.closeConnection(sessionId);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to close connection';
      throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
    }
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    try {
      return await this.baileysService.sendMessage(
        sessionId,
        sendMessageDto.to,
        sendMessageDto.content,
        sendMessageDto.type || 'text',
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send message';
      throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('sessions/:sessionId/bulk-messages')
  async sendBulkMessages(
    @Param('sessionId') sessionId: string,
    @Body() sendBulkMessagesDto: SendBulkMessagesDto,
  ) {
    try {
      return await this.baileysService.sendBulkMessages(
        sessionId,
        sendBulkMessagesDto.recipients,
        sendBulkMessagesDto.content,
        sendBulkMessagesDto.type || 'text',
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send bulk messages';
      throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
    }
  }
  // New group-related endpoints
  @Get('groups')
  async getAllGroups(@Query('clientId') clientId?: string) {
    try {
      if (!clientId) {
        throw new HttpException(
          'clientId query parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const [groups, count] = await this.groupService.getGroups(clientId, {
        archived: false,
      });

      return {
        success: true,
        data: groups,
        count,
        message: `Retrieved ${count} groups for client ${clientId}`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve groups';
      this.logger.error(`Error retrieving groups: ${errorMessage}`);
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('groups/archived')
  async getArchivedGroups(@Query('clientId') clientId?: string) {
    try {
      if (!clientId) {
        throw new HttpException(
          'clientId query parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const [archivedGroups, count] = await this.groupService.getGroups(
        clientId,
        {
          archived: true,
        },
      );

      return {
        success: true,
        data: archivedGroups,
        count,
        message: `Retrieved ${count} archived groups for client ${clientId}`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to retrieve archived groups';
      this.logger.error(`Error retrieving archived groups: ${errorMessage}`);
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('sessions/:sessionId/groups')
  async getSessionGroups(@Param('sessionId') sessionId: string) {
    try {
      const [groups, count] = await this.groupService.getGroups(sessionId, {
        archived: false,
      });

      return {
        success: true,
        data: groups,
        count,
        sessionId,
        message: `Retrieved ${count} groups for session ${sessionId}`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve groups';
      this.logger.error(
        `Error retrieving groups for session ${sessionId}: ${errorMessage}`,
      );
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('sessions/:sessionId/groups/archived')
  async getSessionArchivedGroups(@Param('sessionId') sessionId: string) {
    try {
      const [archivedGroups, count] = await this.groupService.getGroups(
        sessionId,
        {
          archived: true,
        },
      );

      return {
        success: true,
        data: archivedGroups,
        count,
        sessionId,
        message: `Retrieved ${count} archived groups for session ${sessionId}`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to retrieve archived groups';
      this.logger.error(
        `Error retrieving archived groups for session ${sessionId}: ${errorMessage}`,
      );
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('sessions/:sessionId/groups/:groupId')
  async getGroupById(
    @Param('sessionId') sessionId: string,
    @Param('groupId') groupId: string,
  ) {
    try {
      const group = await this.groupService.getChatByJid(sessionId, groupId);

      if (!group) {
        throw new HttpException(
          `Group with ID ${groupId} not found in session ${sessionId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: group,
        sessionId,
        groupId,
        message: `Retrieved group ${groupId} for session ${sessionId}`,
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve group';
      this.logger.error(
        `Error retrieving group ${groupId} for session ${sessionId}: ${errorMessage}`,
      );
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  @Post('sessions/:sessionId/groups/messages')
  async sendGroupMessage(
    @Param('sessionId') sessionId: string,
    @Body() sendGroupMessageDto: SendGroupMessageDto,
  ) {
    try {
      if (
        !sendGroupMessageDto.groupIds ||
        sendGroupMessageDto.groupIds.length === 0
      ) {
        throw new HttpException(
          'At least one group ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (
        !sendGroupMessageDto.message ||
        sendGroupMessageDto.message.trim() === ''
      ) {
        throw new HttpException(
          'Message content is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Send messages to all groups using the new method
      const results = await this.baileysService.sendGroupMessages(
        sessionId,
        sendGroupMessageDto.groupIds,
        sendGroupMessageDto.message,
      );

      const successCount = results.results.filter((r) => r.success).length;
      const failureCount = results.results.filter((r) => !r.success).length;

      return {
        success: results.success,
        sessionId,
        groupCount: sendGroupMessageDto.groupIds.length,
        successCount,
        failureCount,
        groupIds: sendGroupMessageDto.groupIds,
        message: sendGroupMessageDto.message,
        results: results.results,
        timestamp: new Date().toISOString(),
        summary: `Message sent to ${successCount}/${sendGroupMessageDto.groupIds.length} groups successfully`,
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to send group messages';
      this.logger.error(
        `Error sending messages to groups for session ${sessionId}: ${errorMessage}`,
      );
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('delete/archive/all')
  async deleteAllArchivedGroupMessages(@Query('clientId') clientId?: string) {
    try {
      if (!clientId) {
        throw new HttpException(
          'clientId query parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const results =
        await this.baileysService.clearMultipleGroupChats(clientId);

      return {
        success: results,
        clientId,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to delete archived group messages';
      this.logger.error(
        `Error deleting archived group messages for client ${clientId}: ${errorMessage}`,
      );
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('delete/group')
  async deleteGroupMessages(
    @Body() deleteGroupMessagesDto: DeleteGroupMessagesDto,
  ) {
    try {
      const clientId = deleteGroupMessagesDto.clientId;
      const groupIds = deleteGroupMessagesDto.groupIds;
      if (!clientId) {
        throw new HttpException('clientId is required', HttpStatus.BAD_REQUEST);
      }

      if (
        !deleteGroupMessagesDto.groupIds ||
        deleteGroupMessagesDto.groupIds.length === 0
      ) {
        throw new HttpException(
          'At least one group ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const results = await this.baileysService.clearMultipleGroupChats(
        clientId,
        groupIds,
      );

      return {
        success: results,
        clientId,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to delete archived group messages';
      this.logger.error(
        `Error deleting archived group messages for client ${deleteGroupMessagesDto.clientId}: ${errorMessage}`,
      );
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
