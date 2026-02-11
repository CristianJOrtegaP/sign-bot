/**
 * Factory: SAP Document API Payloads
 * Genera payloads para el endpoint de recepcion de documentos desde SAP
 */

// PDF minimo valido en base64 (%PDF header)
const FAKE_PDF_BASE64 = Buffer.from('%PDF-1.4 fake pdf content for testing').toString('base64');

function createSapDocumentPayload(overrides = {}) {
  return {
    sapDocumentId: `SAP-DOC-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    clienteTelefono: '5215512345678',
    clienteNombre: 'Juan Perez',
    tipoDocumento: 'CONTRATO',
    documentoNombre: 'Contrato de Servicio 2025',
    pdfBase64: FAKE_PDF_BASE64,
    ...overrides,
  };
}

/**
 * Crea un payload con email del cliente (opcional en el schema)
 */
function createSapDocumentPayloadConEmail(overrides = {}) {
  return createSapDocumentPayload({
    clienteEmail: 'juan@example.com',
    ...overrides,
  });
}

/**
 * Crea un payload con datos extra
 */
function createSapDocumentPayloadConDatosExtra(overrides = {}) {
  return createSapDocumentPayload({
    datosExtra: {
      centroServicio: 'CS-001',
      ejecutivoId: 'EJ-100',
    },
    ...overrides,
  });
}

/**
 * Crea un payload con callback URL de SAP
 */
function createSapDocumentPayloadConCallback(overrides = {}) {
  return createSapDocumentPayload({
    sapCallbackUrl: 'https://sap.example.com/api/callback/document-status',
    ...overrides,
  });
}

module.exports = {
  FAKE_PDF_BASE64,
  createSapDocumentPayload,
  createSapDocumentPayloadConEmail,
  createSapDocumentPayloadConDatosExtra,
  createSapDocumentPayloadConCallback,
};
