// whatsapp-test.controller.ts
import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Delete,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ClientType } from 'src/wwebjs/client-meta.type';
import { ConnectService } from './connect.service';
import { WwebjsServices } from './wwebjs.services';

// DTOs
class CreateConnectionDto {
  phoneNumber: string;
  clientType: ClientType;
}

class VerifyCodeDto {
  clientId: string;
  code?: string;
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

@Controller('api/whatsapp-test')
export class WhatsAppTestController {
  private readonly logger = new Logger(WhatsAppTestController.name);

  constructor(
    private readonly wwebjsServices: WwebjsServices,
    private readonly connectService: ConnectService,
  ) {}

  @Get('test')
  test(): string {
    this.logger.log('Test endpoint hit');
    return 'Test endpoint is working';
  }

  @Post('create-code')
  async createVerificationCode(
    @Body() dto: CreateConnectionDto,
  ): Promise<{ clientId: string; pairingCode?: string }> {
    this.logger.log(
      `Creating verification code for phoneNumber: ${dto.phoneNumber}`,
    );
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

  @Post('verify-code')
  async verifyCode(@Body() dto: VerifyCodeDto): Promise<{ message: string }> {
    this.logger.log(`Verifying code for clientId: ${dto.clientId}`);
    if (!dto.clientId) {
      this.logger.error('clientId is required');
      throw new BadRequestException('clientId is required');
    }
    return await this.connectService.verifyCode(dto.clientId);
  }

  @Post('send-message')
  async sendMessage(@Body() dto: SendMessageDto): Promise<unknown> {
    this.logger.log(
      `Sending message from clientId: ${dto.clientId} to recipient: ${dto.recipient}`,
    );
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
async getGroups(@Query() query: GetGroupsDto): Promise<{ groups: { id: string; name: string }[] }> {
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

  @Delete('delete/archive/all')
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

  @Delete('delete/group')
  async deleteMessagesFromGroups(
    @Body() dto: DeleteGroupsDto,
  ): Promise<{ deletedFromGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Deleting messages from groups for clientId: ${dto.clientId}, groupIds: ${dto.groupIds}`,
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

  @Post('send/group')
  async sendMessageToGroups(
    @Body() dto: SendMessageToGroupsDto,
  ): Promise<{ sentToGroups: string[]; invalidGroupIds: string[] }> {
    this.logger.log(
      `Sending message to groups for clientId: ${dto.clientId}, groupIds: ${dto.groupIds}`,
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
}
