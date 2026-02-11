/**
 * Mock: DocuSign Service
 * Simula operaciones de DocuSign eSign API
 */

let _createEnvelopeResponse = {
  envelopeId: 'test-envelope-123',
  signingUrl: 'https://demo.docusign.net/signing/xxx',
};

let _correctEnvelopeResponse = null; // se genera dinamicamente
let _voidEnvelopeResponse = { success: true };
let _envelopeStatusResponse = {
  status: 'sent',
  statusDateTime: new Date().toISOString(),
};
let _downloadResponse = Buffer.from('signed-pdf-content');
let _recipientViewResponse = {
  url: 'https://demo.docusign.net/signing/view-xxx',
};
let _validateHmacResponse = true;

const docusignMock = {
  createEnvelope: jest.fn(async () => ({ ..._createEnvelopeResponse })),

  correctEnvelope: jest.fn(async (envelopeId, _pdfBuffer) => {
    if (_correctEnvelopeResponse) {
      return { ..._correctEnvelopeResponse };
    }
    return {
      envelopeId,
      signingUrl: `https://demo.docusign.net/signing/corrected-${envelopeId}`,
    };
  }),

  voidEnvelope: jest.fn(async () => ({ ..._voidEnvelopeResponse })),

  getEnvelopeStatus: jest.fn(async () => ({
    ..._envelopeStatusResponse,
    statusDateTime: new Date().toISOString(),
  })),

  downloadSignedDocument: jest.fn(async () => Buffer.from(_downloadResponse)),

  createRecipientView: jest.fn(async () => ({ ..._recipientViewResponse })),

  validateWebhookHmac: jest.fn(() => _validateHmacResponse),

  // ============================================================
  // Helpers para configurar respuestas
  // ============================================================

  __setCreateEnvelopeResponse(response) {
    _createEnvelopeResponse = { ..._createEnvelopeResponse, ...response };
  },

  __setCorrectEnvelopeResponse(response) {
    _correctEnvelopeResponse = response;
  },

  __setVoidEnvelopeResponse(response) {
    _voidEnvelopeResponse = { ..._voidEnvelopeResponse, ...response };
  },

  __setEnvelopeStatusResponse(response) {
    _envelopeStatusResponse = { ..._envelopeStatusResponse, ...response };
  },

  __setDownloadResponse(buffer) {
    _downloadResponse = buffer;
  },

  __setRecipientViewResponse(response) {
    _recipientViewResponse = { ..._recipientViewResponse, ...response };
  },

  __setValidateHmacResponse(value) {
    _validateHmacResponse = value;
  },

  __reset() {
    _createEnvelopeResponse = {
      envelopeId: 'test-envelope-123',
      signingUrl: 'https://demo.docusign.net/signing/xxx',
    };
    _correctEnvelopeResponse = null;
    _voidEnvelopeResponse = { success: true };
    _envelopeStatusResponse = {
      status: 'sent',
      statusDateTime: new Date().toISOString(),
    };
    _downloadResponse = Buffer.from('signed-pdf-content');
    _recipientViewResponse = {
      url: 'https://demo.docusign.net/signing/view-xxx',
    };
    _validateHmacResponse = true;

    Object.values(docusignMock).forEach((fn) => {
      if (typeof fn === 'function' && fn.mockClear) {
        fn.mockClear();
      }
    });
  },
};

module.exports = docusignMock;
