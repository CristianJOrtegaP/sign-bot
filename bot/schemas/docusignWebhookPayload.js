/**
 * SIGN BOT - Schema de Validacion para Webhook de DocuSign Connect
 * Valida el payload que DocuSign envia cuando cambia el estado de un envelope
 */

const { z } = require('zod');

// Schema para el summary del envelope
const envelopeSummarySchema = z
  .object({
    status: z.string(),
    documentsUri: z.string().optional(),
    recipientsUri: z.string().optional(),
    envelopeUri: z.string().optional(),
    emailSubject: z.string().optional(),
    envelopeId: z.string().optional(),
    signingLocation: z.string().optional(),
    customFieldsUri: z.string().optional(),
    notificationUri: z.string().optional(),
    enableWetSign: z.string().optional(),
    allowMarkup: z.string().optional(),
    allowReassign: z.string().optional(),
    createdDateTime: z.string().optional(),
    lastModifiedDateTime: z.string().optional(),
    deliveredDateTime: z.string().optional(),
    sentDateTime: z.string().optional(),
    completedDateTime: z.string().optional(),
    voidedDateTime: z.string().optional(),
    voidedReason: z.string().optional(),
    declinedDateTime: z.string().optional(),
    statusChangedDateTime: z.string().optional(),
  })
  .passthrough();

// Schema para los datos del webhook
const webhookDataSchema = z
  .object({
    accountId: z.string(),
    envelopeId: z.string(),
    envelopeSummary: envelopeSummarySchema.optional(),
  })
  .passthrough();

// Schema completo del webhook de DocuSign Connect
const docusignWebhookPayload = z.object({
  event: z.string(),
  apiVersion: z.string().optional(),
  uri: z.string().optional(),
  retryCount: z.number().optional(),
  configurationId: z.string().optional(),
  generatedDateTime: z.string().optional(),
  data: webhookDataSchema,
});

/**
 * Valida el payload de un webhook de DocuSign Connect
 * @param {Object} payload - Payload a validar
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function validateDocusignWebhookPayload(payload) {
  try {
    const result = docusignWebhookPayload.parse(payload);
    return { success: true, data: result };
  } catch (error) {
    const errorMessage =
      error.errors?.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') ||
      'Payload invalido';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Extrae informacion relevante del payload de DocuSign
 * @param {Object} payload - Payload validado del webhook
 * @returns {Object} - Informacion extraida
 */
function extractDocusignEventData(payload) {
  try {
    const { event, data } = payload;
    const envelopeId = data?.envelopeId;
    const accountId = data?.accountId;
    const status = data?.envelopeSummary?.status;
    const voidedReason = data?.envelopeSummary?.voidedReason;

    return {
      event,
      envelopeId,
      accountId,
      status,
      voidedReason,
    };
  } catch {
    return null;
  }
}

module.exports = {
  docusignWebhookPayload,
  envelopeSummarySchema,
  webhookDataSchema,
  validateDocusignWebhookPayload,
  extractDocusignEventData,
};
