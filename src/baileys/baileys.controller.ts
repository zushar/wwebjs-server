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

export class SendBulkMessagesDto {
  recipients: string[];
  content: string | object;
  type?: 'text' | 'image' | 'document' | 'video' | 'audio' | 'location';
}

import { BaileysService } from './baileys.services';

@Controller('whatsapp')
export class BaileysController {
  private readonly logger = new Logger(BaileysController.name);
  constructor(private readonly baileysService: BaileysService) {}

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
  @Get('snapshots')
  getChatSnapshot() {
    try {
      return this.baileysService.getChatStoreSnapshot();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get chat snapshot';
      throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
    }
  }
}
