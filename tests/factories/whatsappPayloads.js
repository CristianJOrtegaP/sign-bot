/**
 * Factory: WhatsApp Webhook Payloads
 * Genera payloads realistas del webhook de Meta
 */

let _counter = 0;

function nextId() {
  return `wamid.test_${Date.now()}_${++_counter}`;
}

function createTextMessage(text, from = '+5215512345678', messageId = null) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100200300',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15551234567', phone_number_id: 'test-phone-id' },
              contacts: [{ profile: { name: 'Test User' }, wa_id: from }],
              messages: [
                {
                  from,
                  id: messageId || nextId(),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function createButtonResponse(buttonId, from = '+5215512345678', messageId = null) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100200300',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15551234567', phone_number_id: 'test-phone-id' },
              contacts: [{ profile: { name: 'Test User' }, wa_id: from }],
              messages: [
                {
                  from,
                  id: messageId || nextId(),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'interactive',
                  interactive: {
                    type: 'button_reply',
                    button_reply: { id: buttonId, title: buttonId },
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
}

function createVerificationRequest(token = 'test-verify-token', challenge = '1234567890') {
  return {
    method: 'GET',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': challenge },
    headers: {},
  };
}

function createStatusNotification(
  messageId = 'wamid.status1',
  status = 'delivered',
  from = '+5215512345678'
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100200300',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15551234567', phone_number_id: 'test-phone-id' },
              statuses: [
                {
                  id: messageId,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: from,
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function createTemplateStatusCallback(
  messageId = 'wamid.template_123',
  status = 'delivered',
  from = '+5215512345678'
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100200300',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15551234567', phone_number_id: 'test-phone-id' },
              statuses: [
                {
                  id: messageId,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: from,
                  conversation: {
                    id: 'conv-test-123',
                    origin: { type: 'utility' },
                  },
                  pricing: {
                    billable: true,
                    pricing_model: 'CBP',
                    category: 'utility',
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
}

module.exports = {
  createTextMessage,
  createButtonResponse,
  createVerificationRequest,
  createStatusNotification,
  createTemplateStatusCallback,
};
