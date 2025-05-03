// packages/shard/src/proxy/proxy.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyManagerService } from './proxy-manager.service';

@Global() // Make the service available globally without importing the module everywhere
@Module({
  imports: [ConfigModule], // Import ConfigModule to use ConfigService
  providers: [ProxyManagerService],
  exports: [ProxyManagerService],
})
export class ProxyModule {}