// client-factory.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientOptions, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class ClientFactoryService {
  private readonly logger = new Logger(ClientFactoryService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Creates a new WhatsApp Web.js client with consistent configuration
   * @param phoneNumber The phone number to associate with this client
   * @returns A configured Client instance
   */
  createClient(phoneNumber: string): Client {
    this.logger.debug(`Creating WhatsApp client for: ${phoneNumber}`);
    
    const defaultOptions: ClientOptions = {
      authStrategy: new LocalAuth({
        clientId: phoneNumber,
        dataPath: this.configService.get<string>('SESSIONS_PATH') || '/tmp/sessions'
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
          '--disable-extensions',
          '--disable-sync',
          '--disable-background-networking',
          '--disable-default-apps',
          '--mute-audio',
          '--hide-scrollbars',
          '--disable-translate',
          '--disable-features=site-per-process',
          '--window-size=1280,1024',
          // ארגומנטים חדשים שיעזרו בסביבת Docker
          '--ignore-certificate-errors',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
        ],
        ignoreHTTPSErrors: true,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        timeout: 120000, // תן זמן ארוך יותר לטעינה (2 דקות)
      },
      webVersionCache: {
        type: 'none' // למנוע שימוש במטמון גרסאות
      },
      webVersion: '2.2403.5', // הגדרת גרסה קבועה למניעת בעיות תאימות
      qrMaxRetries: 5,
    };

    return new Client(defaultOptions);
  }
}