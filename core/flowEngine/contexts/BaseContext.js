/**
 * AC FIXBOT - BaseContext
 * Contexto base con métodos comunes para todos los tipos de flujos
 *
 * Proporciona inyección de dependencias para:
 * - Envío de mensajes (whatsapp)
 * - Gestión de sesión (db)
 * - Logging y métricas
 *
 * @module core/flowEngine/contexts/BaseContext
 */

const whatsapp = require('../../services/external/whatsappService');
const db = require('../../services/storage/databaseService');
const metricsService = require('../../services/infrastructure/metricsService');
const { logger } = require('../../services/infrastructure/errorHandler');
const { ORIGEN_ACCION } = require('../../../bot/constants/sessionStates');

/**
 * Contexto base para flujos de conversación
 * Inyecta dependencias y proporciona métodos unificados
 */
class BaseContext {
  /**
   * @param {string} from - Número de teléfono del usuario
   * @param {Object} session - Sesión actual del usuario
   * @param {Object} context - Contexto de Azure Functions
   * @param {Object} options - Opciones adicionales
   */
  constructor(from, session, context, options = {}) {
    this.from = from;
    this.session = session;
    this.context = context;
    this.flowName = options.flowName || 'unknown';
    this._timer = null;
    this._acciones = [];
  }

  // ==============================================================
  // MÉTODOS DE RESPUESTA (WhatsApp)
  // ==============================================================

  /**
   * Envía un mensaje de texto y lo guarda en BD
   * @param {string} mensaje - Texto a enviar
   */
  async responder(mensaje) {
    await whatsapp.sendAndSaveText(this.from, mensaje);
    this._logAccion('responder', { longitud: mensaje.length });
  }

  /**
   * Envía un mensaje interactivo con botones y lo guarda en BD
   * @param {string} titulo - Título del mensaje
   * @param {string} cuerpo - Cuerpo del mensaje
   * @param {Array} botones - Array de botones [{id, title}]
   */
  async responderConBotones(titulo, cuerpo, botones) {
    await whatsapp.sendAndSaveInteractive(this.from, titulo, cuerpo, botones);
    this._logAccion('responderConBotones', { titulo, numBotones: botones.length });
  }

  /**
   * Envía un mensaje con lista y lo guarda en BD
   * @param {string} titulo - Título del mensaje
   * @param {string} cuerpo - Cuerpo del mensaje
   * @param {string} textoBoton - Texto del botón de lista
   * @param {Array} filas - Array de filas [{id, title, description}]
   */
  async responderConLista(titulo, cuerpo, textoBoton, filas) {
    await whatsapp.sendAndSaveList(this.from, titulo, cuerpo, textoBoton, filas);
    this._logAccion('responderConLista', { titulo, numFilas: filas.length });
  }

  /**
   * Envía un mensaje de texto SIN guardar en BD
   * Usar solo para mensajes que no necesitan persistencia
   * @param {string} mensaje - Texto a enviar
   */
  async enviarTexto(mensaje) {
    await whatsapp.sendText(this.from, mensaje);
    this._logAccion('enviarTexto', { longitud: mensaje.length });
  }

  /**
   * Envía indicador de "escribiendo..."
   * @param {string} messageId - ID del mensaje al que responde
   */
  async mostrarEscribiendo(messageId) {
    if (messageId) {
      await whatsapp.sendTypingIndicator(this.from, messageId);
    }
  }

  // ==============================================================
  // MÉTODOS DE SESIÓN (Database)
  // ==============================================================

  /**
   * Cambia el estado de la sesión con optimistic locking
   * @param {string} nuevoEstado - Nuevo estado
   * @param {Object|null} datos - Datos temporales (se hace JSON.stringify)
   * @param {string} motivo - Motivo del cambio
   */
  async cambiarEstado(nuevoEstado, datos = null, motivo = '') {
    const version = this._getVersion();
    await db.updateSession(
      this.from,
      nuevoEstado,
      datos,
      null,
      ORIGEN_ACCION.BOT,
      motivo || `Cambio a ${nuevoEstado}`,
      null,
      version
    );
    this._incrementVersion();
    this._logAccion('cambiarEstado', { nuevoEstado, motivo });
  }

  /**
   * Actualiza solo los datos temporales sin cambiar estado (con optimistic locking)
   * @param {Object} datos - Nuevos datos temporales
   * @param {string} motivo - Motivo de la actualización
   */
  async actualizarDatos(datos, motivo = '') {
    const version = this._getVersion();
    await db.updateSession(
      this.from,
      this.session.Estado,
      datos,
      this.session.EquipoId,
      ORIGEN_ACCION.BOT,
      motivo || 'Actualización de datos',
      null,
      version
    );
    this._incrementVersion();
    this._logAccion('actualizarDatos', { motivo });
  }

  /**
   * Finaliza el flujo y resetea a INICIO (con optimistic locking)
   * @param {string} motivo - Motivo de finalización
   */
  async finalizar(motivo = 'Flujo completado') {
    const version = this._getVersion();
    await db.updateSession(
      this.from,
      'INICIO',
      null,
      null,
      ORIGEN_ACCION.BOT,
      motivo,
      null,
      version
    );
    this._incrementVersion();
    this._logAccion('finalizar', { motivo });
  }

  /**
   * Cancela el flujo actual (con optimistic locking)
   * @param {string} motivo - Motivo de cancelación
   */
  async cancelar(motivo = 'Flujo cancelado por usuario') {
    const version = this._getVersion();
    await db.updateSession(
      this.from,
      'CANCELADO',
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      motivo,
      null,
      version
    );
    this._incrementVersion();
    this._logAccion('cancelar', { motivo });
  }

  /**
   * Guarda un mensaje del usuario en BD
   * @param {string} mensaje - Contenido del mensaje
   * @param {string} tipo - Tipo de mensaje (TEXTO, IMAGEN, UBICACION, etc.)
   */
  async guardarMensajeUsuario(mensaje, tipo = 'TEXTO') {
    await db.saveMessage(this.from, 'U', mensaje, tipo);
  }

  /**
   * Actualiza la última actividad del usuario
   */
  async actualizarActividad() {
    await db.updateLastActivity(this.from);
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
      return typeof this.session.DatosTemp === 'string'
        ? JSON.parse(this.session.DatosTemp)
        : this.session.DatosTemp;
    } catch {
      return {};
    }
  }

  /**
   * Obtiene el estado actual de la sesión
   * @returns {string}
   */
  getEstado() {
    return this.session.Estado;
  }

  /**
   * Obtiene el ID del equipo asociado
   * @returns {string|null}
   */
  getEquipoId() {
    return this.session.EquipoId;
  }

  // ==============================================================
  // MÉTODOS DE LOGGING Y MÉTRICAS
  // ==============================================================

  /**
   * Log informativo
   * @param {string} mensaje - Mensaje a loggear
   */
  log(mensaje) {
    if (this.context?.log) {
      this.context.log(`[${this.flowName}] ${mensaje}`);
    }
  }

  /**
   * Log de advertencia
   * @param {string} mensaje - Mensaje de advertencia
   * @param {Object} [metadata] - Datos adicionales para logging
   */
  warn(mensaje, _metadata) {
    if (this.context?.log?.warn) {
      this.context.log.warn(`[${this.flowName}] ⚠️ ${mensaje}`);
    } else if (this.context?.log) {
      this.context.log(`[${this.flowName}] ⚠️ ${mensaje}`);
    }
  }

  /**
   * Log de error
   * @param {string} mensaje - Mensaje de error
   * @param {Error} error - Error object
   */
  error(mensaje, error) {
    if (this.context?.log?.error) {
      this.context.log.error(`[${this.flowName}] ❌ ${mensaje}: ${error?.message}`);
    } else if (this.context?.log) {
      this.context.log(`[${this.flowName}] ❌ ${mensaje}: ${error?.message}`);
    }
    logger.error(mensaje, error, { flow: this.flowName, from: this.from });
  }

  /**
   * Registra un error en el sistema de logging
   * @param {string} mensaje - Descripción del error
   * @param {Error} error - Objeto de error
   */
  registrarError(mensaje, error) {
    this.error(mensaje, error);
    metricsService.recordError(this.flowName, error?.message || mensaje);
  }

  /**
   * Inicia un timer para métricas
   * @param {string} operacion - Nombre de la operación
   * @returns {Object} Timer object con método end()
   */
  iniciarTimer(operacion) {
    this._timer = metricsService.startTimer(`${this.flowName}_${operacion}`);
    return this._timer;
  }

  /**
   * Termina el timer actual
   * @param {Object} labels - Labels adicionales para la métrica
   */
  terminarTimer(labels = {}) {
    if (this._timer?.end) {
      this._timer.end({ flow: this.flowName, ...labels });
    }
  }

  // ==============================================================
  // MÉTODOS INTERNOS
  // ==============================================================

  /**
   * Obtiene la versión actual de la sesión para optimistic locking
   * @returns {number|null} Versión actual o null si no hay sesión
   * @private
   */
  _getVersion() {
    return this.session?.Version ?? null;
  }

  /**
   * Incrementa la versión local después de un update exitoso
   * Mantiene la sesión en memoria sincronizada con BD
   * @private
   */
  _incrementVersion() {
    if (this.session && this.session.Version !== undefined && this.session.Version !== null) {
      this.session.Version++;
    }
  }

  /**
   * Log interno de acciones para debugging
   * @private
   */
  _logAccion(accion, detalles = {}) {
    this._acciones.push({ accion, detalles, timestamp: Date.now() });
    this.log(`${accion}: ${JSON.stringify(detalles)}`);
  }

  /**
   * Obtiene el historial de acciones ejecutadas
   * @returns {Array}
   */
  getAcciones() {
    return [...this._acciones];
  }
}

module.exports = BaseContext;
