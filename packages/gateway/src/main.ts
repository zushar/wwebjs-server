import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const config = app.get(ConfigService);
  const port = config.get<number>('GATEWAY_PORT') || 3000;
  await app.listen(port);
  console.log(`Gateway listening on http://localhost:${port}`);
}
bootstrap();
