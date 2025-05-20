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
          '--no-experiments',
          '--hide-scrollbars',
          '--disable-plugins',
          '--disable-infobars',
          '--disable-translate',
          '--disable-pepper-3d',
          '--disable-extensions',
          '--disable-dev-shm-usage',
          '--disable-notifications',
          '--disable-setuid-sandbox',
          '--disable-crash-reporter',
          '--disable-smooth-scrolling',
          '--disable-login-animations',
          '--disable-dinosaur-easter-egg',
          '--disable-accelerated-2d-canvas',
          '--disable-rtc-smoothness-algorithm',
        ],
        defaultViewport: { width: 800, height: 600 }, // ברירת מחדל קטנה יותר
      },
    };
    return new Client(defaultOptions);
  }
}
