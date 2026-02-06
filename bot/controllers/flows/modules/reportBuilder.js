/**
 * AC FIXBOT - Creación de Reportes del Flujo Flexible
 * @module flows/modules/reportBuilder
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const teamsService = require('../../../../core/services/external/teamsService');
const MSG = require('../../../constants/messages');
const { sanitizeDescription } = require('../../../../core/utils/helpers');
const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');

/**
 * Crea reporte de refrigerador
 * @param {string} from - Teléfono del usuario
 * @param {Object} datosTemp - Datos temporales del flujo
 * @param {Object} _session - Sesión actual (no usado)
 * @param {Object} _context - Contexto (no usado)
 * @returns {Promise<string>} - Número de ticket
 */
async function crearReporteRefrigerador(from, datosTemp, _session, _context) {
  const { camposRequeridos, equipoIdTemp, datosEquipo } = datosTemp;

  if (!equipoIdTemp) {
    throw new Error('No se encontró el ID del equipo en la sesión');
  }

  const equipo = datosEquipo || (await db.getEquipoById(equipoIdTemp));

  if (!equipo) {
    throw new Error(`No se encontró el equipo con ID ${equipoIdTemp}`);
  }

  const descripcion = sanitizeDescription(camposRequeridos.problema.valor);

  const numeroTicket = await db.createReporte(
    equipoIdTemp,
    equipo.ClienteId,
    from,
    descripcion,
    null // imagenUrl
  );

  return numeroTicket;
}

/**
 * Crea reporte de vehículo
 * @param {string} from - Teléfono del usuario
 * @param {Object} datosTemp - Datos temporales del flujo
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto de Azure Function
 * @returns {Promise<string>} - Número de ticket
 */
async function crearReporteVehiculo(from, datosTemp, session, context) {
  const { camposRequeridos, centroServicio, tiempoLlegada } = datosTemp;

  const descripcion = sanitizeDescription(camposRequeridos.problema.valor);
  const numeroEmpleado = camposRequeridos.numeroEmpleado?.valor;
  const codigoSAP = camposRequeridos.codigoSAP?.valor;

  // Construir objeto de ubicación para el repositorio
  const ubicacionObj = camposRequeridos.ubicacion?.coordenadas
    ? {
        latitud: camposRequeridos.ubicacion.coordenadas.latitud,
        longitud: camposRequeridos.ubicacion.coordenadas.longitud,
        direccion: camposRequeridos.ubicacion.valor || null,
      }
    : null;

  // Extraer datos del centro de servicio y ETA si están disponibles
  const centroServicioId = centroServicio?.centroServicioId || null;
  const tiempoEstimadoMinutos = tiempoLlegada?.tiempoEstimadoMin || null;
  const distanciaCentroKm =
    tiempoLlegada?.distanciaKm || centroServicio?.distanciaDirectaKm || null;

  // Usar createReporteVehiculo específico para vehículos
  const numeroTicket = await db.createReporteVehiculo(
    codigoSAP,
    numeroEmpleado,
    from,
    descripcion,
    null, // imagenUrl
    ubicacionObj,
    centroServicioId,
    tiempoEstimadoMinutos,
    distanciaCentroKm
  );

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Reporte vehículo creado: ${numeroTicket}, SAP: ${codigoSAP}, Empleado: ${numeroEmpleado}, Centro: ${centroServicio?.nombre || 'N/A'}, ETA: ${tiempoEstimadoMinutos || 'N/A'} min`
    );
  }

  return numeroTicket;
}

/**
 * Crea el reporte una vez que todos los campos están completos
 * @param {string} from - Teléfono del usuario
 * @param {Object} datosTemp - DatosTemp con todos los campos
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto de Azure Function
 * @returns {Promise<string>} - Número de ticket
 */
async function crearReporte(from, datosTemp, session, context = null) {
  const { tipoReporte, camposRequeridos, equipoIdTemp, datosEquipo } = datosTemp;

  if (context?.log) {
    context.log(`[FlexibleFlow] Creando reporte: ${tipoReporte}, equipoId: ${equipoIdTemp}`);
  }

  try {
    let numeroTicket;

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
      numeroTicket = await crearReporteRefrigerador(from, datosTemp, session, context);
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
      numeroTicket = await crearReporteVehiculo(from, datosTemp, session, context);
    } else {
      throw new Error(`Tipo de reporte no soportado: ${tipoReporte}`);
    }

    // Cambiar a estado FINALIZADO
    await db.updateSession(
      from,
      ESTADO.FINALIZADO,
      null,
      null,
      ORIGEN_ACCION.BOT,
      `Reporte creado: ${numeroTicket}`
    );

    // Enviar confirmación
    let msgConfirmacion;
    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
      msgConfirmacion = MSG.REFRIGERADOR.reporteCreado(
        numeroTicket,
        datosEquipo,
        camposRequeridos.problema.valor
      );
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
      const codigoSAP = camposRequeridos.codigoSAP?.valor;
      const numeroEmpleado = camposRequeridos.numeroEmpleado?.valor;
      const descripcion = camposRequeridos.problema?.valor;
      const ubicacion = camposRequeridos.ubicacion?.valor || null;
      const tiempoLlegadaInfo = datosTemp.tiempoLlegada || null;

      msgConfirmacion =
        MSG.VEHICULO?.reporteCreado?.(
          numeroTicket,
          codigoSAP,
          numeroEmpleado,
          descripcion,
          ubicacion,
          tiempoLlegadaInfo
        ) ||
        `✅ ¡Reporte creado exitosamente!\n\n📋 Ticket: ${numeroTicket}\n\nTe contactaremos pronto.`;
    } else {
      msgConfirmacion = `✅ ¡Reporte creado exitosamente!\n\n📋 Ticket: ${numeroTicket}\n\nTe contactaremos pronto.`;
    }

    await whatsapp.sendText(from, msgConfirmacion);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgConfirmacion, TIPO_CONTENIDO.TEXTO);

    // Notificar a Teams (fire-and-forget)
    teamsService
      .notifyTicketCreated(from, tipoReporte, numeroTicket, {
        codigoSAP: camposRequeridos.codigoSAP?.valor,
        numeroEmpleado: camposRequeridos.numeroEmpleado?.valor,
        problema: camposRequeridos.problema?.valor,
        ubicacion: camposRequeridos.ubicacion?.valor,
      })
      .catch((err) => logger.warn('[FlexibleFlow] Error notificando a Teams:', err.message));

    if (context?.log) {
      context.log(`[FlexibleFlow] Reporte creado exitosamente: ${numeroTicket}`);
    }

    return numeroTicket;
  } catch (error) {
    logger.error(`[FlexibleFlow] Error creando reporte`, { error: error.message });
    await whatsapp.sendText(
      from,
      MSG.GENERAL.ERROR_INTERNO ||
        'Ocurrió un error al crear el reporte. Por favor, intenta de nuevo.'
    );
    throw error;
  }
}

module.exports = {
  crearReporte,
  crearReporteRefrigerador,
  crearReporteVehiculo,
};
