/**
 * AC FIXBOT - Handler de Ubicaciones
 * Procesa mensajes de ubicación de WhatsApp
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const rateLimiter = require('../../../../core/services/infrastructure/rateLimiter');
const security = require('../../../../core/services/infrastructure/securityService');
const flexibleFlowManager = require('../../flows/flexibleFlowManager');
const {
  ESTADO,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  esEstadoFlexible,
} = require('../../../constants/sessionStates');

/**
 * Procesa un mensaje de ubicación
 * @param {string} from - Número de teléfono
 * @param {Object} location - Objeto de ubicación de WhatsApp
 * @param {number} location.latitude - Latitud
 * @param {number} location.longitude - Longitud
 * @param {string} location.name - Nombre del lugar (opcional)
 * @param {string} location.address - Dirección (opcional)
 * @param {string} messageId - ID del mensaje
 * @param {Object} context - Contexto de Azure Functions
 */
async function handleLocation(from, location, messageId, context) {
  context.log(
    `📍 Procesando ubicación de ${from}: lat=${location?.latitude}, lng=${location?.longitude}`
  );

  // Validar coordenadas de ubicación
  const locationValidation = security.validateLocation(location);
  if (!locationValidation.valid) {
    context.log.warn(`⚠️ Ubicación inválida de ${from}: ${locationValidation.error}`);
    await whatsapp.sendText(from, 'La ubicación enviada no es válida. Por favor intenta de nuevo.');
    return;
  }
  // Usar coordenadas sanitizadas
  location = { ...location, ...locationValidation.sanitized };

  // Verificar rate limit
  const rateLimitCheck = rateLimiter.checkRateLimit(from, 'message');
  if (!rateLimitCheck.allowed) {
    context.log(`⚠️ Rate limit excedido para ${from}`);
    await whatsapp.sendText(from, `⏱️ ${rateLimitCheck.reason}`);
    return;
  }

  // Registrar solicitud
  rateLimiter.recordRequest(from, 'message');

  // Guardar mensaje de ubicación en BD
  const ubicacionStr = location?.address || `${location?.latitude}, ${location?.longitude}`;
  await db.saveMessage(from, TIPO_MENSAJE.USUARIO, ubicacionStr, TIPO_CONTENIDO.UBICACION);

  // Obtener sesión del usuario (FORZAR LECTURA FRESCA sin caché)
  // Esto evita race conditions donde el caché tiene estado antiguo
  const session = await db.getSessionFresh(from);
  context.log(`Estado actual de sesión (fresh): ${session.Estado}`);

  // FASE 2b: Si estamos en estado flexible VEHICULO_ACTIVO, procesar ubicación
  if (session.Estado === ESTADO.VEHICULO_ACTIVO) {
    context.log(`[FASE 2b] Procesando ubicación en estado flexible: ${session.Estado}`);
    const ubicacionObj = {
      latitud: location.latitude,
      longitud: location.longitude,
      // Solo usar direccion si WhatsApp la proporciona, sino dejar null para que se haga geocoding inverso
      direccion: location.address || null,
      nombre: location.name || null,
    };
    const handled = await flexibleFlowManager.procesarUbicacion(
      from,
      ubicacionObj,
      session,
      context
    );
    if (handled) {
      return;
    }
  }

  // FASE 2b: Si no estamos en estado flexible, informar al usuario
  if (!esEstadoFlexible(session.Estado)) {
    context.log(`Ubicación recibida pero no esperada en estado ${session.Estado}`);
    await whatsapp.sendAndSaveText(
      from,
      'Gracias por tu ubicación, pero en este momento no la necesitamos.'
    );
  }
}

module.exports = {
  handleLocation,
};
