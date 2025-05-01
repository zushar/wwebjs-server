//wwebjs.module.ts
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WwebjsModule", {
    enumerable: true,
    get: function() {
        return WwebjsModule;
    }
});
const _common = require("@nestjs/common");
const _whatsapptestcontroller = require("./whatsapp-test.controller");
const _wwebjsservices = require("./wwebjs.services");
const _connectservice = require("./connect.service");
const _clientfactoryservice = require("./client-factory.service");
const _redismodule = require("../redis/redis.module");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let WwebjsModule = class WwebjsModule {
};
WwebjsModule = _ts_decorate([
    (0, _common.Module)({
        imports: [
            _redismodule.RedisModule
        ],
        controllers: [
            _whatsapptestcontroller.WhatsAppTestController
        ],
        providers: [
            _wwebjsservices.WwebjsServices,
            _connectservice.ConnectService,
            _clientfactoryservice.ClientFactoryService
        ]
    })
], WwebjsModule);

//# sourceMappingURL=wwebjs.module.js.map