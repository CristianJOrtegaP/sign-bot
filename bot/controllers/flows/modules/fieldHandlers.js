/**
 * AC FIXBOT - Manejo de Campos del Flujo Flexible
 * Funciones para solicitar y manejar campos del formulario
 * @module flows/modules/fieldHandlers
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');
const fieldManager = require('../../../services/fieldManager');

/**
 * Genera mensaje para solicitar descripción del problema
 * @param {Object} datosTemp - DatosTemp con tipoReporte y datosEquipo
 * @returns {string}
 */
function getMensajeProblema(datosTemp) {
  const tipoEquipo =
    datosTemp.tipoReporte === TIPO_REPORTE.REFRIGERADOR ? 'refrigerador' : 'vehículo';

  if (datosTemp.datosEquipo) {
    const equipo = datosTemp.datosEquipo;
    return `✅ Equipo encontrado: ${equipo.Modelo || equipo.TipoEquipo || 'Equipo'}\n\nAhora, describe el problema que presenta el ${tipoEquipo}:`;
  }

  return `Por favor, describe el problema que presenta el ${tipoEquipo}:`;
}

/**
 * Obtiene el título del flujo según el tipo de reporte
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @returns {string}
 */
function getTituloFlujo(tipoReporte) {
  return tipoReporte === TIPO_REPORTE.REFRIGERADOR
    ? MSG.REFRIGERADOR.TITLE
    : MSG.VEHICULO?.TITLE || '🚗 Reporte de Vehículo';
}

/**
 * Solicita el siguiente campo faltante al usuario
 * @param {string} from - Teléfono del usuario
 * @param {Object} datosTemp - DatosTemp actual
 * @param {Object} context - Contexto de Azure Function
 */
async function solicitarSiguienteCampo(from, datosTemp, context = null) {
  const siguienteCampo = fieldManager.getSiguienteCampoFaltante(
    datosTemp.camposRequeridos,
    datosTemp.tipoReporte
  );

  if (!siguienteCampo) {
    logger.warn(`[FlexibleFlow] solicitarSiguienteCampo llamado sin campos faltantes`);
    return;
  }

  const completitud = fieldManager.calcularCompletitud(
    datosTemp.camposRequeridos,
    datosTemp.tipoReporte
  );

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Solicitando campo: ${siguienteCampo.nombre}, completitud: ${completitud.porcentaje}%`
    );
  }

  // Construir mensaje según el campo faltante
  let mensaje;
  const botones = [MSG.BUTTONS.CANCELAR];

  switch (siguienteCampo.nombre) {
    case 'codigoSAP':
      mensaje =
        datosTemp.tipoReporte === TIPO_REPORTE.REFRIGERADOR
          ? MSG.REFRIGERADOR.REQUEST_SAP_BODY
          : MSG.VEHICULO?.REQUEST_SAP_BODY || 'Por favor, proporciona el código SAP del vehículo:';
      break;

    case 'numeroEmpleado':
      mensaje =
        MSG.VEHICULO?.REQUEST_EMPLEADO_BODY || 'Por favor, proporciona tu número de empleado:';
      break;

    case 'problema':
      mensaje = getMensajeProblema(datosTemp);
      break;

    case 'ubicacion':
      mensaje =
        MSG.VEHICULO?.REQUEST_UBICACION_BODY ||
        '📍 Por favor, comparte tu ubicación o escribe la dirección donde se encuentra el vehículo:\n\n*Cómo compartir ubicación:*\n1. Presiona 📎 (adjuntar)\n2. Selecciona "Ubicación"\n3. Elige "Enviar ubicación actual"';
      break;

    default:
      mensaje = `Por favor, proporciona: ${siguienteCampo.descripcion}`;
  }

  // Agregar indicador de progreso
  const progresoMsg = `\n\n📊 Progreso: ${completitud.completados}/${completitud.total} campos`;
  mensaje += progresoMsg;

  // Guardar qué campo se está solicitando para contexto
  datosTemp.campoSolicitado = siguienteCampo.nombre;

  if (context?.log) {
    context.log(
      `[FlexibleFlow] 📝 Guardando campoSolicitado=${datosTemp.campoSolicitado} en sesión`
    );
  }

  // Actualizar sesión con el campo solicitado
  const estadoActual =
    datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO
      ? ESTADO.VEHICULO_ACTIVO
      : ESTADO.REFRIGERADOR_ACTIVO;

  await db.updateSession(
    from,
    estadoActual,
    datosTemp,
    null,
    ORIGEN_ACCION.BOT,
    `Solicitando campo: ${siguienteCampo.nombre}`
  );

  if (context?.log) {
    context.log(
      `[FlexibleFlow] ✅ Sesión actualizada: estado=${estadoActual}, campoSolicitado=${siguienteCampo.nombre}`
    );
  }

  // Enviar mensaje con botones
  if (botones.length > 1 || siguienteCampo.nombre === 'ubicacion') {
    await whatsapp.sendInteractiveMessage(
      from,
      getTituloFlujo(datosTemp.tipoReporte),
      mensaje,
      botones
    );
  } else {
    await whatsapp.sendText(from, mensaje);
  }

  await db.saveMessage(from, TIPO_MENSAJE.BOT, mensaje, TIPO_CONTENIDO.TEXTO);
}

module.exports = {
  solicitarSiguienteCampo,
  getMensajeProblema,
  getTituloFlujo,
};
