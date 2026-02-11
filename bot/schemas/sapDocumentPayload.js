/**
 * SIGN BOT - Schema de Validacion para API de Documentos desde SAP
 * Valida el payload que SAP envia para crear un nuevo documento de firma
 */

const { z } = require('zod');

// Schema para el payload de documento de SAP
const sapDocumentPayload = z.object({
  sapDocumentId: z.string().min(1).max(100),
  sapCallbackUrl: z.string().url().optional(),
  clienteTelefono: z.string().regex(/^\d{10,15}$/),
  clienteNombre: z.string().min(1).max(200),
  clienteEmail: z.string().email().optional(),
  tipoDocumento: z.enum(['CONTRATO', 'ADENDUM', 'PAGARE', 'OTRO']).default('OTRO'),
  documentoNombre: z.string().min(1).max(500),
  pdfBase64: z.string().min(1), // Base64 encoded PDF
  datosExtra: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Valida el payload de un documento enviado por SAP
 * @param {Object} payload - Payload a validar
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function validateSapDocumentPayload(payload) {
  try {
    const result = sapDocumentPayload.parse(payload);
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

module.exports = {
  sapDocumentPayload,
  validateSapDocumentPayload,
};
