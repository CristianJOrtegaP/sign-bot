/**
 * AC FIXBOT - Servicio de Azure Maps
 * Funciones para geocoding inverso y cálculo de rutas
 * Usado para obtener direcciones y tiempos de llegada de vehículos
 */

const axios = require('axios');
const config = require('../../config');
const {
  logger,
  ExternalServiceError: _ExternalServiceError,
} = require('../infrastructure/errorHandler');

/**
 * Verifica si Azure Maps está configurado
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(config.azureMaps.apiKey);
}

/**
 * Crea un cliente axios para Azure Maps
 */
function createAxiosInstance(timeout) {
  return axios.create({
    baseURL: config.azureMaps.baseUrl,
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Realiza geocoding inverso: coordenadas → dirección
 * Convierte latitud/longitud en una dirección legible
 *
 * @param {number} latitude - Latitud
 * @param {number} longitude - Longitud
 * @returns {Promise<Object>} - Información de la dirección
 */
async function reverseGeocode(latitude, longitude) {
  if (!isConfigured()) {
    logger.warn('Azure Maps no configurado, omitiendo geocoding');
    return null;
  }

  const client = createAxiosInstance(config.azureMaps.timeout.geocodingMs);

  try {
    const response = await client.get('/search/address/reverse/json', {
      params: {
        'api-version': config.azureMaps.apiVersion,
        'subscription-key': config.azureMaps.apiKey,
        query: `${latitude},${longitude}`,
        language: 'es-MX',
      },
    });

    const result = response.data;

    if (!result.addresses || result.addresses.length === 0) {
      logger.warn('Geocoding: No se encontró dirección', { latitude, longitude });
      return null;
    }

    const address = result.addresses[0].address;

    // Formatear respuesta
    const formattedAddress = {
      direccionCompleta: address.freeformAddress || null,
      calle: address.streetName || null,
      numero: address.streetNumber || null,
      colonia: address.municipalitySubdivision || address.neighbourhood || null,
      ciudad: address.municipality || address.localName || null,
      estado: address.countrySubdivision || null,
      codigoPostal: address.postalCode || null,
      pais: address.country || 'México',
    };

    logger.debug('Geocoding exitoso', {
      latitude,
      longitude,
      direccion: formattedAddress.direccionCompleta,
    });

    return formattedAddress;
  } catch (error) {
    logger.error('Error en reverse geocoding', error, {
      latitude,
      longitude,
      status: error.response?.status,
    });

    // No lanzar error, solo retornar null para que el flujo continúe
    return null;
  }
}

/**
 * Calcula la ruta entre dos puntos
 * Devuelve tiempo de viaje (con y sin tráfico) y distancia
 *
 * @param {Object} origen - { latitud, longitud } del punto de origen
 * @param {Object} destino - { latitud, longitud } del punto de destino
 * @returns {Promise<Object>} - Información de la ruta
 */
async function getRoute(origen, destino) {
  if (!isConfigured()) {
    logger.warn('Azure Maps no configurado, omitiendo cálculo de ruta');
    return null;
  }

  const client = createAxiosInstance(config.azureMaps.timeout.routingMs);

  try {
    // Formato: latitud,longitud:latitud,longitud
    const routeQuery = `${origen.latitud},${origen.longitud}:${destino.latitud},${destino.longitud}`;

    const response = await client.get(`/route/directions/json`, {
      params: {
        'api-version': config.azureMaps.apiVersion,
        'subscription-key': config.azureMaps.apiKey,
        query: routeQuery,
        travelMode: config.azureMaps.routing.travelMode,
        traffic: config.azureMaps.routing.traffic,
        routeType: config.azureMaps.routing.routeType,
        computeTravelTimeFor: config.azureMaps.routing.computeTravelTimeFor,
        language: 'es-MX',
      },
    });

    const result = response.data;

    if (!result.routes || result.routes.length === 0) {
      logger.warn('Routing: No se encontró ruta', { origen, destino });
      return null;
    }

    const route = result.routes[0];
    const summary = route.summary;

    // Tiempos en segundos → convertir a minutos
    const tiempoSinTraficoMin = Math.ceil(summary.travelTimeInSeconds / 60);
    const tiempoConTraficoMin = Math.ceil(
      (summary.trafficDelayInSeconds
        ? summary.travelTimeInSeconds + summary.trafficDelayInSeconds
        : summary.travelTimeInSeconds) / 60
    );

    // Distancia en metros → convertir a km
    const distanciaKm = Math.round(summary.lengthInMeters / 100) / 10; // 1 decimal

    // Buffer configurable (tiempo adicional por preparación, etc.)
    const bufferMinutos = config.azureMaps.routeBufferMinutes;

    const routeInfo = {
      distanciaKm,
      tiempoSinTraficoMin,
      tiempoConTraficoMin,
      tiempoConBufferMin: tiempoConTraficoMin + bufferMinutos,
      bufferMinutos,
      traficoDelay: summary.trafficDelayInSeconds
        ? Math.ceil(summary.trafficDelayInSeconds / 60)
        : 0,
      fechaCalculo: new Date().toISOString(),
    };

    logger.debug('Ruta calculada', {
      origen: `${origen.latitud},${origen.longitud}`,
      destino: `${destino.latitud},${destino.longitud}`,
      distanciaKm,
      tiempoConTraficoMin,
      tiempoConBufferMin: routeInfo.tiempoConBufferMin,
    });

    return routeInfo;
  } catch (error) {
    logger.error('Error calculando ruta', error, {
      origen,
      destino,
      status: error.response?.status,
    });

    // No lanzar error, solo retornar null para que el flujo continúe
    return null;
  }
}

/**
 * Obtiene información completa de ubicación y ruta desde un centro de servicio
 * Combina geocoding inverso + cálculo de ruta en una sola llamada
 *
 * @param {Object} ubicacionVehiculo - { latitud, longitud } del vehículo
 * @param {Object} centroServicio - { latitud, longitud, nombre, codigo } del centro
 * @returns {Promise<Object>} - Información completa
 */
async function getLocationAndRouteInfo(ubicacionVehiculo, centroServicio) {
  // Ejecutar geocoding y routing en paralelo para mayor velocidad
  const [direccion, ruta] = await Promise.all([
    reverseGeocode(ubicacionVehiculo.latitud, ubicacionVehiculo.longitud),
    getRoute(
      { latitud: centroServicio.latitud, longitud: centroServicio.longitud },
      { latitud: ubicacionVehiculo.latitud, longitud: ubicacionVehiculo.longitud }
    ),
  ]);

  return {
    direccion,
    ruta,
    centroServicio: {
      codigo: centroServicio.codigo,
      nombre: centroServicio.nombre,
      ciudad: centroServicio.ciudad,
    },
    resumen: ruta
      ? {
          tiempoEstimadoMin: ruta.tiempoConBufferMin,
          distanciaKm: ruta.distanciaKm,
          mensaje: formatTiempoEstimado(ruta, centroServicio),
        }
      : null,
  };
}

/**
 * Formatea el tiempo estimado para mostrar al usuario
 * @param {Object} ruta - Información de la ruta
 * @param {Object} centro - Información del centro de servicio
 * @returns {string} - Mensaje formateado
 */
function formatTiempoEstimado(ruta, centro) {
  if (!ruta) {
    return 'Tiempo de llegada no disponible';
  }

  const horas = Math.floor(ruta.tiempoConBufferMin / 60);
  const minutos = ruta.tiempoConBufferMin % 60;

  let tiempoStr;
  if (horas > 0) {
    tiempoStr = minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`;
  } else {
    tiempoStr = `${minutos} min`;
  }

  return `Desde ${centro.nombre}: ~${tiempoStr} (${ruta.distanciaKm} km)`;
}

/**
 * Formatea una dirección para mostrar al usuario
 * @param {Object} direccion - Objeto de dirección del geocoding
 * @returns {string} - Dirección formateada
 */
function formatDireccion(direccion) {
  if (!direccion) {
    return null;
  }

  // Si tiene dirección completa, usarla
  if (direccion.direccionCompleta) {
    return direccion.direccionCompleta;
  }

  // Construir dirección manualmente
  const partes = [];

  if (direccion.calle) {
    let calle = direccion.calle;
    if (direccion.numero) {
      calle += ` #${direccion.numero}`;
    }
    partes.push(calle);
  }

  if (direccion.colonia) {
    partes.push(`Col. ${direccion.colonia}`);
  }

  if (direccion.ciudad) {
    partes.push(direccion.ciudad);
  }

  if (direccion.estado) {
    partes.push(direccion.estado);
  }

  if (direccion.codigoPostal) {
    partes.push(`CP ${direccion.codigoPostal}`);
  }

  return partes.length > 0 ? partes.join(', ') : null;
}

module.exports = {
  isConfigured,
  reverseGeocode,
  getRoute,
  getLocationAndRouteInfo,
  formatTiempoEstimado,
  formatDireccion,
};
