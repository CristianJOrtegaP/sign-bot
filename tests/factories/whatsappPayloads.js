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

function createImageMessage(mediaId = 'media-123', from = '+5215512345678', messageId = null) {
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
                  type: 'image',
                  image: { id: mediaId, mime_type: 'image/jpeg', sha256: 'abc123' },
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

function createLocationMessage(
  lat = 19.4326,
  lng = -99.1332,
  from = '+5215512345678',
  messageId = null
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
              contacts: [{ profile: { name: 'Test User' }, wa_id: from }],
              messages: [
                {
                  from,
                  id: messageId || nextId(),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'location',
                  location: { latitude: lat, longitude: lng },
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

function createAudioMessage(mediaId = 'audio-123', from = '+5215512345678', messageId = null) {
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
                  type: 'audio',
                  audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus' },
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

module.exports = {
  createTextMessage,
  createButtonResponse,
  createImageMessage,
  createLocationMessage,
  createAudioMessage,
  createVerificationRequest,
  createStatusNotification,
};
