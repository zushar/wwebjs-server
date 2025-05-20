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
          '--disable-features=site-per-process',
          '--disable-background-networking',
          '--disable-translate',
          '--disable-accelerated-2d-canvas',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-cache',
          '--disable-component-extensions-with-background-pages',
          '--disable-crash-reporter',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-mojo-local-storage',
          '--disable-notifications',
          '--disable-popup-blocking',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-software-rasterizer',
          '--ignore-certificate-errors',
          '--log-level=3',
          '--no-default-browser-check',
          '--no-first-run',
          '--no-zygote',
          '--renderer-process-limit=100',
          '--enable-gpu-rasterization',
          '--enable-zero-copy',
        ],
        defaultViewport: { width: 800, height: 600 }, // ברירת מחדל קטנה יותר
      },
    };
    return new Client(defaultOptions);
  }
}
