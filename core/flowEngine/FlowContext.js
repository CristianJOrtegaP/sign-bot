/**
 * AC FIXBOT - FlowContext
 * Contexto inyectado a cada flujo con métodos helper
 * Elimina código repetitivo en los handlers
 *
 * @module core/flowEngine/FlowContext
 */

const whatsapp = require('../services/external/whatsappService');
const db = require('../services/storage/databaseService');
const metrics = require('../services/infrastructure/metricsService');
const { logger } = require('../services/infrastructure/errorHandler');
const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../bot/constants/sessionStates');

/**
 * @typedef {Object} FlowContextOptions
 * @property {string} from - Teléfono del usuario
 * @property {Object} session - Sesión actual
 * @property {Object} azureContext - Contexto de Azure Functions
 * @property {string} flujoNombre - Nombre del flujo para métricas
 */

/**
 * Contexto de ejecución para flujos
 * Proporciona métodos helper que automatizan tareas comunes
 */
class FlowContext {
  /**
   * @param {FlowContextOptions} options
   */
  constructor({ from, session, azureContext, flujoNombre }) {
    this.from = from;
    this.session = session;
    this.azureContext = azureContext;
    this.flujoNombre = flujoNombre;
    this._timer = null;
  }

  // ==============================================================
  // MÉTODOS DE RESPUESTA (envían + guardan + métricas)
  // ==============================================================

  /**
   * Envía un mensaje de texto y lo guarda automáticamente
   * @param {string} mensaje - Texto a enviar
   * @returns {Promise<void>}
   */
  async responder(mensaje) {
    await whatsapp.sendAndSaveText(this.from, mensaje);
    this._logAccion('responder', { longitud: mensaje.length });
  }

  /**
   * Envía mensaje con botones interactivos
   * @param {string} mensaje - Texto del mensaje
   * @param {Array<{id: string, title: string}>} botones - Botones a mostrar
   * @param {string} [header] - Encabezado opcional
   * @returns {Promise<void>}
   */
  async responderConBotones(mensaje, botones, header = '') {
    await whatsapp.sendAndSaveInteractive(this.from, header, mensaje, botones);
    this._logAccion('responderConBotones', { numBotones: botones.length });
  }

  /**
   * Envía mensaje con lista de opciones
   * @param {string} mensaje - Texto del mensaje
   * @param {string} textoBoton - Texto del botón para abrir lista
   * @param {Array<{id: string, title: string, description?: string}>} opciones
   * @param {string} [header] - Encabezado opcional
   * @returns {Promise<void>}
   */
  async responderConLista(mensaje, textoBoton, opciones, header = '') {
    await whatsapp.sendAndSaveList(this.from, header, mensaje, textoBoton, opciones);
    this._logAccion('responderConLista', { numOpciones: opciones.length });
  }

  // ==============================================================
  // MÉTODOS DE ESTADO
  // ==============================================================

  /**
   * Cambia el estado de la sesión
   * @param {string} nuevoEstado - Nuevo estado (de ESTADO.*)
   * @param {Object} [datos] - Datos a guardar en DatosTemp
   * @param {string} [motivo] - Motivo del cambio para logging
   * @returns {Promise<void>}
   */
  async cambiarEstado(nuevoEstado, datos = null, motivo = '') {
    await db.updateSession(
      this.from,
      nuevoEstado,
      datos,
      null,
      ORIGEN_ACCION.BOT,
      motivo || `Cambio a ${nuevoEstado}`
    );
    this._logAccion('cambiarEstado', { de: this.session.Estado, a: nuevoEstado });
  }

  /**
   * Finaliza el flujo (cambia a FINALIZADO)
   * @param {string} [motivo] - Motivo de finalización
   * @returns {Promise<void>}
   */
  async finalizar(motivo = 'Flujo completado') {
    await this.cambiarEstado(ESTADO.FINALIZADO, null, motivo);
  }

  /**
   * Cancela el flujo (cambia a CANCELADO)
   * @param {string} [motivo] - Motivo de cancelación
   * @returns {Promise<void>}
   */
  async cancelar(motivo = 'Cancelado por usuario') {
    await this.cambiarEstado(ESTADO.CANCELADO, null, motivo);
  }

  // ==============================================================
  // MÉTODOS DE DATOS
  // ==============================================================

  /**
   * Obtiene los datos temporales de la sesión (parseados)
   * @returns {Object}
   */
  getDatos() {
    if (!this.session.DatosTemp) {
      return {};
    }
    try {
      return JSON.parse(this.session.DatosTemp);
    } catch {
      return {};
    }
  }

  /**
   * Guarda un mensaje del usuario en BD
   * @param {string} mensaje - Mensaje a guardar
   * @param {string} [tipo] - Tipo de contenido
   * @returns {Promise<void>}
   */
  async guardarMensajeUsuario(mensaje, tipo = TIPO_CONTENIDO.TEXTO) {
    await db.saveMessage(this.from, TIPO_MENSAJE.USUARIO, mensaje, tipo);
  }

  // ==============================================================
  // MÉTODOS DE MÉTRICAS Y LOGGING
  // ==============================================================

  /**
   * Inicia un timer para medir duración
   * @param {string} [nombre] - Nombre de la métrica
   * @returns {Object} Timer que se puede terminar con .end()
   */
  iniciarTimer(nombre = null) {
    const timerName = nombre || `${this.flujoNombre}_duracion`;
    this._timer = metrics.startTimer(timerName);
    return this._timer;
  }

  /**
   * Termina el timer actual
   * @param {Object} [metadata] - Metadata adicional
   */
  terminarTimer(metadata = {}) {
    if (this._timer) {
      this._timer.end({ flujo: this.flujoNombre, ...metadata });
      this._timer = null;
    }
  }

  /**
   * Registra un error
   * @param {string} mensaje - Mensaje del error
   * @param {Error} [error] - Error original
   */
  registrarError(mensaje, error = null) {
    const errorMsg = error ? `${mensaje}: ${error.message}` : mensaje;
    metrics.recordError(`${this.flujoNombre}_error`, errorMsg);
    logger.error(`[${this.flujoNombre}] ${mensaje}`, error, { from: this.from });
  }

  /**
   * Log de información
   * @param {string} mensaje
   * @param {Object} [datos]
   */
  log(mensaje, datos = {}) {
    if (this.azureContext?.log) {
      this.azureContext.log(`[${this.flujoNombre}] ${mensaje}`, datos);
    }
    logger.info(`[${this.flujoNombre}] ${mensaje}`, { from: this.from, ...datos });
  }

  /**
   * Log de warning
   * @param {string} mensaje
   * @param {Object} [datos]
   */
  warn(mensaje, datos = {}) {
    logger.warn(`[${this.flujoNombre}] ${mensaje}`, { from: this.from, ...datos });
  }

  // ==============================================================
  // HELPERS PRIVADOS
  // ==============================================================

  /**
   * Log interno de acciones
   * @private
   */
  _logAccion(accion, datos = {}) {
    logger.debug(`[${this.flujoNombre}] ${accion}`, { from: this.from, ...datos });
  }
}

/**
 * Crea un contexto de flujo
 * @param {FlowContextOptions} options
 * @returns {FlowContext}
 */
function createFlowContext(options) {
  return new FlowContext(options);
}

module.exports = {
  FlowContext,
  createFlowContext,
};
