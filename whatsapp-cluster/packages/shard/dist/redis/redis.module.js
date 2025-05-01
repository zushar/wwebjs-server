// src/redis/redis.module.ts
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    REDIS_CLIENT: function() {
        return REDIS_CLIENT;
    },
    RedisModule: function() {
        return RedisModule;
    }
});
const _common = require("@nestjs/common");
const _config = require("@nestjs/config");
const _ioredis = /*#__PURE__*/ _interop_require_default(require("ioredis"));
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
const REDIS_CLIENT = 'REDIS_CLIENT';
let RedisModule = class RedisModule {
};
RedisModule = _ts_decorate([
    (0, _common.Global)(),
    (0, _common.Module)({
        providers: [
            {
                provide: REDIS_CLIENT,
                useFactory: (configService)=>{
                    return new _ioredis.default({
                        host: configService.get('REDIS_HOST', 'localhost'),
                        port: configService.get('REDIS_PORT', 6379)
                    });
                },
                inject: [
                    _config.ConfigService
                ]
            }
        ],
        exports: [
            REDIS_CLIENT
        ]
    })
], RedisModule);

//# sourceMappingURL=redis.module.js.map