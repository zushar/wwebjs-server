//wwebjs.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientSessionManagerService } from './client-session-manager.service';
import { ConnectService } from './connect.service';
import { SessionPersistenceService } from './session-persistence.service';
import { SessionRestoreService } from './session-restore.service';
import { WwebjsServices } from './wwebjs.services';

@Module({
  imports: [RedisModule],
  providers: [
    WwebjsServices, 
    ConnectService, 
    ClientFactoryService, 
    ConnectService,
    ClientFactoryService,
    ClientSessionManagerService,
    SessionPersistenceService,
    ClientLifecycleService,
    SessionRestoreService,
  ],
  exports: [ConnectService, WwebjsServices],
})
export class WwebjsModule {}
