import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientOptions, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class ClientFactoryService {
  private readonly logger = new Logger(ClientFactoryService.name);

  createClient(phoneNumber: string): Client {
    this.logger.debug(`Creating WhatsApp client for: ${phoneNumber}`);
    const defaultOptions: ClientOptions = {
      authStrategy: new LocalAuth({
        clientId: phoneNumber,
        dataPath: `./whatsapp-session/${phoneNumber}`,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-accelerated-2d-canvas',
          '--disable-dev-shm-usage',
          '--disable-features=site-per-process',
          '--disable-crash-reporter',
        ],
        defaultViewport: { width: 800, height: 600 }, // ברירת מחדל קטנה יותר
      },
    };
    return new Client(defaultOptions);
  }
}
