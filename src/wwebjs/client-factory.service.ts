// client-factory.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientOptions, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class ClientFactoryService {
  private readonly logger = new Logger(ClientFactoryService.name);
  public clintNumber: string;

  /**
   * Creates a new WhatsApp Web.js client with consistent configuration
   * @param phoneNumber The phone number to associate with this client
   * @returns A configured Client instance
   */
  createClient(phoneNumber: string): Client {
    this.logger.debug(`Creating WhatsApp client for: ${phoneNumber}`);
    this.clintNumber = phoneNumber;
    const defaultOptions: ClientOptions = {
      authStrategy: new LocalAuth({
        clientId: phoneNumber,
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
        ],
      },
    };

    return new Client(defaultOptions);
  }
}
