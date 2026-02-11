/**
 * Factory: DocumentoFirma Objects
 * Crea objetos de DocumentoFirma para testing - Sign Bot
 */

function createDocumento(overrides = {}) {
  return {
    DocumentoFirmaId: 1,
    SapDocumentId: 'SAP-DOC-001',
    ClienteTelefono: '5215512345678',
    ClienteNombre: 'Juan Perez',
    ClienteEmail: 'juan@example.com',
    TipoDocumento: 'CONTRATO',
    DocumentoNombre: 'Contrato de Servicio 2025',
    EstadoDocumento: 'PENDIENTE_ENVIO',
    EnvelopeId: null,
    SigningUrl: null,
    BlobUrl: null,
    BlobUrlFirmado: null,
    MotivoRechazo: null,
    RecordatoriosEnviados: 0,
    UltimoRecordatorio: null,
    DatosExtra: null,
    FechaCreacion: new Date(),
    FechaActualizacion: new Date(),
    FechaFirma: null,
    Version: 1,
    ...overrides,
  };
}

function createDocumentoPendiente(overrides = {}) {
  return createDocumento({
    EstadoDocumento: 'PENDIENTE_ENVIO',
    ...overrides,
  });
}

function createDocumentoEnviado(overrides = {}) {
  return createDocumento({
    EstadoDocumento: 'ENVIADO',
    EnvelopeId: `env-test-${Math.random().toString(36).substr(2, 8)}`,
    SigningUrl: 'https://demo.docusign.net/signing/test-url',
    ...overrides,
  });
}

function createDocumentoFirmado(overrides = {}) {
  return createDocumento({
    EstadoDocumento: 'FIRMADO',
    EnvelopeId: 'env-test-firmado',
    SigningUrl: null,
    FechaFirma: new Date(),
    BlobUrlFirmado: 'https://test.blob.core.windows.net/firmados/doc-firmado.pdf',
    ...overrides,
  });
}

function createDocumentoRechazado(overrides = {}) {
  return createDocumento({
    EstadoDocumento: 'RECHAZADO',
    EnvelopeId: 'env-test-rechazado',
    SigningUrl: 'https://demo.docusign.net/signing/test-url',
    MotivoRechazo: 'No estoy de acuerdo con los terminos',
    ...overrides,
  });
}

function createDocumentoAnulado(overrides = {}) {
  return createDocumento({
    EstadoDocumento: 'ANULADO',
    EnvelopeId: 'env-test-anulado',
    SigningUrl: null,
    ...overrides,
  });
}

module.exports = {
  createDocumento,
  createDocumentoPendiente,
  createDocumentoEnviado,
  createDocumentoFirmado,
  createDocumentoRechazado,
  createDocumentoAnulado,
};
