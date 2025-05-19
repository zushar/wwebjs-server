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
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          // הוסף ארגומנטים לחיסכון במשאבים:
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-features=Translate,BackForwardCache',
          '--single-process', // חסכוני יותר אבל פחות יציב
          '--disable-field-trial-config',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--enable-features=NetworkService,NetworkServiceInProcess',
          '--js-flags=--max-old-space-size=512', // הגבלת זיכרון JavaScript ל-512MB
        ],
        defaultViewport: { width: 800, height: 600 }, // ברירת מחדל קטנה יותר
      },
    };
    return new Client(defaultOptions);
  }
}
