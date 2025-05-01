"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ClientFactoryService", {
    enumerable: true,
    get: function() {
        return ClientFactoryService;
    }
});
const _common = require("@nestjs/common");
const _whatsappweb = require("whatsapp-web.js");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let ClientFactoryService = class ClientFactoryService {
    /**
   * Creates a new WhatsApp Web.js client with consistent configuration
   * @param phoneNumber The phone number to associate with this client
   * @returns A configured Client instance
   */ createClient(phoneNumber) {
        this.logger.debug(`Creating WhatsApp client for: ${phoneNumber}`);
        const defaultOptions = {
            authStrategy: new _whatsappweb.LocalAuth({
                clientId: phoneNumber
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-features=site-per-process',
                    '--window-size=1920,1080',
                    '--js-flags="--max-old-space-size=128"'
                ]
            }
        };
        return new _whatsappweb.Client(defaultOptions);
    }
    constructor(){
        this.logger = new _common.Logger(ClientFactoryService.name);
    }
};
ClientFactoryService = _ts_decorate([
    (0, _common.Injectable)()
], ClientFactoryService);

//# sourceMappingURL=client-factory.service.js.map