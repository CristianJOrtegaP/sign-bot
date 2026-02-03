/**
 * AC FIXBOT - FlowManager V2
 * Orquestador central de flujos de conversación
 * Compatible con nuevos estados normalizados
 *
 * @module controllers/flows/FlowManager
 *
 * ## Arquitectura de Flujos
 *
 * El FlowManager implementa una máquina de estados finita (FSM) para
 * manejar las conversaciones de WhatsApp. Cada usuario tiene una sesión
 * con un estado actual, y el FlowManager enruta los mensajes al handler
 * apropiado según ese estado.
 *
 * ## Diagrama de Estados
 *
 * ```
 * INICIO
 *   ├─> REFRI_ESPERA_SAP ─> REFRI_CONFIRMAR_EQUIPO ─> REFRI_ESPERA_DESCRIPCION ─> [REPORTE CREADO]
 *   │
 *   ├─> VEHICULO_ESPERA_EMPLEADO ─> VEHICULO_ESPERA_SAP ─> VEHICULO_ESPERA_DESCRIPCION
 *   │                                                            ↓
 *   │                                              VEHICULO_ESPERA_UBICACION ─> [REPORTE CREADO]
 *   │
 *   └─> ENCUESTA_INVITACION ─> ENCUESTA_PREGUNTA_1 ─> ... ─> ENCUESTA_PREGUNTA_6
 *                                                                    ↓
 *                                              ENCUESTA_COMENTARIO ─> [ENCUESTA COMPLETADA]
 * ```
 *
 * ## Flujos Disponibles
 *
 * - **refrigeradorFlow**: Reportes de equipos de refrigeración
 * - **vehiculoFlow**: Reportes de vehículos de distribución
 * - **encuestaFlow**: Encuestas de satisfacción post-resolución
 *
 * @example
 * // Procesar mensaje según estado actual
 * const handled = await FlowManager.processSessionState(
 *     '5218112345678',
 *     'Mi refrigerador no enfría',
 *     session,
 *     context
 * );
 *
 * // Procesar botón interactivo
 * const handled = await FlowManager.processButton(
 *     '5218112345678',
 *     'btn_tipo_refrigerador',
 *     session,
 *     context
 * );
 */

const refrigeradorFlow = require('./refrigeradorFlow');
const vehiculoFlow = require('./vehiculoFlow');
const encuestaFlow = require('./encuestaFlow');
const consultaEstadoFlow = require('./consultaEstadoFlow');
const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const MSG = require('../../constants/messages');
const { safeParseJSON } = require('../../../core/utils/helpers');
const { logger } = require('../../../core/services/infrastructure/errorHandler');
const {
    ESTADO,
    TIPO_REPORTE,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO,
    esEstadoRefrigerador,
    esEstadoVehiculo,
    esEstadoEncuesta,
    esEstadoConsulta
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
 * Usando nuevos estados con prefijos
 *
 * @type {Object.<string, StateHandlerConfig>}
 */
const STATE_HANDLERS = {
    // Refrigerador
    [ESTADO.REFRI_ESPERA_SAP]: { flow: TIPO_REPORTE.REFRIGERADOR, handler: 'handleSAPInput' },
    [ESTADO.REFRI_CONFIRMAR_EQUIPO]: { flow: TIPO_REPORTE.REFRIGERADOR, handler: 'handleConfirmacion' },
    [ESTADO.REFRI_ESPERA_DESCRIPCION]: { flow: TIPO_REPORTE.REFRIGERADOR, handler: 'crearReporte' },

    // Vehículo
    [ESTADO.VEHICULO_ESPERA_EMPLEADO]: { flow: TIPO_REPORTE.VEHICULO, handler: 'handleNumeroEmpleado' },
    [ESTADO.VEHICULO_ESPERA_SAP]: { flow: TIPO_REPORTE.VEHICULO, handler: 'handleSAPVehiculo' },
    [ESTADO.VEHICULO_ESPERA_DESCRIPCION]: { flow: TIPO_REPORTE.VEHICULO, handler: 'handleDescripcion' },
    [ESTADO.VEHICULO_ESPERA_UBICACION]: { flow: TIPO_REPORTE.VEHICULO, handler: 'handleUbicacion' },
    [ESTADO.VEHICULO_CONFIRMAR_DATOS_AI]: { flow: TIPO_REPORTE.VEHICULO, handler: 'handleConfirmacionDatosAI' },

    // Estados legacy (compatibilidad durante transición)
    'ESPERA_SAP': { flow: TIPO_REPORTE.REFRIGERADOR, handler: 'handleSAPInput' },
    'CONFIRMAR_EQUIPO': { flow: TIPO_REPORTE.REFRIGERADOR, handler: 'handleConfirmacion' },
    'ESPERA_DESCRIPCION': { flow: null, handler: 'crearReporte' },
    'ESPERA_NUMERO_EMPLEADO': { flow: TIPO_REPORTE.VEHICULO, handler: 'handleNumeroEmpleado' },
    'ESPERA_SAP_VEHICULO': { flow: TIPO_REPORTE.VEHICULO, handler: 'handleSAPVehiculo' },

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
    [ESTADO.CONSULTA_ESPERA_TICKET]: { flow: TIPO_CONSULTA, handler: 'handleTicketInput' }
};

/**
 * Mapeo de botones a acciones
 */
const BUTTON_HANDLERS = {
    'btn_tipo_refrigerador': { flow: TIPO_REPORTE.REFRIGERADOR, action: 'iniciarFlujo' },
    'btn_tipo_vehiculo': { flow: TIPO_REPORTE.VEHICULO, action: 'iniciarFlujo' },
    'btn_consultar_ticket': { flow: TIPO_CONSULTA, action: 'iniciarFlujo' },
    'btn_confirmar_equipo': { flow: TIPO_REPORTE.REFRIGERADOR, action: 'confirmarEquipo' },
    'btn_corregir_equipo': { flow: TIPO_REPORTE.REFRIGERADOR, action: 'corregirEquipo' },
    'btn_cancelar': { flow: null, action: 'cancelarFlujo' },

    // Encuesta
    'btn_encuesta_aceptar': { flow: TIPO_ENCUESTA, action: 'handleBotonAceptar' },
    'btn_encuesta_salir': { flow: TIPO_ENCUESTA, action: 'handleBotonSalir' },
    'btn_rating_1': { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 1 },
    'btn_rating_2': { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 2 },
    'btn_rating_3': { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 3 },
    'btn_rating_4': { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 4 },
    'btn_rating_5': { flow: TIPO_ENCUESTA, action: 'handleBotonRating', params: 5 },
    'btn_si_comentario': { flow: TIPO_ENCUESTA, action: 'handleBotonSiComentario' },
    'btn_no_comentario': { flow: TIPO_ENCUESTA, action: 'handleBotonNoComentario' }
};

/**
 * Obtiene el flujo según el tipo
 */
function getFlow(tipoReporte) {
    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {return refrigeradorFlow;}
    if (tipoReporte === TIPO_REPORTE.VEHICULO) {return vehiculoFlow;}
    if (tipoReporte === TIPO_ENCUESTA) {return encuestaFlow;}
    if (tipoReporte === TIPO_CONSULTA) {return consultaEstadoFlow;}
    return vehiculoFlow; // default
}

/**
 * Determina el tipo de reporte basado en el estado
 */
function getTipoReportePorEstado(estado) {
    if (esEstadoRefrigerador(estado)) {return TIPO_REPORTE.REFRIGERADOR;}
    if (esEstadoVehiculo(estado)) {return TIPO_REPORTE.VEHICULO;}
    if (esEstadoEncuesta(estado)) {return TIPO_ENCUESTA;}
    if (esEstadoConsulta(estado)) {return TIPO_CONSULTA;}
    return null;
}

/**
 * Procesa un mensaje según el estado actual de la sesión del usuario
 * Enruta el mensaje al handler apropiado según el estado de la máquina de estados
 * @param {string} from - Número de teléfono del usuario (formato E.164)
 * @param {string} text - Texto del mensaje o datos de ubicación
 * @param {Object} session - Sesión actual del usuario con Estado y DatosTemp
 * @param {Object} context - Contexto de Azure Functions para logging
 * @returns {Promise<boolean>} - true si el mensaje fue procesado por un handler
 */
async function processSessionState(from, text, session, context) {
    const stateConfig = STATE_HANDLERS[session.Estado];
    if (!stateConfig || !stateConfig.handler) {
        context.log(`[FlowManager] No hay handler configurado para estado: ${session.Estado}`);
        return false;
    }

    context.log(`[FlowManager] Estado: ${session.Estado}, handler configurado: ${stateConfig.handler}`);

    // Determinar el flujo
    let flowType = stateConfig.flow;

    // Si no hay flujo definido en el estado, intentar determinar por el estado o datosTemp
    if (!flowType) {
        flowType = getTipoReportePorEstado(session.Estado);

        if (!flowType && session.DatosTemp) {
            const datosTemp = safeParseJSON(session.DatosTemp);
            flowType = datosTemp?.tipoReporte;
        }
    }

    if (!flowType) {
        context.log(`⚠️ No se pudo determinar el flujo para estado: ${session.Estado}`);
        return false;
    }

    context.log(`[FlowManager] Flujo determinado: ${flowType}`);

    const flow = getFlow(flowType);
    const handler = flow[stateConfig.handler];

    if (typeof handler !== 'function') {
        context.log(`⚠️ Handler no encontrado: ${stateConfig.handler}`);
        return false;
    }

    try {
        context.log(`[FlowManager] Ejecutando handler: ${stateConfig.handler}`);
        await handler(from, text, session, context);
        context.log(`[FlowManager] Handler ${stateConfig.handler} completado`);
        return true;
    } catch (error) {
        context.log(`❌ [FlowManager] Error en handler ${stateConfig.handler}: ${error.message}`);
        logger.error(`Error en handler ${stateConfig.handler}`, error, { handler: stateConfig.handler });
        throw error;
    }
}

/**
 * Procesa un botón presionado
 * @returns {boolean} true si el botón fue procesado
 */
async function processButton(from, buttonId, session, context) {
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

    const flow = getFlow(buttonConfig.flow);
    const action = flow[buttonConfig.action];

    if (typeof action !== 'function') {
        context.log(`⚠️ Acción no encontrada: ${buttonConfig.action}`);
        return false;
    }

    if (buttonConfig.action === 'iniciarFlujo') {
        await action(from);
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
    const flow = getFlow(tipoEquipo);
    await flow.iniciarFlujoConDatos(from, datosExtraidos, isFirstMessage, context);
}

module.exports = {
    processSessionState,
    processButton,
    iniciarFlujoConDatos,
    cancelarFlujo,
    getFlow,
    getTipoReportePorEstado
};
