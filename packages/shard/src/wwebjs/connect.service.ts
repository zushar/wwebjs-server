// connect.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClientType } from '@whatsapp-cluster/shared-lib';
import { Client } from 'whatsapp-web.js';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientSessionManagerService } from './client-session-manager.service';
import { SessionPersistenceService } from './session-persistence.service';
import { SessionRestoreService } from './session-restore.service';

@Injectable()
export class ConnectService implements OnModuleInit {
  constructor(
    private readonly sessionManager: ClientSessionManagerService,
    private readonly persistence: SessionPersistenceService,
    private readonly lifecycle: ClientLifecycleService,
    private readonly sessionRestore: SessionRestoreService,
  ) {}

  async onModuleInit() {
    await this.sessionRestore.restorePersistedClients();
  }

  // מתודות ציבוריות שמשמשות את ה-controller
  async createVerificationCode(
    phoneNumber: string,
    clientType: ClientType,
    verifiedInitially = false,
  ) {
    return this.lifecycle.createVerificationCode(phoneNumber, clientType, verifiedInitially);
  }

  async verifyCode(phoneNumber: string) {
    return this.lifecycle.verifyCode(phoneNumber);
  }

  async disconnectClient(clientId: string) {
    return this.lifecycle.disconnectClient(clientId);
  }

  async isClientVerified(phoneNumber: string): Promise<boolean> {
    return this.persistence.isClientVerified(phoneNumber);
  }
}
