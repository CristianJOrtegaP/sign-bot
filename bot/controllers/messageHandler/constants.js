/**
 * AC FIXBOT - Constantes de MessageHandler
 * Botones de encuesta y flujo flexible
 */

// Botones de encuesta que NO deben reactivar la sesion a INICIO
const ENCUESTA_BUTTONS = new Set([
  'btn_encuesta_aceptar',
  'btn_encuesta_salir',
  'btn_rating_1',
  'btn_rating_2',
  'btn_rating_3',
  'btn_rating_4',
  'btn_rating_5',
  'btn_si_comentario',
  'btn_no_comentario',
]);

// Botones de flujo flexible que NO deben reactivar la sesion a INICIO
// Estos botones requieren los datos guardados en la sesión
const FLEXIBLE_BUTTONS = new Set([
  'btn_confirmar_ai',
  'btn_rechazar_ai',
  'btn_confirmar_equipo',
  'btn_rechazar_equipo',
  'btn_confirmar_datos',
  'btn_modificar_datos',
  'btn_ubicacion_info', // Botón para solicitar ubicación en flujo de vehículos
]);

module.exports = {
  ENCUESTA_BUTTONS,
  FLEXIBLE_BUTTONS,
};
