//main.ts
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _core = require("@nestjs/core");
const _appmodule = require("./app.module");
async function bootstrap() {
    const app = await _core.NestFactory.create(_appmodule.AppModule);
    await app.listen(process.env.PORT ?? 3000);
    console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();

//# sourceMappingURL=main.js.map