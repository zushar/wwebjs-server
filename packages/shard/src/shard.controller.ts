// packages/shard/src/shard.controller.ts (New )
import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  ActionConfirmationResponse,
  ClientIdRequest,
  ClientType,
  ConnectRequest,
  ConnectResponse,
  DeleteMessagesFromGroupsRequest,
  DisconnectRequest,
  DisconnectResponse,
  GetAllGroupsRequest,
  GetAllGroupsResponse,
  HealthCheckRequest,
  HealthCheckResponse,
  SendMessageRequest,
  SendMessageResponse,
  SendMessageToGroupsRequest,
  VerifyConnectionRequest,
  VerifyConnectionResponse,
} from '@whatsapp-cluster/shared-lib';
import { ConnectService } from './wwebjs/connect.service';
import { WwebjsServices } from './wwebjs/wwebjs.services';

@Controller() 
export class ShardController {
  private readonly logger = new Logger(ShardController.name);

  constructor(
    private readonly connectService: ConnectService,
    private readonly wwebjsServices: WwebjsServices,
  ) {}

  @GrpcMethod('ShardService', 'Connect')
  async connect(request: ConnectRequest): Promise<ConnectResponse> {
    this.logger.log(
      `gRPC Connect request received for: ${request.phoneNumber}`,
    );
    try {
      const result = await this.connectService.createVerificationCode(
        request.phoneNumber,
        request.clientType as ClientType, 
      );

      return {
        clientId: result.clientId,
        pairingCode: result.pairingCode,
        message: result.message || 'Connection process initiated.',
        needsPairing: !!result.pairingCode,
      };
    } catch (error: any) {
      this.logger.error(
        `gRPC Connect failed for ${request.phoneNumber}: ${error.message}`,
        error.stack,
      );
      return {
        clientId: request.phoneNumber,
        message: `Failed to connect: ${error.message}`,
        needsPairing: false, // Indicate failure
      };
    }
  }

  @GrpcMethod('ShardService', 'VerifyConnection')
  async verifyConnection(
      request: VerifyConnectionRequest,
  ): Promise<VerifyConnectionResponse> {
      this.logger.log(
      `gRPC VerifyConnection request received for: ${request.clientId}`,
      );
      try {
          // Rely on connectService.verifyCode to check/update state
           const result = await this.connectService.verifyCode(request.clientId);
           return { success: result.success, message: result.message };

      } catch (error: any) {
          this.logger.error(
              `gRPC VerifyConnection failed for ${request.clientId}: ${error.message}`,
              error.stack,
          );
          return {
              success: false,
              message: `Verification failed: ${error.message}`,
          };
      }
  }

  @GrpcMethod('ShardService', 'SendMessage')
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    this.logger.log(
      `gRPC SendMessage request for clientId: ${request.clientId}`,
    );
    try {
      const result: any = await this.wwebjsServices.sendMessage(
        request.clientId,
        request.recipientId,
        request.message,
      );
      return { success: true, messageId: result.id?.id || 'N/A', error: '' };
    } catch (error: any) {
      this.logger.error(
        `gRPC SendMessage failed for ${request.clientId}: ${error.message}`,
        error.stack,
      );
      return { success: false, messageId: '', error: error.message };
    }
  }

  @GrpcMethod('ShardService', 'GetAllGroups')
  async getAllGroups(
    request: GetAllGroupsRequest,
  ): Promise<GetAllGroupsResponse> {
    this.logger.log(
      `gRPC GetAllGroups request for clientId: ${request.clientId}`,
    );
    try {
      const result = await this.wwebjsServices.getAllGroups(request.clientId);
      return { groups: result.groups };
    } catch (error: any) {
      this.logger.error(
        `gRPC GetAllGroups failed for ${request.clientId}: ${error.message}`,
        error.stack,
      );
      return { groups: [] }; // Return empty on error
    }
  }

  @GrpcMethod('ShardService', 'GetAllArchivedGroups')
  async getAllArchivedGroups(
    request: GetAllGroupsRequest,
  ): Promise<GetAllGroupsResponse> {
    this.logger.log(
      `gRPC GetAllArchivedGroups request for clientId: ${request.clientId}`,
    );
    try {
      const result = await this.wwebjsServices.getAllGroupsInArchive(
        request.clientId,
      );
      // Ensure the response matches the proto definition (might need renaming)
      return { groups: result.archivedGroups };
    } catch (error: any) {
      this.logger.error(
        `gRPC GetAllArchivedGroups failed for ${request.clientId}: ${error.message}`,
        error.stack,
      );
      return { groups: [] }; // Return empty on error
    }
  }

  @GrpcMethod('ShardService', 'DeleteMessagesFromGroups')
  async deleteMessagesFromGroups(
    request: DeleteMessagesFromGroupsRequest,
  ): Promise<ActionConfirmationResponse> {
    this.logger.log(
      `gRPC DeleteMessagesFromGroups request for clientId: ${request.clientId}`,
    );
    try {
      const result = await this.wwebjsServices.deleteMessagesFromGroups(
        request.clientId,
        request.groupIds,
      );
      return {
        successfulIds: result.deletedFromGroups,
        failedIds: result.invalidGroupIds,
        message: 'Deletion attempted.',
      };
    } catch (error: any) {
      this.logger.error(
        `gRPC DeleteMessagesFromGroups failed for ${request.clientId}: ${error.message}`,
        error.stack,
      );
      return {
        successfulIds: [],
        failedIds: request.groupIds,
        message: `Error: ${error.message}`,
      };
    }
  }

  @GrpcMethod('ShardService', 'DeleteAllMessagesFromArchivedGroups')
  async deleteAllMessagesFromArchivedGroups(
    request: ClientIdRequest,
  ): Promise<ActionConfirmationResponse> {
    this.logger.log(
      `gRPC DeleteAllMessagesFromArchivedGroups request for clientId: ${request.clientId}`,
    );
    try {
      const result =
        await this.wwebjsServices.deleteAllMessagesFromArchivedGroups(
          request.clientId,
        );
      return {
        successfulIds: result.deletedFromGroups,
        failedIds: [],
        message: 'Deletion from archived groups attempted.',
      };
    } catch (error: any) {
      this.logger.error(
        `gRPC DeleteAllMessagesFromArchivedGroups failed for ${request.clientId}: ${error.message}`,
        error.stack,
      );
      return {
        successfulIds: [],
        failedIds: [],
        message: `Error: ${error.message}`,
      };
    }
  }

  @GrpcMethod('ShardService', 'SendMessageToGroups')
  async sendMessageToGroups(
    request: SendMessageToGroupsRequest,
  ): Promise<ActionConfirmationResponse> {
    this.logger.log(
      `gRPC SendMessageToGroups request for clientId: ${request.clientId}`,
    );
    try {
      const result = await this.wwebjsServices.sendMessageToGroups(
        request.clientId,
        request.groupIds,
        request.message,
      );
      return {
        successfulIds: result.sentToGroups,
        failedIds: result.invalidGroupIds,
        message: 'Sending message to groups attempted.',
      };
    } catch (error: any) {
      this.logger.error(
        `gRPC SendMessageToGroups failed for ${request.clientId}: ${error.message}`,
        error.stack,
      );
      return {
        successfulIds: [],
        failedIds: request.groupIds,
        message: `Error: ${error.message}`,
      };
    }
  }

  @GrpcMethod('ShardService', 'Disconnect')
  async disconnect(request: DisconnectRequest): Promise<DisconnectResponse> {
    this.logger.log(
      `gRPC Disconnect request for clientId: ${request.clientId}`,
    );
    return this.connectService.disconnectClient(request.clientId);
  }

  @GrpcMethod('ShardService', 'HealthCheck')
  async healthCheck(
      _request: HealthCheckRequest,
  ): Promise<HealthCheckResponse> {
      this.logger.debug('gRPC HealthCheck request received');
      // Basic check: service is running and can respond
      // More checks could be added (e.g., Redis ping, avg clients per proxy)
       try {
          // Example: Check proxy manager state (optional)
          // const counts = this.proxyManager.getUsageCounts();
          // this.logger.debug(`Proxy Usage: ${JSON.stringify(Array.from(counts.entries()))}`);
           return { status: 1 }; // 1 = SERVING
       } catch (error) {
            this.logger.error(`Health check failed: ${error.message}`);
            return { status: 2 }; // 2 = NOT_SERVING or other appropriate status
       }
  }
}
