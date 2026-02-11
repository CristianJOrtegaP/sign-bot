/**
 * SIGN BOT - Exportacion centralizada de schemas
 */

const webhookPayload = require('./webhookPayload');
const sapDocumentPayload = require('./sapDocumentPayload');
const docusignWebhookPayload = require('./docusignWebhookPayload');

module.exports = {
  // Webhook de WhatsApp
  ...webhookPayload,

  // API de documentos desde SAP
  ...sapDocumentPayload,

  // Webhook de DocuSign Connect
  ...docusignWebhookPayload,
};
