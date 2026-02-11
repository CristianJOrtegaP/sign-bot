/**
 * Contract Tests: Meta WhatsApp Webhook Payloads
 * Valida que los schemas Zod coincidan con la estructura
 * esperada de Meta Graph API v22.0 - Sign Bot
 *
 * Documentacion: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */

const {
  webhookPayloadSchema: _webhookPayloadSchema,
  messageSchema,
  validateWebhookPayload,
  extractMessage,
} = require('../../bot/schemas/webhookPayload');
const payloads = require('../factories/whatsappPayloads');

// =============================================================
// TEST GROUP 1: Payloads validos de las factories
// =============================================================
describe('Contract Tests: Meta Webhook v22.0', () => {
  describe('Payloads validos (factories)', () => {
    test('mensaje de texto debe pasar validacion', () => {
      const payload = payloads.createTextMessage('mis documentos');
      const result = validateWebhookPayload(payload);
      expect(result.success).toBe(true);
    });

    test('respuesta de boton debe pasar validacion', () => {
      const payload = payloads.createButtonResponse('btn_ver_documentos');
      const result = validateWebhookPayload(payload);
      expect(result.success).toBe(true);
    });

    test('notificacion de estado debe pasar validacion', () => {
      const payload = payloads.createStatusNotification('msg-1', 'delivered');
      const result = validateWebhookPayload(payload);
      expect(result.success).toBe(true);
    });

    test('callback de template debe pasar validacion', () => {
      const payload = payloads.createTemplateStatusCallback('wamid.tmpl_1', 'delivered');
      const result = validateWebhookPayload(payload);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================
  // TEST GROUP 2: Payloads reales de la documentacion de Meta
  // =============================================================
  describe('Payloads reales (documentacion Meta v22.0)', () => {
    test('payload completo de texto segun docs de Meta', () => {
      const metaRealPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345',
                  },
                  contacts: [
                    {
                      profile: { name: 'John Doe' },
                      wa_id: '5215512345678',
                    },
                  ],
                  messages: [
                    {
                      from: '5215512345678',
                      id: 'wamid.ABCDEfghij123456789',
                      timestamp: '1677000000',
                      type: 'text',
                      text: { body: 'mis documentos' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = validateWebhookPayload(metaRealPayload);
      expect(result.success).toBe(true);
    });

    test('payload de button_reply interactivo', () => {
      const metaButtonPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345',
                  },
                  contacts: [
                    {
                      profile: { name: 'Pedro' },
                      wa_id: '5215500000001',
                    },
                  ],
                  messages: [
                    {
                      from: '5215500000001',
                      id: 'wamid.BTN_123',
                      timestamp: '1677000000',
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: 'btn_rechazar',
                          title: 'Rechazar',
                        },
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const result = validateWebhookPayload(metaButtonPayload);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================
  // TEST GROUP 3: Payloads malformados que DEBEN fallar
  // =============================================================
  describe('Payloads invalidos (deben fallar)', () => {
    test('debe rechazar payload sin object', () => {
      const result = validateWebhookPayload({ entry: [] });
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload con object incorrecto', () => {
      const result = validateWebhookPayload({
        object: 'instagram_account',
        entry: [],
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar mensaje sin from', () => {
      const result = messageSchema.safeParse({
        id: 'wamid.test',
        timestamp: '1677000000',
        type: 'text',
        text: { body: 'Hello' },
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar mensaje sin id', () => {
      const result = messageSchema.safeParse({
        from: '5215512345678',
        timestamp: '1677000000',
        type: 'text',
        text: { body: 'Hello' },
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload completamente vacio', () => {
      const result = validateWebhookPayload({});
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload null', () => {
      const result = validateWebhookPayload(null);
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload undefined', () => {
      const result = validateWebhookPayload(undefined);
      expect(result.success).toBe(false);
    });
  });

  // =============================================================
  // TEST GROUP 4: Campos criticos para extractMessage()
  // =============================================================
  describe('Campos criticos para extractMessage()', () => {
    test('extractMessage debe retornar el mensaje del payload', () => {
      const payload = payloads.createTextMessage('Test');
      const msg = extractMessage(payload);

      expect(msg).toBeDefined();
      expect(msg.from).toBeDefined();
      expect(msg.id).toBeDefined();
      expect(msg.type).toBeDefined();
      expect(msg.timestamp).toBeDefined();
    });

    test('extractMessage debe retornar null para payload sin mensajes', () => {
      const payload = payloads.createStatusNotification('msg-1', 'delivered');
      const msg = extractMessage(payload);

      expect(msg).toBeNull();
    });

    test('extractMessage debe retornar null para payload invalido', () => {
      expect(extractMessage({})).toBeNull();
      expect(extractMessage(null)).toBeNull();
      expect(extractMessage(undefined)).toBeNull();
    });

    test('contacts[0].profile.name debe existir para nombre de perfil', () => {
      const payload = payloads.createTextMessage('Test');
      const contact = payload.entry[0].changes[0].value.contacts[0];

      expect(contact).toBeDefined();
      expect(contact.profile).toBeDefined();
      expect(contact.profile.name).toBeDefined();
      expect(typeof contact.profile.name).toBe('string');
    });

    test('metadata debe contener phone_number_id', () => {
      const payload = payloads.createTextMessage('Test');
      const metadata = payload.entry[0].changes[0].value.metadata;

      expect(metadata.phone_number_id).toBeDefined();
      expect(typeof metadata.phone_number_id).toBe('string');
    });
  });
});
