/**
 * AC FIXBOT - Cálculo de Centro de Servicio y ETA
 * @module flows/modules/serviceCalculation
 */

const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const centroServicioRepo = require('../../../repositories/CentroServicioRepository');
const azureMapsService = require('../../../../core/services/external/azureMapsService');

/**
 * Calcula el centro de servicio más cercano y el tiempo estimado de llegada
 * @param {Object} datosActualizados - DatosTemp a actualizar (se modifica in-place)
 * @param {Object} ubicacion - Objeto con latitud y longitud
 * @param {Object} context - Contexto de Azure Function
 */
async function calcularCentroServicioYETA(datosActualizados, ubicacion, context = null) {
  if (context?.log) {
    context.log(
      `[FlexibleFlow] Calculando centro más cercano para ubicación: ${ubicacion.latitud}, ${ubicacion.longitud}`
    );
  }

  // 1. Buscar el centro de servicio más cercano (usa fórmula Haversine)
  const centroMasCercano = await centroServicioRepo.findNearest(
    ubicacion.latitud,
    ubicacion.longitud
  );

  if (!centroMasCercano) {
    logger.warn('[FlexibleFlow] No se encontraron centros de servicio activos');
    return;
  }

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Centro más cercano: ${centroMasCercano.Nombre} (${centroMasCercano.DistanciaKm} km)`
    );
  }

  // 2. Calcular ruta con Azure Maps (incluye buffer de tiempo)
  let rutaInfo = null;
  if (azureMapsService.isConfigured()) {
    rutaInfo = await azureMapsService.getRoute(
      { latitud: centroMasCercano.Latitud, longitud: centroMasCercano.Longitud },
      { latitud: ubicacion.latitud, longitud: ubicacion.longitud }
    );

    if (context?.log && rutaInfo) {
      context.log(
        `[FlexibleFlow] Ruta calculada: ${rutaInfo.tiempoConBufferMin} min (incluye ${rutaInfo.bufferMinutos} min buffer)`
      );
    }
  }

  // 3. Guardar info del centro y ETA en datosActualizados
  datosActualizados.centroServicio = {
    centroServicioId: centroMasCercano.CentroServicioId,
    codigo: centroMasCercano.Codigo,
    nombre: centroMasCercano.Nombre,
    ciudad: centroMasCercano.Ciudad,
    distanciaDirectaKm: centroMasCercano.DistanciaKm,
  };

  // Si tenemos ruta de Azure Maps, usar esos datos
  if (rutaInfo) {
    datosActualizados.tiempoLlegada = {
      tiempoEstimadoMin: rutaInfo.tiempoConBufferMin,
      tiempoSinTraficoMin: rutaInfo.tiempoSinTraficoMin,
      tiempoConTraficoMin: rutaInfo.tiempoConTraficoMin,
      bufferMinutos: rutaInfo.bufferMinutos,
      distanciaKm: rutaInfo.distanciaKm,
      centroNombre: centroMasCercano.Nombre,
      fechaCalculo: rutaInfo.fechaCalculo,
    };
  } else {
    // Sin Azure Maps, estimar con distancia directa (promedio 30 km/h en ciudad + buffer)
    const tiempoEstimadoBase = Math.ceil((centroMasCercano.DistanciaKm / 30) * 60);
    const bufferMinutos = 20;
    datosActualizados.tiempoLlegada = {
      tiempoEstimadoMin: tiempoEstimadoBase + bufferMinutos,
      distanciaKm: centroMasCercano.DistanciaKm,
      centroNombre: centroMasCercano.Nombre,
      estimacionSimple: true,
    };
  }

  if (context?.log) {
    context.log(
      `[FlexibleFlow] ETA calculado: ${datosActualizados.tiempoLlegada.tiempoEstimadoMin} min desde ${centroMasCercano.Nombre}`
    );
  }
}

module.exports = {
  calcularCentroServicioYETA,
};
