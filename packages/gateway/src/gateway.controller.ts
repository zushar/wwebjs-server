import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConnectDto, DeleteMessagesDto, DisconnectDto, GetAllGroupsDto, SendMessageDto, SendMessageGroupsDto, ShardServiceClient, VerifyConnectionDto } from '@whatsapp-cluster/shared-lib';
import { lastValueFrom } from 'rxjs';

@Controller()
export class GatewayController {
  private shardClient: ShardServiceClient;
  constructor(@Inject('SHARD_SERVICE') private client: ClientGrpc) {
    this.shardClient =
      this.client.getService<ShardServiceClient>('ShardService');
  }

  @Post('connect')
  async connect(@Body() dto: ConnectDto) {
    return lastValueFrom(this.shardClient.Connect(dto));
  }

  @Post('verify')
  async verify(@Body() dto: VerifyConnectionDto) {
    return lastValueFrom(this.shardClient.VerifyConnection(dto));
  }

  @Post('message/send')
  async sendMessage(@Body() dto: SendMessageDto) {
    return lastValueFrom(this.shardClient.SendMessage(dto));
  }

  @Get('groups')
  async getAllGroups(@Query() query: GetAllGroupsDto) {
    return lastValueFrom(this.shardClient.GetAllGroups(query));
  }

  @Get('groups/archived')
  async getAllArchived(@Query() query: GetAllGroupsDto) {
    return lastValueFrom(this.shardClient.GetAllArchivedGroups(query));
  }

  @Post('groups/delete')
  async deleteFromGroups(@Body() dto: DeleteMessagesDto) {
    return lastValueFrom(this.shardClient.DeleteMessagesFromGroups(dto));
  }

  @Post('groups/archived/delete')
  async deleteArchived(@Body() dto: GetAllGroupsDto) {
    return lastValueFrom(
      this.shardClient.DeleteAllMessagesFromArchivedGroups(dto),
    );
  }

  @Post('groups/send')
  async sendToGroups(@Body() dto: SendMessageGroupsDto) {
    return lastValueFrom(this.shardClient.SendMessageToGroups(dto));
  }

  @Post('disconnect')
  async disconnect(@Body() dto: DisconnectDto) {
    return lastValueFrom(this.shardClient.Disconnect(dto));
  }

  @Get('health')
  async health() {
    return lastValueFrom(this.shardClient.HealthCheck({}));
  }
}
