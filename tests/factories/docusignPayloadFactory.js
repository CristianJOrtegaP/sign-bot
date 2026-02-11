/**
 * Factory: DocuSign Connect Webhook Payloads
 * Genera payloads de eventos de DocuSign Connect
 */

function createDocuSignWebhookPayload(
  envelopeId = 'env-test-123',
  event = 'envelope-sent',
  overrides = {}
) {
  return {
    event,
    apiVersion: 'v2.1',
    uri: `/restapi/v2.1/accounts/test-account-id/envelopes/${envelopeId}`,
    retryCount: 0,
    configurationId: 'config-test-123',
    generatedDateTime: new Date().toISOString(),
    data: {
      accountId: 'test-account-id',
      envelopeId,
      envelopeSummary: {
        status:
          event === 'envelope-completed'
            ? 'completed'
            : event === 'envelope-declined'
              ? 'declined'
              : event === 'envelope-voided'
                ? 'voided'
                : event === 'recipient-sent'
                  ? 'sent'
                  : event === 'recipient-delivered'
                    ? 'delivered'
                    : event === 'recipient-completed'
                      ? 'completed'
                      : 'sent',
        emailSubject: 'Documento para firma: Contrato Test',
        envelopeId,
        createdDateTime: new Date(Date.now() - 3600000).toISOString(),
        sentDateTime: new Date(Date.now() - 3600000).toISOString(),
        statusChangedDateTime: new Date().toISOString(),
      },
      ...overrides.data,
    },
    ...overrides,
  };
}

function createCompletedPayload(envelopeId = 'env-test-123') {
  return createDocuSignWebhookPayload(envelopeId, 'envelope-completed', {
    data: {
      accountId: 'test-account-id',
      envelopeId,
      envelopeSummary: {
        status: 'completed',
        emailSubject: 'Documento para firma: Contrato Test',
        envelopeId,
        createdDateTime: new Date(Date.now() - 3600000).toISOString(),
        sentDateTime: new Date(Date.now() - 3600000).toISOString(),
        completedDateTime: new Date().toISOString(),
        statusChangedDateTime: new Date().toISOString(),
      },
    },
  });
}

function createDeclinedPayload(
  envelopeId = 'env-test-123',
  reason = 'No estoy de acuerdo con los terminos'
) {
  return createDocuSignWebhookPayload(envelopeId, 'envelope-declined', {
    data: {
      accountId: 'test-account-id',
      envelopeId,
      envelopeSummary: {
        status: 'declined',
        emailSubject: 'Documento para firma: Contrato Test',
        envelopeId,
        createdDateTime: new Date(Date.now() - 3600000).toISOString(),
        sentDateTime: new Date(Date.now() - 3600000).toISOString(),
        declinedDateTime: new Date().toISOString(),
        statusChangedDateTime: new Date().toISOString(),
        voidedReason: reason,
      },
    },
  });
}

function createVoidedPayload(envelopeId = 'env-test-123') {
  return createDocuSignWebhookPayload(envelopeId, 'envelope-voided', {
    data: {
      accountId: 'test-account-id',
      envelopeId,
      envelopeSummary: {
        status: 'voided',
        emailSubject: 'Documento para firma: Contrato Test',
        envelopeId,
        createdDateTime: new Date(Date.now() - 3600000).toISOString(),
        sentDateTime: new Date(Date.now() - 3600000).toISOString(),
        voidedDateTime: new Date().toISOString(),
        voidedReason: 'Anulado por el sistema',
        statusChangedDateTime: new Date().toISOString(),
      },
    },
  });
}

module.exports = {
  createDocuSignWebhookPayload,
  createCompletedPayload,
  createDeclinedPayload,
  createVoidedPayload,
};
