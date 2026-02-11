/**
 * Mock: WhatsApp Service
 * Captura todos los mensajes enviados para assertions
 */

const _messages = [];

const whatsappMock = {
  sendText: jest.fn().mockResolvedValue({ success: true }),
  sendButtons: jest.fn().mockResolvedValue({ success: true }),
  sendInteractiveMessage: jest.fn().mockResolvedValue({ success: true }),
  sendListMessage: jest.fn().mockResolvedValue({ success: true }),
  sendAndSaveText: jest.fn().mockResolvedValue({ success: true }),
  sendAndSaveInteractive: jest.fn().mockResolvedValue({ success: true }),
  sendAndSaveList: jest.fn().mockResolvedValue({ success: true }),
  sendTemplate: jest.fn().mockResolvedValue({ success: true, messageId: 'wamid.template_123' }),
  sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.from('fake-image')),

  // Helpers para assertions
  __getMessages() {
    return [..._messages];
  },
  __getLastMessage() {
    return _messages[_messages.length - 1] || null;
  },
  __getMessagesTo(to) {
    return _messages.filter((m) => m.to === to);
  },
  __reset() {
    _messages.length = 0;
    Object.values(whatsappMock).forEach((fn) => {
      if (typeof fn === 'function' && fn.mockClear) {
        fn.mockClear();
      }
    });
  },
};

// Interceptar llamadas para capturar mensajes
whatsappMock.sendText.mockImplementation(async (to, text) => {
  _messages.push({ type: 'text', to, text });
  return { success: true };
});

whatsappMock.sendAndSaveText.mockImplementation(async (to, text) => {
  _messages.push({ type: 'text', to, text });
  return { success: true };
});

whatsappMock.sendInteractiveMessage.mockImplementation(async (to, header, body, buttons) => {
  _messages.push({ type: 'interactive', to, header, body, buttons });
  return { success: true };
});

whatsappMock.sendAndSaveInteractive.mockImplementation(async (to, header, body, buttons) => {
  _messages.push({ type: 'interactive', to, header, body, buttons });
  return { success: true };
});

whatsappMock.sendAndSaveList.mockImplementation(async (to, header, body, btnText, rows) => {
  _messages.push({ type: 'list', to, header, body, btnText, rows });
  return { success: true };
});

whatsappMock.sendTemplate.mockImplementation(async (to, templateName, templateData) => {
  _messages.push({ type: 'template', to, templateName, templateData });
  return { success: true, messageId: 'wamid.template_123' };
});

module.exports = whatsappMock;
