/**
 * AC FIXBOT - FlowManager V4 (FASE 3)
 * Orquestador central de flujos de conversación
 * Integra FlowEngine para flujos migrados + legacy para flujos antiguos
 *
 * @module controllers/flows/FlowManager
 *
 * ## Arquitectura de Flujos (FASE 3 - FlowEngine)
 *
 * El FlowManager ahora usa el FlowEngine como primera opción.
 * Los flujos migrados usan inyección de dependencias y el patrón ctx.responder().
 * Los flujos legacy mantienen compatibilidad hacia atrás.
 *
 * ## Diagrama de Estados
 *
 * ```
 * INICIO
 *   ├─> REFRIGERADOR_ACTIVO ─> [campos en cualquier orden] ─> [REPORTE CREADO]
 *   │
 *   ├─> VEHICULO_ACTIVO ─> [campos en cualquier orden] ─> [REPORTE CREADO]
 *   │
 *   ├─> ENCUESTA_INVITACION ─> ... ─> [ENCUESTA COMPLETADA]
 *   │
 *   └─> CONSULTA_ESPERA_TICKET ─> [CONSULTA COMPLETADA]  (MIGRADO a FlowEngine)
 * ```
 *
 * ## Flujos Disponibles
 *
 * - **FlowEngine** (migrados): consultaFlow
 * - **flexibleFlowManager**: Reportes de refrigeración y vehículos (FASE 2b)
 * - **encuestaFlow**: Encuestas de satisfacción post-resolución
 */

const flexibleFlowManager = require('./flexibleFlowManager');
const encuestaFlow = require('./encuestaFlow');
const consultaEstadoFlow = require('./consultaEstadoFlow');
const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const MSG = require('../../constants/messages');
const { safeParseJSON: _safeParseJSON } = require('../../../core/utils/helpers');
const { logger } = require('../../../core/services/infrastructure/errorHandler');

// FlowEngine - nuevo sistema de flujos
const { registry, inicializarFlujos } = require('../../flows');

// Inicializar flujos del FlowEngine al cargar el módulo
let flowEngineInicializado = false;
function ensureFlowEngineInit() {
  if (!flowEngineInicializado) {
    inicializarFlujos();
    flowEngineInicializado = true;
  }
}
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  esEstadoEncuesta,
  esEstadoConsulta,
  esEstadoFlexible,
} = require('../../constants/sessionStates');

/**
 * @typedef {Object} StateHandlerConfig
 * @property {string|null} flow - Tipo de flujo (REFRIGERADOR, VEHICULO, ENCUESTA, CONSULTA, null)
 * @property {string} handler - Nombre del método handler a ejecutar
 */

/**
 * @typedef {Object} ButtonHandlerConfig
 * @property {string|null} flow - Tipo de flujo asociado al botón
 * @property {string} action - Nombre de la acción a ejecutar
 * @property {any} [params] - Parámetros adicionales (ej: rating value)
 */

/**
 * @typedef {Object} Session
 * @property {string} Estado - Estado actual de la sesión (de ESTADO.*)
 * @property {string|null} DatosTemp - JSON string con datos temporales del flujo
 * @property {string} Telefono - Número de teléfono del usuario
 */

// Tipos especiales para encuestas y consultas
const TIPO_ENCUESTA = 'ENCUESTA';
const TIPO_CONSULTA = 'CONSULTA';

/**
 * Mapeo de estados a flujos y handlers
 * FASE 2b: Solo estados de encuesta y consulta (los reportes usan flexibleFlowManager)
 *
 * @type {Object.<string, StateHandlerConfig>}
 */
const STATE_HANDLERS = {
  // Encuesta de satisfacción
  [ESTADO.ENCUESTA_INVITACION]: { flow: TIPO_ENCUESTA, handler: 'handleInvitacion' },
  [ESTADO.ENCUESTA_PREGUNTA_1]: { flow: TIPO_ENCUESTA, handler: 'handleRespuestaPregunta' },
  [ESTADO.ENCUESTA_PREGUNTA_2]: { flow: TIPO_ENCUESTA, handler: 'handleRespuestaPregunta' },
  [ESTADO.ENCUESTA_PREGUNTA_3]: { flow: TIPO_ENCUESTA, handler: 'handleRespuestaPregunta' },
  [ESTADO.ENCUESTA_PREGUNTA_4]: { flow: TIPO_ENCUESTA, handler: 'handleRespuestaPregunta' },
  [ESTADO.ENCUESTA_PREGUNTA_5]: { flow: TIPO_ENCUESTA, handler: 'handleRespuestaPregunta' },
  [ESTADO.ENCUESTA_PREGUNTA_6]: { flow: TIPO_ENCUESTA, handler: 'handleRespuestaPregunta' },
  [ESTADO.ENCUESTA_COMENTARIO]: { flow: TIPO_ENCUESTA, handler: 'handleComentarioDecision' },
  [ESTADO.ENCUESTA_ESPERA_COMENTARIO]: { flow: TIPO_ENCUESTA, handler: 'handleComentario' },

  // Consulta de tickets
  [ESTADO.CONSULTA_ESPERA_TICKET]: { flow: TIPO_CONSULTA, handler: 'handleTicketInput' },
};

/**
 * Mapeo de botones a acciones
 * FASE 2b: Reportes usan flexibleFlowManager
 */
const BUTTON_HANDLERS = {
  // Reportes - usan flexibleFlowManager
  btn_tipo_refrigerador: { flow: TIPO_REPORTE.REFRIGERADOR, action: 'iniciarFlujoFlexible' },
  btn_tipo_vehiculo: { flow: TIPO_REPORTE.VEHICULO, action: 'iniciarFlujoFlexible' },

  // Consulta de tickets
  btn_consultar_ticket: { flow: TIPO_CONSULTA, action: 'iniciarFlujo' },

  // Botones de flujo flexible
  btn_confirmar_datos: { flow: 'FLEXIBLE', action: 'confirmarDatos' },
  btn_modificar_datos: { flow: 'FLEXIBLE', action: 'modificarDatos' },
  btn_cancelar: { flow: null, action: 'cancelarFlujo' },

  // Botones de confirmación de equipo (OCR)
  btn_confirmar_equipo: { flow: 'FLEXIBLE', action: 'confirmarEquipo' },
  btn_rechazar_equipo: { flow: 'FLEXIBLE', action: 'rechazarEquipo' },

  // Botones de confirmación de AI Vision
  btn_confirmar_ai: { flow: 'FLEXIBLE', action: 'confirmarAI' },
  btn_rechazar_ai: { flow: 'FLEXIBLE', action: 'rechazarAI' },

  // Encuesta
  btn_encuesta_aceptar: { flow: TIPO_ENCUESTA, action: 'handleBotonAceptar' },
  btn_encuesta_salir: { flow: TIPO_ENCUESTA, action: 'handleBotonSalir' },
  btn_rating_1: { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 1 },
  btn_rating_2: { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 2 },
  btn_rating_3: { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 3 },
  btn_rating_4: { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 4 },
  btn_rating_5: { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 5 },
  btn_si_comentario: { flow: TIPO_ENCUESTA, action: 'handleBotonSiComentario' },
  btn_no_comentario: { flow: TIPO_ENCUESTA, action: 'handleBotonNoComentario' },
};

/**
 * Obtiene el flujo según el tipo
 * FASE 2b: Solo encuesta y consulta tienen flujos separados
 */
function getFlow(tipoReporte) {
  if (tipoReporte === TIPO_ENCUESTA) {
    return encuestaFlow;
  }
  if (tipoReporte === TIPO_CONSULTA) {
    return consultaEstadoFlow;
  }
  return null;
}

/**
 * Determina el tipo de reporte basado en el estado
 */
function getTipoReportePorEstado(estado) {
  if (esEstadoFlexible(estado)) {
    return estado === ESTADO.REFRIGERADOR_ACTIVO
      ? TIPO_REPORTE.REFRIGERADOR
      : TIPO_REPORTE.VEHICULO;
  }
  if (esEstadoEncuesta(estado)) {
    return TIPO_ENCUESTA;
  }
  if (esEstadoConsulta(estado)) {
    return TIPO_CONSULTA;
  }
  return null;
}

/**
 * Procesa un mensaje según el estado actual de la sesión del usuario
 * FASE 3: Primero intenta FlowEngine, luego legacy
 * @param {string} from - Número de teléfono del usuario (formato E.164)
 * @param {string} text - Texto del mensaje o datos de ubicación
 * @param {Object} session - Sesión actual del usuario con Estado y DatosTemp
 * @param {Object} context - Contexto de Azure Functions para logging
 * @returns {Promise<boolean>} - true si el mensaje fue procesado por un handler
 */
async function processSessionState(from, text, session, context) {
  ensureFlowEngineInit();

  // Estados flexibles se manejan en messageHandler con flexibleFlowManager
  if (esEstadoFlexible(session.Estado)) {
    context.log(
      `[FlowManager] Estado flexible ${session.Estado} - delegando a flexibleFlowManager`
    );
    return false;
  }

  // FASE 3: Intentar primero con FlowEngine (flujos migrados)
  if (registry.tieneHandlerParaEstado(session.Estado)) {
    context.log(`[FlowManager] Usando FlowEngine para estado: ${session.Estado}`);
    try {
      const procesado = await registry.procesarMensaje(from, text, session, context);
      if (procesado) {
        context.log(`[FlowManager] FlowEngine procesó el mensaje exitosamente`);
        return true;
      }
    } catch (error) {
      context.log(`❌ [FlowManager] Error en FlowEngine: ${error.message}`);
      logger.error('Error en FlowEngine', error, { estado: session.Estado });
      throw error;
    }
  }

  // Legacy: Usar sistema antiguo para flujos no migrados
  const stateConfig = STATE_HANDLERS[session.Estado];
  if (!stateConfig || !stateConfig.handler) {
    context.log(`[FlowManager] No hay handler configurado para estado: ${session.Estado}`);
    return false;
  }

  context.log(`[FlowManager] Estado: ${session.Estado}, handler legacy: ${stateConfig.handler}`);

  const flow = getFlow(stateConfig.flow);
  if (!flow) {
    context.log(`⚠️ No se encontró flujo para: ${stateConfig.flow}`);
    return false;
  }

  const handler = flow[stateConfig.handler];

  if (typeof handler !== 'function') {
    context.log(`⚠️ Handler no encontrado: ${stateConfig.handler}`);
    return false;
  }

  try {
    context.log(`[FlowManager] Ejecutando handler legacy: ${stateConfig.handler}`);
    await handler(from, text, session, context);
    context.log(`[FlowManager] Handler ${stateConfig.handler} completado`);
    return true;
  } catch (error) {
    context.log(`❌ [FlowManager] Error en handler ${stateConfig.handler}: ${error.message}`);
    logger.error(`Error en handler ${stateConfig.handler}`, error, {
      handler: stateConfig.handler,
    });
    throw error;
  }
}

/**
 * Procesa un botón presionado
 * FASE 3: Primero intenta FlowEngine, luego legacy
 * @returns {boolean} true si el botón fue procesado
 */
async function processButton(from, buttonId, session, context) {
  ensureFlowEngineInit();

  // FASE 3: Intentar primero con FlowEngine (flujos migrados)
  const flowEngineHandler = registry.obtenerHandlerBoton(buttonId);
  if (flowEngineHandler) {
    context.log(`[FlowManager] Usando FlowEngine para botón: ${buttonId}`);
    try {
      const procesado = await registry.procesarBoton(from, buttonId, session, context);
      if (procesado) {
        context.log(`[FlowManager] FlowEngine procesó el botón exitosamente`);
        return true;
      }
    } catch (error) {
      context.log(`❌ [FlowManager] Error en FlowEngine para botón: ${error.message}`);
      logger.error('Error en FlowEngine para botón', error, { buttonId });
      throw error;
    }
  }

  // Legacy: Sistema antiguo
  const buttonConfig = BUTTON_HANDLERS[buttonId];
  if (!buttonConfig) {
    context.log(`⚠️ Botón no registrado: ${buttonId}`);
    return false;
  }

  // Caso especial: botón cancelar
  if (buttonConfig.action === 'cancelarFlujo') {
    await cancelarFlujo(from, context);
    return true;
  }

  // FASE 2b: Iniciar flujo flexible para reportes
  if (buttonConfig.action === 'iniciarFlujoFlexible') {
    context.log(`[FlowManager] Iniciando flujo flexible para ${buttonConfig.flow}`);
    await flexibleFlowManager.iniciarFlujo(from, buttonConfig.flow, {}, context);
    return true;
  }

  // Botones de flujo flexible (confirmar/modificar datos)
  if (buttonConfig.flow === 'FLEXIBLE') {
    context.log(`[FlowManager] Procesando botón flexible: ${buttonConfig.action}`);
    return flexibleFlowManager.procesarBoton(from, buttonId, session, context);
  }

  // Flujos de encuesta y consulta (legacy)
  const flow = getFlow(buttonConfig.flow);
  if (!flow) {
    context.log(`⚠️ No se encontró flujo para: ${buttonConfig.flow}`);
    return false;
  }

  const action = flow[buttonConfig.action];

  if (typeof action !== 'function') {
    context.log(`⚠️ Acción no encontrada: ${buttonConfig.action}`);
    return false;
  }

  if (buttonConfig.action === 'iniciarFlujo') {
    await action(from, context);
  } else if (buttonConfig.action === 'handleBotonRating') {
    // Caso especial: rating con parámetro
    await action(from, buttonConfig.params, session, context);
  } else {
    await action(from, session, context);
  }

  return true;
}

/**
 * Cancela el flujo de conversación actual
 * Cambia la sesión a estado CANCELADO y envía mensaje de confirmación
 * @param {string} from - Número de teléfono del usuario (formato E.164)
 * @param {Object} context - Contexto de Azure Functions para logging
 * @returns {Promise<void>}
 */
async function cancelarFlujo(from, context) {
  context.log(`🚫 Usuario ${from} canceló el flujo`);

  // Cambiar a estado CANCELADO (no INICIO)
  await db.updateSession(
    from,
    ESTADO.CANCELADO,
    null,
    null,
    ORIGEN_ACCION.USUARIO,
    'Flujo cancelado por el usuario'
  );

  // Enviar mensaje de despedida
  await whatsapp.sendText(from, MSG.GENERAL.CANCELLED);
  await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.CANCELLED, TIPO_CONTENIDO.TEXTO);
}

/**
 * Inicia un flujo con datos extraídos por IA
 * FASE 2b: Usa flexibleFlowManager
 * @param {string} from - Número de teléfono
 * @param {string} tipoEquipo - REFRIGERADOR o VEHICULO
 * @param {Object} datosExtraidos - Datos extraídos por IA
 * @param {string} datosExtraidos.problema - Descripción del problema
 * @param {string} datosExtraidos.codigo_sap - Código SAP del equipo (opcional)
 * @param {string} datosExtraidos.numero_empleado - Número de empleado para vehículos (opcional)
 * @param {boolean} isFirstMessage - Si es el primer mensaje del usuario
 * @param {Object} context - Contexto de la función
 */
async function iniciarFlujoConDatos(from, tipoEquipo, datosExtraidos, isFirstMessage, context) {
  // Convertir datos extraídos al formato de campos para flexibleFlowManager
  const camposIniciales = {};

  if (datosExtraidos.codigo_sap) {
    camposIniciales.codigoSAP = {
      valor: datosExtraidos.codigo_sap,
      confianza: 80,
      fuente: 'ai',
    };
  }

  if (datosExtraidos.numero_empleado) {
    camposIniciales.numeroEmpleado = {
      valor: datosExtraidos.numero_empleado,
      confianza: 80,
      fuente: 'ai',
    };
  }

  if (datosExtraidos.problema) {
    camposIniciales.problema = {
      valor: datosExtraidos.problema,
      confianza: 70,
      fuente: 'ai',
    };
  }

  if (datosExtraidos.ubicacion) {
    camposIniciales.ubicacion = {
      valor: datosExtraidos.ubicacion,
      confianza: 80,
      fuente: 'ai',
    };
  }

  await flexibleFlowManager.iniciarFlujo(from, tipoEquipo, camposIniciales, context);
}

module.exports = {
  processSessionState,
  processButton,
  iniciarFlujoConDatos,
  cancelarFlujo,
  getFlow,
  getTipoReportePorEstado,
};
