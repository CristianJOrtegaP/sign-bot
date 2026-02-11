/**
 * SIGN BOT - Constantes de MessageHandler
 * Botones de firma y consulta de documentos
 */

// Botones de firma que NO deben reactivar la sesion a INICIO
// Estos botones se procesan dentro de flujos activos
const FIRMA_BUTTONS = new Set(['btn_rechazar', 'btn_confirmar_rechazo', 'btn_cancelar_rechazo']);

// Botones de consulta de documentos
const CONSULTA_BUTTONS = new Set(['btn_ver_documentos', 'btn_volver']);

module.exports = {
  FIRMA_BUTTONS,
  CONSULTA_BUTTONS,
};
