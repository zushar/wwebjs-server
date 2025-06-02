// whatsapp-test.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ClientType } from 'src/wwebjs/client-meta.type';
import WAWebJS from 'whatsapp-web.js';
import { ConnectService } from './connect.service';
import { WwebjsServices } from './wwebjs.services';

// DTOs
class CreateConnectionDto {
  phoneNumber: string;
  clientType: ClientType;
}

class SendMessageDto {
  clientId: string;
  recipient: string;
  message: string;
}

class GetGroupsDto {
  clientId: string;
}

class SendMessageToGroupsDto {
  clientId: string;
  groupIds: string[];
  message: string;
}

class DeleteGroupsDto {
  clientId: string;
  groupIds: string[];
}

@Controller()
export class WhatsAppTestController {
  private readonly logger = new Logger(WhatsAppTestController.name);

  constructor(
    private readonly wwebjsServices: WwebjsServices,
    private readonly connectService: ConnectService,
  ) {}

  @Get('test')
  test(): string {
    return 'Test endpoint is working and returning a string';
  }

  @Get('status')
  getStatus(@Query('clientId') clientId: string): {
    clientId: string;
    status: string;
    ready: boolean;
  } {
    if (!clientId) {
      this.logger.error('clientId is required');
      throw new BadRequestException('clientId is required');
    }
    const statusResult = this.connectService.getClientStatus(clientId);
    this.logger.log(
      `Status for clientId ${clientId}: ${JSON.stringify(statusResult)}`,
    );
    return statusResult;
  }

  @Post('create')
  async createVerificationCode(
    @Body() dto: CreateConnectionDto,
  ): Promise<{ clientId: string; pairingCode?: string }> {
    if (
      !dto.clientType ||
      (dto.clientType !== 'delete-only' && dto.clientType !== 'full')
    ) {
      this.logger.error('Client type is required');
      throw new BadRequestException('Client type is required');
    }
    if (!dto.phoneNumber) {
      this.logger.error('Phone number is required');
      throw new BadRequestException('Phone number is required');
    }
    return await this.connectService.createVerificationCode(
      dto.phoneNumber,
      dto.clientType,
    );
  }

  @Post('message/send')
  async sendMessage(@Body() dto: SendMessageDto): Promise<WAWebJS.Message> {
    if (!dto.clientId || !dto.recipient || !dto.message) {
      this.logger.error('clientId, recipient, and message are required');
      throw new BadRequestException(
        'clientId, recipient, and message are required',
      );
    }
    return await this.wwebjsServices.sendMessage(
      dto.clientId,
      dto.recipient,
      dto.message,
    );
  }

  @Get('groups')
  async getGroups(
    @Query() query: GetGroupsDto,
  ): Promise<{ groups: { id: string; name: string }[] }> {
    this.logger.log(`Getting groups for clientId: ${query.clientId}`);
    if (!query.clientId) {
      this.logger.error('clientId is required');
      throw new BadRequestException('clientId is required');
    }
    return await this.wwebjsServices.getAllGroups(query.clientId);
  }

  @Get('groups/archived')
  async getArchivedGroups(
    @Query() query: GetGroupsDto,
  ): Promise<{ archivedGroups: { id: string; name: string }[] }> {
    this.logger.log(`Getting archived groups for clientId: ${query.clientId}`);
    if (!query.clientId) {
      this.logger.error('clientId is required');
      throw new BadRequestException('clientId is required');
    }
    return await this.wwebjsServices.getAllGroupsInArchive(query.clientId);
  }

  @Post('groups/archived/delete')
  async deleteAllMessagesFromArchivedGroups(
    @Query() query: GetGroupsDto,
  ): Promise<{ deletedFromGroups: string[] }> {
    this.logger.log(
      `Deleting all messages from archived groups for clientId: ${query.clientId}`,
    );
    if (!query.clientId) {
      this.logger.error('clientId is required');
      throw new BadRequestException('clientId is required');
    }
    return await this.wwebjsServices.deleteAllMessagesFromArchivedGroups(
      query.clientId,
    );
  }

  @Post('groups/delete')
  async deleteMessagesFromGroups(
    @Body() dto: DeleteGroupsDto,
  ): Promise<{ deletedFromGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Deleting messages from groups for clientId: ${dto.clientId}, groupIds: ${dto.groupIds.join(',')}`,
    );
    if (!dto.clientId || !dto.groupIds || !Array.isArray(dto.groupIds)) {
      this.logger.error('clientId and groupIds are required');
      throw new BadRequestException('clientId and groupIds are required');
    }
    return await this.wwebjsServices.deleteMessagesFromGroups(
      dto.clientId,
      dto.groupIds,
    );
  }

  @Post('groups/send')
  async sendMessageToGroups(
    @Body() dto: SendMessageToGroupsDto,
  ): Promise<{ sentToGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Sending message to groups for clientId: ${dto.clientId}, groupIds: ${dto.groupIds.join(',')}`,
    );
    if (!dto.clientId || !dto.groupIds || !dto.message) {
      this.logger.error('clientId, groupIds, and message are required');
      throw new BadRequestException(
        'clientId, groupIds, and message are required',
      );
    }
    return await this.wwebjsServices.sendMessageToGroups(
      dto.clientId,
      dto.groupIds,
      dto.message,
    );
  }

  @Delete('delete')
  deleteClient(@Query('clientId') clientId: string): { message: string } {
    this.logger.log(`Deleting client with clientId: ${clientId}`);
    if (!clientId) {
      this.logger.error('clientId is required');
      throw new BadRequestException('clientId is required');
    }
    this.wwebjsServices.deleteClient(clientId);
    return { message: 'Client deleted successfully' };
  }
}
