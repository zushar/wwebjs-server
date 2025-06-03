import { proto } from '@whiskeysockets/baileys';

export class MessageParserUtil {
  static extractMessageContent(
    message: proto.IWebMessageInfo,
  ): Record<string, any> {
    const content: Record<string, any> = {};

    if (message.message?.conversation) {
      content.type = 'text';
      content.text = message.message.conversation;
    } else if (message.message?.imageMessage) {
      content.type = 'image';
      content.caption = message.message.imageMessage.caption || '';
      content.url = message.message.imageMessage.url || '';
      content.mimetype = message.message.imageMessage.mimetype || '';
    } else if (message.message?.videoMessage) {
      content.type = 'video';
      content.caption = message.message.videoMessage.caption || '';
      content.url = message.message.videoMessage.url || '';
    } else if (message.message?.documentMessage) {
      content.type = 'document';
      content.fileName = message.message.documentMessage.fileName || '';
      content.url = message.message.documentMessage.url || '';
    } else if (message.message?.audioMessage) {
      content.type = 'audio';
      content.url = message.message.audioMessage.url || '';
      content.ptt = message.message.audioMessage.ptt || false;
    } else if (message.message?.locationMessage) {
      content.type = 'location';
      content.degreesLatitude =
        message.message.locationMessage.degreesLatitude || 0;
      content.degreesLongitude =
        message.message.locationMessage.degreesLongitude || 0;
    } else {
      content.type = 'unknown';
    }

    return content;
  }
}
