// wwebjs.services.ts
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WwebjsServices", {
    enumerable: true,
    get: function() {
        return WwebjsServices;
    }
});
const _common = require("@nestjs/common");
const _ioredis = /*#__PURE__*/ _interop_require_default(require("ioredis"));
const _redismodule = require("../redis/redis.module");
const _connectservice = require("./connect.service");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let WwebjsServices = class WwebjsServices {
    /**
   * Retrieves a verified client from memory or Redis.
   * If the client is not verified, it throws a ForbiddenException.
   * If the client is not found in memory, it attempts to restore it from Redis.
   */ async getVerifiedClient(clientId) {
        let clientState = undefined;
        try {
            clientState = this.connectService.getClient(clientId);
        } catch (e) {
            this.logger.warn(`Client ${clientId} not found in memory. Attempting to restore from Redis...`);
        }
        if (!clientState) {
            // Not in memory, try to restore from Redis
            const isVerified = await this.connectService.isClientVerified(clientId);
            if (!isVerified) {
                const errorMsg = `Client for clientId ${clientId} is not verified in Redis. Please complete the pairing process.`;
                this.logger.error(errorMsg);
                throw new _common.ForbiddenException(errorMsg);
            }
            this.logger.log(`Re-initializing client ${clientId} from Redis...`);
            const redisClientMeta = await this.connectService.getClientMeta(clientId);
            if (!redisClientMeta) {
                const errorMsg = `Client ${clientId} not found in Redis.`;
                this.logger.error(errorMsg);
                throw new _common.ForbiddenException(errorMsg);
            }
            // Re-initialize the client (this should add it to memory)
            await this.connectService.createVerificationCode(clientId, redisClientMeta.type, redisClientMeta.verified);
            // Wait for the client to be ready in memory
            let retries = 10;
            while(retries-- > 0){
                try {
                    clientState = this.connectService.getClient(clientId);
                    if (clientState && clientState.ready && clientState.verified) {
                        break;
                    }
                } catch (e) {
                // Not ready yet
                }
                await new Promise((res)=>setTimeout(res, 1000)); // Wait 1 second
            }
            if (!clientState || !clientState.ready || !clientState.verified) {
                const errorMsg = `Failed to re-initialize client for clientId ${clientId} from Redis.`;
                this.logger.error(errorMsg);
                throw new _common.ForbiddenException(errorMsg);
            }
        } else {
            // If in memory, check verification
            if (!clientState.verified) {
                const errorMsg = `Client for clientId ${clientId} has not completed the verification step.`;
                this.logger.error(errorMsg);
                throw new _common.ForbiddenException(errorMsg);
            }
        }
        return clientState.client;
    }
    /**
   * Sends a message using the specified WhatsApp client.
   */ async sendMessage(clientId, recipient, message) {
        this.logger.log(`Attempting to send message from ${clientId} to ${recipient}`);
        const client = await this.getVerifiedClient(clientId);
        const formattedRecipient = recipient.includes('@') ? recipient : `${recipient}@c.us`;
        try {
            const msgResult = await client.sendMessage(formattedRecipient, message);
            this.logger.log(`Message sent successfully from ${clientId} to ${formattedRecipient}`);
            return msgResult;
        } catch (error) {
            this.logger.error(`Error sending message from ${clientId} to ${formattedRecipient}:`, error);
            throw new _common.InternalServerErrorException(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
   * Gets all group chats for the specified client.
   */ async getAllGroups(clientId) {
        this.logger.log(`Fetching all groups for clientId: ${clientId}`);
        const client = await this.getVerifiedClient(clientId);
        try {
            const allChats = await client.getChats();
            const groups = allChats.filter((chat)=>chat.isGroup).map((chat)=>({
                    id: chat.id._serialized,
                    name: chat.name
                }));
            this.logger.log(`Found ${groups.length} groups for clientId: ${clientId}`);
            return {
                groups
            };
        } catch (error) {
            this.logger.error(`Error fetching groups for ${clientId}:`, error);
            throw new _common.InternalServerErrorException(`Failed to fetch groups: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
   * Gets all archived group chats for the specified client.
   */ async getAllGroupsInArchive(clientId) {
        this.logger.log(`Fetching archived groups for clientId: ${clientId}`);
        const client = await this.getVerifiedClient(clientId);
        try {
            const allChats = await client.getChats();
            const archivedGroups = allChats.filter((chat)=>chat.isGroup && chat.archived).map((chat)=>({
                    id: chat.id._serialized,
                    name: chat.name
                }));
            this.logger.log(`Found ${archivedGroups.length} archived groups for clientId: ${clientId}`);
            return {
                archivedGroups
            };
        } catch (error) {
            this.logger.error(`Error fetching archived groups for ${clientId}:`, error);
            throw new _common.InternalServerErrorException(`Failed to fetch archived groups: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
   * Deletes all messages from all archived groups.
   */ async deleteAllMessagesFromArchivedGroups(clientId) {
        this.logger.log(`Deleting all messages from archived groups for clientId: ${clientId}`);
        const client = await this.getVerifiedClient(clientId);
        try {
            const allChats = await client.getChats();
            const archivedGroups = allChats.filter((chat)=>chat.isGroup && chat.archived);
            const deletedFromGroups = [];
            for (const group of archivedGroups){
                try {
                    await group.clearMessages();
                    deletedFromGroups.push(group.id._serialized);
                    this.logger.log(`Cleared messages from archived group ${group.id._serialized}`);
                } catch (err) {
                    this.logger.error(`Failed to clear messages from archived group ${group.id._serialized}:`, err);
                }
            }
            return {
                deletedFromGroups
            };
        } catch (error) {
            this.logger.error(`Error deleting messages from archived groups for ${clientId}:`, error);
            throw new _common.InternalServerErrorException(`Failed to delete messages from archived groups: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
   * Deletes all messages from specific groups.
   */ async deleteMessagesFromGroups(clientId, groupIds) {
        this.logger.log(`Deleting messages from specific groups for clientId: ${clientId}`);
        const client = await this.getVerifiedClient(clientId);
        const deletedFromGroups = [];
        const invalidGroupIds = [];
        for (const groupId of groupIds){
            try {
                const chat = await client.getChatById(groupId);
                if (!chat || !chat.isGroup) {
                    this.logger.warn(`Group ID ${groupId} is invalid or not a group for clientId: ${clientId}`);
                    invalidGroupIds.push(groupId);
                    continue;
                }
                await chat.clearMessages();
                deletedFromGroups.push(groupId);
                this.logger.log(`Cleared messages from group ${groupId} for clientId: ${clientId}`);
            } catch (error) {
                this.logger.error(`Error clearing messages from group ${groupId} for clientId: ${clientId}:`, error);
                invalidGroupIds.push(groupId);
            }
        }
        return {
            deletedFromGroups,
            invalidGroupIds
        };
    }
    /**
   * Sends a message to specific groups.
   */ async sendMessageToGroups(clientId, groupIds, message) {
        this.logger.log(`Sending message to specific groups for clientId: ${clientId}`);
        const client = await this.getVerifiedClient(clientId);
        const sentToGroups = [];
        const invalidGroupIds = [];
        for (const groupId of groupIds){
            try {
                const chat = await client.getChatById(groupId);
                if (!chat || !chat.isGroup) {
                    this.logger.warn(`Group ID ${groupId} is invalid or not a group for clientId: ${clientId}`);
                    invalidGroupIds.push(groupId);
                    continue;
                }
                await client.sendMessage(groupId, message);
                sentToGroups.push(groupId);
                this.logger.log(`Sent message to group ${groupId} for clientId: ${clientId}`);
            } catch (error) {
                this.logger.error(`Error sending message to group ${groupId} for clientId: ${clientId}:`, error);
                invalidGroupIds.push(groupId);
            }
        }
        return {
            sentToGroups,
            invalidGroupIds
        };
    }
    constructor(redisClient, connectService){
        this.redisClient = redisClient;
        this.connectService = connectService;
        this.logger = new _common.Logger(WwebjsServices.name);
    }
};
WwebjsServices = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_param(0, (0, _common.Inject)(_redismodule.REDIS_CLIENT)),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _ioredis.default === "undefined" ? Object : _ioredis.default,
        typeof _connectservice.ConnectService === "undefined" ? Object : _connectservice.ConnectService
    ])
], WwebjsServices);

//# sourceMappingURL=wwebjs.services.js.map