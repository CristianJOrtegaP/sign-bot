/**
 * SIGN BOT - FlowManager
 * Orquestador central de flujos de conversacion
 * Todos los flujos usan FlowEngine con inyeccion de dependencias
 *
 * @module controllers/flows/FlowManager
 *
 * ## Flujos (bot/flows/)
 *
 * - **firmaFlow**: Firma/rechazo de documentos (StaticFlowContext)
 * - **consultaDocumentosFlow**: Consulta de documentos del usuario (StaticFlowContext)
 *
 * ## Diagrama de Estados
 *
 * ```
 * INICIO (terminal)
 *   ├─> "mis documentos" ─> CONSULTA_DOCUMENTOS ─> CONSULTA_DETALLE ─> [volver/fin]
 *   ├─> "ayuda"          ─> [mensaje de ayuda, se queda en INICIO]
 *   ├─> RECHAZAR_DOCUMENTO quick reply ─> ESPERANDO_CONFIRMACION ─> [motivo] ─> INICIO
 *   └─> default          ─> [menu de opciones]
 * ```
 */

const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const MSG = require('../../constants/messages');
const { logger } = require('../../../core/services/infrastructure/errorHandler');
const { ConcurrencyError } = require('../../../core/errors');

// FlowEngine
const { registry, inicializarFlujos } = require('../../flows');

// Inicializar flujos del FlowEngine al cargar el modulo
let flowEngineInicializado = false;
function ensureFlowEngineInit() {
  if (!flowEngineInicializado) {
    inicializarFlujos();
    flowEngineInicializado = true;
  }
}

const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  esEstadoAgente,
} = require('../../constants/sessionStates');

/**
 * Procesa un mensaje segun el estado actual de la sesion del usuario
 * @param {string} from - Numero de telefono del usuario (formato E.164)
 * @param {string} text - Texto del mensaje
 * @param {Object} session - Sesion actual del usuario con Estado y DatosTemp
 * @param {Object} context - Contexto de Azure Functions para logging
 * @returns {Promise<boolean>} - true si el mensaje fue procesado por un handler
 */
async function processSessionState(from, text, session, context) {
  ensureFlowEngineInit();

  // AGENTE_ACTIVO: no procesar (v2)
  if (esEstadoAgente(session.Estado)) {
    context.log('[FlowManager] Estado AGENTE_ACTIVO - ignorando mensaje');
    return false;
  }

  // Intentar con FlowEngine para estados registrados
  if (registry.tieneHandlerParaEstado(session.Estado)) {
    context.log(`[FlowManager] Usando FlowEngine para estado: ${session.Estado}`);
    try {
      const procesado = await registry.procesarMensaje(from, text, session, context);
      if (procesado) {
        context.log('[FlowManager] FlowEngine proceso el mensaje exitosamente');
        return true;
      }
    } catch (error) {
      context.log(`[FlowManager] Error en FlowEngine: ${error.message}`);
      logger.error('Error en FlowEngine', error, { estado: session.Estado });
      throw error;
    }
  }

  // No hay handler para este estado
  context.log(`[FlowManager] No hay handler para estado: ${session.Estado}`);
  return false;
}

/**
 * Procesa un boton presionado
 * @param {string} from - Numero de telefono
 * @param {string} buttonId - ID del boton presionado
 * @param {Object} session - Sesion actual
 * @param {Object} context - Contexto de Azure Functions
 * @returns {Promise<boolean>} true si el boton fue procesado
 */
async function processButton(from, buttonId, session, context) {
  ensureFlowEngineInit();

  // Intentar con FlowEngine
  const flowEngineHandler = registry.obtenerHandlerBoton(buttonId);
  if (flowEngineHandler) {
    context.log(`[FlowManager] Usando FlowEngine para boton: ${buttonId}`);
    try {
      const procesado = await registry.procesarBoton(from, buttonId, session, context);
      if (procesado) {
        context.log('[FlowManager] FlowEngine proceso el boton exitosamente');
        return true;
      }
    } catch (error) {
      context.log(`[FlowManager] Error en FlowEngine para boton: ${error.message}`);
      logger.error('Error en FlowEngine para boton', error, { buttonId });
      throw error;
    }
  }

  // Caso especial: boton cancelar
  if (buttonId === 'btn_cancelar') {
    await cancelarFlujo(from, context);
    return true;
  }

  context.log(`[FlowManager] Boton no registrado: ${buttonId}`);
  return false;
}

/**
 * Cancela el flujo de conversacion actual
 * Cambia la sesion a estado CANCELADO y envia mensaje de confirmacion
 * @param {string} from - Numero de telefono del usuario (formato E.164)
 * @param {Object} context - Contexto de Azure Functions para logging
 * @returns {Promise<void>}
 */
async function cancelarFlujo(from, context) {
  context.log(`[FlowManager] Usuario ${from} cancelo el flujo`);

  // Leer sesion fresca para obtener version (optimistic locking)
  const session = await db.getSessionFresh(from);

  try {
    await db.updateSession(
      from,
      ESTADO.CANCELADO,
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      'Flujo cancelado por el usuario',
      null,
      session.Version
    );
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      context.log(`[FlowManager] Conflicto de concurrencia al cancelar flujo de ${from}`);
      // Continuar - enviar mensaje de cancelacion de todas formas
    } else {
      throw error;
    }
  }

  // Enviar mensaje de despedida
  await whatsapp.sendText(from, MSG.GENERAL.GOODBYE);
  await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.GOODBYE, TIPO_CONTENIDO.TEXTO);
}

module.exports = {
  processSessionState,
  processButton,
  cancelarFlujo,
};
