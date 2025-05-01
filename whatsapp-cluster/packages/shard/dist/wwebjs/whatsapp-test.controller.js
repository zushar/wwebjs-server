// whatsapp-test.controller.ts
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WhatsAppTestController", {
    enumerable: true,
    get: function() {
        return WhatsAppTestController;
    }
});
const _common = require("@nestjs/common");
const _connectservice = require("./connect.service");
const _wwebjsservices = require("./wwebjs.services");
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
// DTOs
let CreateConnectionDto = class CreateConnectionDto {
};
let VerifyCodeDto = class VerifyCodeDto {
};
let SendMessageDto = class SendMessageDto {
};
let GetGroupsDto = class GetGroupsDto {
};
let SendMessageToGroupsDto = class SendMessageToGroupsDto {
};
let DeleteGroupsDto = class DeleteGroupsDto {
};
let WhatsAppTestController = class WhatsAppTestController {
    test() {
        this.logger.log('Test endpoint hit');
        return 'Test endpoint is working';
    }
    async createVerificationCode(dto) {
        this.logger.log(`Creating verification code for phoneNumber: ${dto.phoneNumber}`);
        if (!dto.clientType || dto.clientType !== 'delete-only' && dto.clientType !== 'full') {
            this.logger.error('Client type is required');
            throw new _common.BadRequestException('Client type is required');
        }
        if (!dto.phoneNumber) {
            this.logger.error('Phone number is required');
            throw new _common.BadRequestException('Phone number is required');
        }
        return await this.connectService.createVerificationCode(dto.phoneNumber, dto.clientType);
    }
    async verifyCode(dto) {
        this.logger.log(`Verifying code for clientId: ${dto.clientId}`);
        if (!dto.clientId) {
            this.logger.error('clientId is required');
            throw new _common.BadRequestException('clientId is required');
        }
        return await this.connectService.verifyCode(dto.clientId);
    }
    async sendMessage(dto) {
        this.logger.log(`Sending message from clientId: ${dto.clientId} to recipient: ${dto.recipient}`);
        if (!dto.clientId || !dto.recipient || !dto.message) {
            this.logger.error('clientId, recipient, and message are required');
            throw new _common.BadRequestException('clientId, recipient, and message are required');
        }
        return await this.wwebjsServices.sendMessage(dto.clientId, dto.recipient, dto.message);
    }
    async getGroups(query) {
        this.logger.log(`Getting groups for clientId: ${query.clientId}`);
        if (!query.clientId) {
            this.logger.error('clientId is required');
            throw new _common.BadRequestException('clientId is required');
        }
        return await this.wwebjsServices.getAllGroups(query.clientId);
    }
    async getArchivedGroups(query) {
        this.logger.log(`Getting archived groups for clientId: ${query.clientId}`);
        if (!query.clientId) {
            this.logger.error('clientId is required');
            throw new _common.BadRequestException('clientId is required');
        }
        return await this.wwebjsServices.getAllGroupsInArchive(query.clientId);
    }
    async deleteAllMessagesFromArchivedGroups(query) {
        this.logger.log(`Deleting all messages from archived groups for clientId: ${query.clientId}`);
        if (!query.clientId) {
            this.logger.error('clientId is required');
            throw new _common.BadRequestException('clientId is required');
        }
        return await this.wwebjsServices.deleteAllMessagesFromArchivedGroups(query.clientId);
    }
    async deleteMessagesFromGroups(dto) {
        this.logger.log(`Deleting messages from groups for clientId: ${dto.clientId}, groupIds: ${dto.groupIds}`);
        if (!dto.clientId || !dto.groupIds || !Array.isArray(dto.groupIds)) {
            this.logger.error('clientId and groupIds are required');
            throw new _common.BadRequestException('clientId and groupIds are required');
        }
        return await this.wwebjsServices.deleteMessagesFromGroups(dto.clientId, dto.groupIds);
    }
    async sendMessageToGroups(dto) {
        this.logger.log(`Sending message to groups for clientId: ${dto.clientId}, groupIds: ${dto.groupIds}`);
        if (!dto.clientId || !dto.groupIds || !dto.message) {
            this.logger.error('clientId, groupIds, and message are required');
            throw new _common.BadRequestException('clientId, groupIds, and message are required');
        }
        return await this.wwebjsServices.sendMessageToGroups(dto.clientId, dto.groupIds, dto.message);
    }
    constructor(wwebjsServices, connectService){
        this.wwebjsServices = wwebjsServices;
        this.connectService = connectService;
        this.logger = new _common.Logger(WhatsAppTestController.name);
    }
};
_ts_decorate([
    (0, _common.Get)('test'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", String)
], WhatsAppTestController.prototype, "test", null);
_ts_decorate([
    (0, _common.Post)('create-code'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof CreateConnectionDto === "undefined" ? Object : CreateConnectionDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "createVerificationCode", null);
_ts_decorate([
    (0, _common.Post)('verify-code'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof VerifyCodeDto === "undefined" ? Object : VerifyCodeDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "verifyCode", null);
_ts_decorate([
    (0, _common.Post)('send-message'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof SendMessageDto === "undefined" ? Object : SendMessageDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "sendMessage", null);
_ts_decorate([
    (0, _common.Get)('groups'),
    _ts_param(0, (0, _common.Query)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof GetGroupsDto === "undefined" ? Object : GetGroupsDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "getGroups", null);
_ts_decorate([
    (0, _common.Get)('groups/archived'),
    _ts_param(0, (0, _common.Query)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof GetGroupsDto === "undefined" ? Object : GetGroupsDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "getArchivedGroups", null);
_ts_decorate([
    (0, _common.Delete)('delete/archive/all'),
    _ts_param(0, (0, _common.Query)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof GetGroupsDto === "undefined" ? Object : GetGroupsDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "deleteAllMessagesFromArchivedGroups", null);
_ts_decorate([
    (0, _common.Delete)('delete/group'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof DeleteGroupsDto === "undefined" ? Object : DeleteGroupsDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "deleteMessagesFromGroups", null);
_ts_decorate([
    (0, _common.Post)('send/group'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof SendMessageToGroupsDto === "undefined" ? Object : SendMessageToGroupsDto
    ]),
    _ts_metadata("design:returntype", Promise)
], WhatsAppTestController.prototype, "sendMessageToGroups", null);
WhatsAppTestController = _ts_decorate([
    (0, _common.Controller)('api/whatsapp-test'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _wwebjsservices.WwebjsServices === "undefined" ? Object : _wwebjsservices.WwebjsServices,
        typeof _connectservice.ConnectService === "undefined" ? Object : _connectservice.ConnectService
    ])
], WhatsAppTestController);

//# sourceMappingURL=whatsapp-test.controller.js.map