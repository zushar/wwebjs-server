//whatsapp-test.controller.ts
import { Body, Controller, Logger, Post } from '@nestjs/common';
import { WwebjsServices } from './wwebjs.services';
import { ConnectService } from './connect.service';

class CreateConnectionDto {
  phoneNumber: string;
}

class VerifyCodeDto {
  clientId: string;
  code: string;
}

class SendMessageDto {
  clientId: string;
  recipient: string;
  message: string;
}
class getArchivedGroupsDto {
  clientId: string;
}

@Controller('api/whatsapp-test')
export class WhatsAppTestController {
  private readonly logger = new Logger(WhatsAppTestController.name);

  constructor(
    private readonly wwebjsServices: WwebjsServices,
    private readonly connectService: ConnectService,
  ) {}

  @Post('create-code')
  async createVerificationCode(
    @Body() dto: CreateConnectionDto,
  ): Promise<{ clientId: string; pairingCode?: string }> {
    this.logger.log(
      `Creating verification code for phoneNumber: ${dto.phoneNumber}`,
    );
    return await this.connectService.createVerificationCode(dto.phoneNumber);
  }

  @Post('verify-code')
  async verifyCode(@Body() dto: VerifyCodeDto): Promise<{ message: string }> {
    this.logger.log(`Verifying code for clientId: ${dto.clientId}`);
    return await this.connectService.verifyCode(dto.clientId);
  }

  @Post('send-message')
  async sendMessage(@Body() dto: SendMessageDto): Promise<unknown> {
    this.logger.log(
      `Sending message from clientId: ${dto.clientId} to recipient: ${dto.recipient}`,
    );
    return await this.wwebjsServices.sendMessage(
      dto.clientId,
      dto.recipient,
      dto.message,
    );
  }
  @Post('get-archived-groups')
  async getArchivedGroups(@Body() dto: getArchivedGroupsDto): Promise<unknown> {
    this.logger.log(`Getting archived groups for clientId: ${dto.clientId}`);
    return await this.wwebjsServices.getAllGroupsInArchive(dto.clientId);
  }
  @Post('send-message-to-group')
  async sendMessageToGroup(
    @Body() dto: { clientId: string; groupId: string; message: string },
  ): Promise<unknown> {
    this.logger.log(
      `Sending message from clientId: ${dto.clientId} to groupId: ${dto.groupId}`,
    );
    return await this.wwebjsServices.sendMessageToGroup(
      dto.clientId,
      dto.groupId,
      dto.message,
    );
  }
  @Post('clear-group-chat')
  async clearGroupChat(
    @Body() dto: { clientId: string; groupId: string },
  ): Promise<unknown> {
    this.logger.log(
      `Clearing group chat from clientId: ${dto.clientId} to groupId: ${dto.groupId}`,
    );
    return await this.wwebjsServices.clearGroupChat(dto.clientId, dto.groupId);
  }
}
