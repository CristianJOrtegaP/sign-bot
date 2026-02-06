/**
 * AC FIXBOT - Flujo de Encuesta de Satisfaccion
 *
 * Este archivo ha sido refactorizado en una estructura modular.
 * Ver carpeta ./encuestaFlow/ para la implementación:
 *
 * - constants.js: Constantes de configuración (TTL de cache)
 * - helpers.js: Funciones auxiliares y mapeos
 * - cache.js: Sistema de cache en memoria
 * - flowActions.js: Acciones principales del flujo
 * - handlers.js: Handlers de estados
 * - buttonHandlers.js: Handlers de botones interactivos
 * - index.js: Re-exporta todas las funciones públicas
 */

module.exports = require('./encuestaFlow/');
