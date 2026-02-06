/**
 * AC FIXBOT - Handlers de Botones del Flujo de Encuesta
 * Maneja los clicks en botones interactivos de WhatsApp
 */

const { safeParseJSON } = require('../../../../core/utils/helpers');
const { getEncuestaCached } = require('./cache');
const { aceptarEncuesta, rechazarEncuesta } = require('./flowActions');
const { handleRespuestaPregunta, handleComentarioDecision } = require('./handlers');

/**
 * Handler para botón "Aceptar" de la invitación
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
 */
async function handleBotonAceptar(from, session, context) {
  const datosTemp = safeParseJSON(session.DatosTemp);
  let encuestaId = datosTemp?.encuestaId;

  if (!encuestaId) {
    const cached = await getEncuestaCached(from, context);
    if (cached) {
      encuestaId = cached.encuestaId;
    }
  }

  await aceptarEncuesta(from, encuestaId, datosTemp || {}, context);
}

/**
 * Handler para botón "Salir" de la invitación
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
 */
async function handleBotonSalir(from, session, context) {
  const datosTemp = safeParseJSON(session.DatosTemp);
  let encuestaId = datosTemp?.encuestaId;

  if (!encuestaId) {
    const cached = await getEncuestaCached(from, context);
    if (cached) {
      encuestaId = cached.encuestaId;
    }
  }

  await rechazarEncuesta(from, encuestaId, context);
}

/**
 * Handler para botones de rating (1, 3, 5)
 * @param {string} from - Teléfono del usuario
 * @param {number} rating - Calificación seleccionada
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
 */
async function handleBotonRating(from, rating, session, context) {
  context.log(`handleBotonRating - rating: ${rating}, estado: ${session?.Estado}`);
  await handleRespuestaPregunta(from, `btn_rating_${rating}`, session, context);
}

/**
 * Handler para botón "Sí" de comentario
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
 */
async function handleBotonSiComentario(from, session, context) {
  context?.log(`[handleBotonSiComentario] Botón SÍ presionado, estado actual: ${session?.Estado}`);
  await handleComentarioDecision(from, 'si', session, context);
  context?.log(`[handleBotonSiComentario] Completado`);
}

/**
 * Handler para botón "No" de comentario
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
 */
async function handleBotonNoComentario(from, session, context) {
  await handleComentarioDecision(from, 'no', session, context);
}

module.exports = {
  handleBotonAceptar,
  handleBotonSalir,
  handleBotonRating,
  handleBotonSiComentario,
  handleBotonNoComentario,
};
