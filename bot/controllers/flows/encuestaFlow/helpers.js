/**
 * AC FIXBOT - Helpers del Flujo de Encuesta
 * Funciones auxiliares y mapeos de estados
 */

const { ENCUESTA: MSG } = require('../../../constants/messages');
const { ESTADO } = require('../../../constants/sessionStates');

// ============================================
// MAPEOS DE ESTADOS (para compatibilidad con estados de sesión)
// ============================================

/**
 * Mapeo de número de pregunta a estado de sesión
 * Usado para actualizar el estado de la sesión según la pregunta actual
 */
const PREGUNTA_A_ESTADO = {
  1: ESTADO.ENCUESTA_PREGUNTA_1,
  2: ESTADO.ENCUESTA_PREGUNTA_2,
  3: ESTADO.ENCUESTA_PREGUNTA_3,
  4: ESTADO.ENCUESTA_PREGUNTA_4,
  5: ESTADO.ENCUESTA_PREGUNTA_5,
  6: ESTADO.ENCUESTA_PREGUNTA_6,
};

/**
 * Mensajes de preguntas de fallback (cuando no hay preguntas en catálogo)
 * Estos mensajes se usan solo si la tabla PreguntasEncuesta está vacía
 */
const PREGUNTA_MENSAJES = {
  1: MSG.PREGUNTA_1,
  2: MSG.PREGUNTA_2,
  3: MSG.PREGUNTA_3,
  4: MSG.PREGUNTA_4,
  5: MSG.PREGUNTA_5,
  6: MSG.PREGUNTA_6,
};

/**
 * Extrae calificación numérica del input
 * @param {string} input - Input del usuario
 * @returns {number|null} - Calificación del 1 al 5 o null si no es válida
 */
function extraerCalificacion(input) {
  const buttonMatch = input.match(/btn_rating_(\d)/);
  if (buttonMatch) {
    return parseInt(buttonMatch[1], 10);
  }

  const numero = parseInt(input.trim(), 10);
  if (numero >= 1 && numero <= 5) {
    return numero;
  }

  const palabras = {
    pesimo: 1,
    'muy malo': 1,
    terrible: 1,
    malo: 2,
    mal: 2,
    regular: 3,
    normal: 3,
    ok: 3,
    bueno: 4,
    bien: 4,
    excelente: 5,
    'muy bueno': 5,
    perfecto: 5,
  };

  return palabras[input.toLowerCase().trim()] || null;
}

module.exports = {
  PREGUNTA_A_ESTADO,
  PREGUNTA_MENSAJES,
  extraerCalificacion,
};
