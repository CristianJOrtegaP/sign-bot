/**
 * AC FIXBOT - Handler de Botones del Flujo Flexible
 * @module flows/modules/buttonHandler
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const { ORIGEN_ACCION } = require('../../../constants/sessionStates');
const fieldManager = require('../../../services/fieldManager');

// Importar funciones de otros módulos
const { cancelarFlujo } = require('./cancellation');
const { solicitarSiguienteCampo } = require('./fieldHandlers');
const { crearReporte } = require('./reportBuilder');
const {
  confirmarEquipoDetectado,
  rechazarEquipoDetectado,
  confirmarDatosAI,
  rechazarDatosAI,
} = require('./confirmations');

/**
 * Procesa respuesta de botón en flujo flexible
 * @param {string} from - Teléfono del usuario
 * @param {string} buttonId - ID del botón presionado
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto de Azure Function
 * @returns {Promise<boolean>} - true si el botón fue procesado
 */
async function procesarBoton(from, buttonId, session, context = null) {
  switch (buttonId) {
    case 'btn_cancelar':
    case 'cancelar':
      await cancelarFlujo(from, session, context);
      return true;

    case 'btn_confirmar_equipo':
      await confirmarEquipoDetectado(from, session, context);
      return true;

    case 'btn_rechazar_equipo':
      await rechazarEquipoDetectado(from, session, context);
      return true;

    case 'btn_confirmar':
    case 'confirmar': {
      // Confirmar el campo actual que requiere confirmación
      const datos = fieldManager.parseDatosTemp(session.DatosTemp);
      // Buscar campo con requiereConfirmacion
      for (const [nombre, campo] of Object.entries(datos.camposRequeridos)) {
        if (campo.requiereConfirmacion) {
          datos.camposRequeridos = fieldManager.confirmarCampo(datos.camposRequeridos, nombre);
          break;
        }
      }

      await db.updateSession(
        from,
        session.EstadoCodigo,
        datos,
        session.EquipoIdTemp,
        ORIGEN_ACCION.USUARIO,
        'Campo confirmado'
      );

      // Verificar si está completo
      if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
        await crearReporte(from, datos, session, context);
      } else {
        await solicitarSiguienteCampo(from, datos, context);
      }
      return true;
    }

    case 'btn_ubicacion_info':
      // El usuario presionó el botón de compartir ubicación
      await whatsapp.sendText(
        from,
        '📍 *Cómo compartir tu ubicación:*\n\n1. Presiona el ícono de 📎 (adjuntar)\n2. Selecciona "Ubicación"\n3. Elige "Enviar ubicación actual"\n\nO también puedes escribir la dirección manualmente.'
      );
      return true;

    case 'btn_confirmar_ai':
      await confirmarDatosAI(from, session, context);
      return true;

    case 'btn_rechazar_ai':
      await rechazarDatosAI(from, session, context);
      return true;

    default:
      return false;
  }
}

module.exports = {
  procesarBoton,
};
