/**
 * SIGN BOT - Flujo de Firma de Documentos
 * Maneja respuestas del usuario a notificaciones de firma
 *
 * Entry: Usuario presiona "Rechazar" en template de WhatsApp
 * States: ESPERANDO_CONFIRMACION
 *
 * Flujo:
 * 1. Usuario presiona quick reply "Rechazar" -> solicitar motivo de rechazo
 * 2. Usuario escribe motivo -> registrar rechazo, notificar Teams
 * 3. O usuario presiona "Firmar" -> redirigir a URL de firma DocuSign
 *
 * @module bot/flows/firmaFlow
 */

const { ESTADO } = require('../constants/sessionStates');
const { ESTADO_DOCUMENTO } = require('../constants/documentStates');
const { FIRMA } = require('../constants/messages');
const db = require('../../core/services/storage/databaseService');
const teamsService = require('../../core/services/external/teamsService');
const { logger } = require('../../core/services/infrastructure/errorHandler');

/**
 * Handler: Usuario presiona "Rechazar" / RECHAZAR_DOCUMENTO quick reply
 * Pide al usuario el motivo del rechazo
 *
 * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx - Contexto del flujo
 * @param {Object} session - Sesion actual
 */
async function handleRechazoIniciado(ctx, _session) {
  const datos = ctx.getDatos();

  // Guardar el documentoFirmaId en DatosTemp para referencia
  await ctx.cambiarEstado(ESTADO.ESPERANDO_CONFIRMACION, {
    documentoFirmaId: datos.documentoFirmaId || null,
    documentoNombre: datos.documentoNombre || null,
    accion: 'RECHAZO',
  });

  // Solicitar motivo de rechazo
  await ctx.responder(FIRMA.SOLICITAR_MOTIVO_RECHAZO);
}

/**
 * Handler: Usuario en ESPERANDO_CONFIRMACION envia texto (motivo de rechazo)
 * Registra el rechazo y notifica por Teams
 *
 * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx - Contexto del flujo
 * @param {string} texto - Motivo de rechazo del usuario
 * @param {Object} session - Sesion actual
 */
async function handleMotivoRechazo(ctx, texto, _session) {
  const datos = ctx.getDatos();
  const documentoFirmaId = datos.documentoFirmaId;
  const documentoNombre = datos.documentoNombre || 'documento';

  // Actualizar estado del documento a RECHAZADO con motivo
  if (documentoFirmaId) {
    try {
      await db.updateDocumentoFirmaEstado(documentoFirmaId, ESTADO_DOCUMENTO.RECHAZADO, texto);
      ctx.log(`Documento ${documentoFirmaId} rechazado con motivo: ${texto}`);
    } catch (error) {
      ctx.registrarError('Error actualizando estado de documento', error);
      // Continuar con el flujo aunque falle la actualizacion
    }
  }

  // Enviar confirmacion de rechazo al usuario
  await ctx.responder(FIRMA.RECHAZO_REGISTRADO(documentoNombre));

  // Notificar a Teams del rechazo (fire-and-forget)
  teamsService.notifyDocumentRejected(ctx.from, documentoNombre, texto).catch((err) => {
    logger.warn('[firmaFlow] Error notificando rechazo a Teams', { error: err.message });
  });

  // Resetear sesion a INICIO
  await ctx.finalizar('Rechazo de documento registrado');
}

/**
 * Definicion del flujo para el StaticFlowRegistry
 */
module.exports = {
  nombre: 'FIRMA',

  // Estados que maneja este flujo
  estados: [ESTADO.ESPERANDO_CONFIRMACION],

  // Mapeo de botones -> handlers
  botones: {
    btn_rechazar: 'handleRechazoIniciado',
  },

  // Handlers por estado
  handlers: {
    [ESTADO.ESPERANDO_CONFIRMACION]: 'handleMotivoRechazo',
  },

  // Metodos del flujo
  handleRechazoIniciado,
  handleMotivoRechazo,
};
