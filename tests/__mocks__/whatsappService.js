/**
 * Mock - WhatsApp Service
 * Simula todas las funciones del servicio de WhatsApp
 */

const sentMessages = [];
const downloadedMedia = [];

const mockWhatsappService = {
  // Almacenamiento de mensajes enviados (para assertions)
  _sentMessages: sentMessages,
  _downloadedMedia: downloadedMedia,

  // Reset para tests
  __reset: () => {
    sentMessages.length = 0;
    downloadedMedia.length = 0;
  },

  // Obtener último mensaje enviado
  __getLastMessage: () => sentMessages[sentMessages.length - 1],

  // Obtener todos los mensajes enviados
  __getAllMessages: () => [...sentMessages],

  // Obtener mensajes enviados a un número específico
  __getMessagesTo: (to) => sentMessages.filter((m) => m.to === to),

  sendText: jest.fn().mockImplementation(async (to, text) => {
    const msg = { type: 'text', to, text, timestamp: Date.now() };
    sentMessages.push(msg);
    return { messages: [{ id: `msg_${Date.now()}` }] };
  }),

  sendButtons: jest.fn().mockImplementation(async (to, bodyText, buttons) => {
    const msg = { type: 'buttons', to, bodyText, buttons, timestamp: Date.now() };
    sentMessages.push(msg);
    return { messages: [{ id: `msg_${Date.now()}` }] };
  }),

  sendInteractiveMessage: jest
    .fn()
    .mockImplementation(async (to, headerText, bodyText, buttons) => {
      const msg = { type: 'interactive', to, headerText, bodyText, buttons, timestamp: Date.now() };
      sentMessages.push(msg);
      return { messages: [{ id: `msg_${Date.now()}` }] };
    }),

  downloadMedia: jest.fn().mockImplementation(async (mediaId) => {
    downloadedMedia.push(mediaId);
    // Retorna un buffer simulado de imagen
    return Buffer.from('fake-image-data');
  }),

  sendTypingIndicator: jest.fn().mockImplementation(async (_to, _messageId) => {
    return { success: true };
  }),

  sendListMessage: jest
    .fn()
    .mockImplementation(async (to, headerText, bodyText, buttonText, rows) => {
      const msg = {
        type: 'list',
        to,
        headerText,
        bodyText,
        buttonText,
        rows,
        timestamp: Date.now(),
      };
      sentMessages.push(msg);
      return { messages: [{ id: `msg_${Date.now()}` }] };
    }),

  // Funciones con guardado automático en BD
  sendAndSaveText: jest.fn().mockImplementation(async (to, text) => {
    const msg = { type: 'text', to, text, timestamp: Date.now(), saved: true };
    sentMessages.push(msg);
    return { messages: [{ id: `msg_${Date.now()}` }] };
  }),

  sendAndSaveInteractive: jest
    .fn()
    .mockImplementation(async (to, headerText, bodyText, buttons) => {
      const msg = {
        type: 'interactive',
        to,
        headerText,
        bodyText,
        buttons,
        timestamp: Date.now(),
        saved: true,
      };
      sentMessages.push(msg);
      return { messages: [{ id: `msg_${Date.now()}` }] };
    }),

  sendAndSaveList: jest
    .fn()
    .mockImplementation(async (to, headerText, bodyText, buttonText, rows) => {
      const msg = {
        type: 'list',
        to,
        headerText,
        bodyText,
        buttonText,
        rows,
        timestamp: Date.now(),
        saved: true,
      };
      sentMessages.push(msg);
      return { messages: [{ id: `msg_${Date.now()}` }] };
    }),
};

module.exports = mockWhatsappService;
