/**
 * AC FIXBOT - Flujo de Encuesta de Satisfaccion (MODULARIZADO)
 * Maneja el proceso completo de encuesta con preguntas dinámicas
 *
 * Estructura modular:
 * - constants.js: Constantes de configuración (TTL de cache)
 * - helpers.js: Funciones auxiliares y mapeos
 * - cache.js: Sistema de cache en memoria
 * - flowActions.js: Acciones principales del flujo
 * - handlers.js: Handlers de estados
 * - buttonHandlers.js: Handlers de botones interactivos
 *
 * Optimizaciones v3 (Normalizado):
 * - Preguntas dinámicas desde catálogo PreguntasEncuesta
 * - Soporte para diferentes tipos de encuesta (CatTipoEncuesta)
 * - Estados normalizados (CatEstadoEncuesta)
 * - Respuestas en tabla normalizada (RespuestasEncuesta)
 * - Número de preguntas configurable por tipo
 * - Query única para obtener encuesta + pregunta actual
 * - Verificación de estado ANTES de enviar WhatsApp (evita race conditions)
 * - Operación atómica para guardar respuesta
 */

// Importar todos los módulos
const { CACHE_TTL_MS, PREGUNTAS_CACHE_TTL_MS } = require('./constants');
const { PREGUNTA_A_ESTADO, PREGUNTA_MENSAJES, extraerCalificacion } = require('./helpers');
const {
  encuestaCache,
  preguntasCache,
  getEncuestaCached,
  setEncuestaCache,
  clearEncuestaCache,
  updateCachePregunta,
  getPreguntasCached,
  getEncuestaCacheRaw,
} = require('./cache');
const {
  iniciarEncuesta,
  aceptarEncuesta,
  rechazarEncuesta,
  finalizarEncuesta,
} = require('./flowActions');
const {
  handleInvitacion,
  handleRespuestaPregunta,
  handleComentarioDecision,
  handleComentario,
} = require('./handlers');
const {
  handleBotonAceptar,
  handleBotonSalir,
  handleBotonRating,
  handleBotonSiComentario,
  handleBotonNoComentario,
} = require('./buttonHandlers');

// Re-exportar todas las funciones públicas
module.exports = {
  // Funciones principales del flujo
  iniciarEncuesta,

  // Handlers de estados
  handleInvitacion,
  handleRespuestaPregunta,
  handleComentarioDecision,
  handleComentario,

  // Handlers de botones
  handleBotonAceptar,
  handleBotonSalir,
  handleBotonRating,
  handleBotonSiComentario,
  handleBotonNoComentario,

  // Exportar para testing/debugging
  clearEncuestaCache,

  // Constantes (para testing/debugging)
  CACHE_TTL_MS,
  PREGUNTAS_CACHE_TTL_MS,

  // Mapeos (para testing/debugging)
  PREGUNTA_A_ESTADO,
  PREGUNTA_MENSAJES,

  // Helpers (para testing/debugging)
  extraerCalificacion,

  // Cache functions (para testing/debugging)
  getEncuestaCached,
  setEncuestaCache,
  updateCachePregunta,
  getPreguntasCached,
  getEncuestaCacheRaw,

  // Cache instances (para testing/debugging)
  encuestaCache,
  preguntasCache,

  // Flow actions (para testing/debugging)
  aceptarEncuesta,
  rechazarEncuesta,
  finalizarEncuesta,
};
