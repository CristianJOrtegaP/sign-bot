/**
 * AC FIXBOT - Handler de Imágenes
 * Procesa imágenes enviadas por los usuarios con ruteo inteligente:
 * - OCR para códigos de barras de refrigerador
 * - AI Vision para detección de tipo/problema
 * - Solo guardado para imágenes de evidencia adicional
 */

const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');
const { ESTADO } = require('../constants/sessionStates');
const { safeParseJSON } = require('../../core/utils/helpers');
const {
  enforceRateLimit,
  reactivateSessionIfTerminal,
} = require('./messageHandler/utils/handlerMiddleware');
const correlation = require('../../core/services/infrastructure/correlationService');

/**
 * Límites de tamaño de imagen para seguridad
 * @constant
 */
const IMAGE_LIMITS = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB máximo
  MIN_SIZE_BYTES: 1024, // 1KB mínimo
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

// Estados que requieren confirmación antes de procesar otra imagen
const ESTADOS_CONFIRMACION = [
  ESTADO.VEHICULO_CONFIRMAR_DATOS_AI,
  ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI,
  ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
];

/**
 * Árbol de decisión para ruteo de imágenes.
 * Determina qué procesamiento aplicar según estado de sesión y datos recolectados.
 *
 * @param {string} estado - Estado actual de la sesión
 * @param {Object|null} datosTemp - Datos temporales parseados
 * @returns {{ route: string, message: string|null }}
 */
function determineImageRoute(estado, datosTemp) {
  // 1. Estados de confirmación pendiente: bloquear
  if (ESTADOS_CONFIRMACION.includes(estado)) {
    return {
      route: 'BLOCK_CONFIRMATION',
      message: '⏸️ Primero confirma o rechaza los datos detectados antes de enviar otra imagen.',
    };
  }

  // 2. Sin tipoReporte o en INICIO: AI Vision para detectar todo
  if (estado === ESTADO.INICIO || !datosTemp?.tipoReporte) {
    return { route: 'AI_VISION_INICIO', message: null };
  }

  const campos = datosTemp.camposRequeridos || {};

  // 3. REFRIGERADOR_ACTIVO
  if (estado === ESTADO.REFRIGERADOR_ACTIVO) {
    const tieneCodigoSAP = campos.codigoSAP?.valor && campos.codigoSAP?.completo;
    const tieneProblema = campos.problema?.valor && campos.problema?.completo;

    if (!tieneCodigoSAP) {
      return { route: 'OCR_SAP', message: null };
    }
    if (!tieneProblema) {
      return { route: 'AI_VISION_PROBLEMA', message: null };
    }
    return { route: 'SAVE_ONLY', message: null };
  }

  // 4. VEHICULO_ACTIVO (nunca OCR — SAP de vehículos es por texto)
  if (estado === ESTADO.VEHICULO_ACTIVO) {
    const tieneProblema = campos.problema?.valor && campos.problema?.completo;

    if (!tieneProblema) {
      return { route: 'AI_VISION_PROBLEMA', message: null };
    }
    return { route: 'SAVE_ONLY', message: null };
  }

  // 5. Fallback: cualquier otro estado flexible
  return { route: 'AI_VISION_INICIO', message: null };
}

/**
 * Procesa una imagen recibida
 * @param {string} from - Número de teléfono del remitente
 * @param {Object} imageData - Datos de la imagen de WhatsApp
 * @param {string} messageId - ID del mensaje recibido
 * @param {Object} context - Contexto de Azure Functions
 */
async function handleImage(from, imageData, messageId, context) {
  context.log(`Procesando imagen de ${from}`);
  context.log(`Image ID: ${imageData.id}`);

  // Validar datos de imagen recibidos
  if (!imageData || !imageData.id) {
    context.log.warn(`Datos de imagen inválidos de ${from}`);
    await whatsapp.sendAndSaveText(
      from,
      '❌ No pude procesar la imagen. Por favor intenta enviarla nuevamente.'
    );
    return;
  }

  // Validar tipo MIME si está disponible
  if (imageData.mime_type && !IMAGE_LIMITS.ALLOWED_MIME_TYPES.includes(imageData.mime_type)) {
    context.log.warn(`Tipo de imagen no permitido: ${imageData.mime_type}`);
    await whatsapp.sendAndSaveText(
      from,
      '📁 Formato de imagen no soportado.\n\n' +
        'Por favor envía una imagen en formato JPG, PNG o WEBP.'
    );
    return;
  }

  // Validar tamaño de imagen si está disponible (WhatsApp envía file_size)
  if (imageData.file_size) {
    if (imageData.file_size > IMAGE_LIMITS.MAX_SIZE_BYTES) {
      context.log.warn(`Imagen muy grande: ${imageData.file_size} bytes`);
      await whatsapp.sendAndSaveText(
        from,
        '📐 La imagen es demasiado grande (máximo 10MB).\n\n' +
          'Por favor envía una imagen más pequeña o recórtala.'
      );
      return;
    }
    if (imageData.file_size < IMAGE_LIMITS.MIN_SIZE_BYTES) {
      context.log.warn(`Imagen muy pequeña: ${imageData.file_size} bytes`);
      await whatsapp.sendAndSaveText(
        from,
        '🔍 La imagen es muy pequeña para procesarla.\n\n' +
          'Por favor envía una imagen con mejor resolución.'
      );
      return;
    }
  }

  // Verificar rate limit (middleware compartido)
  const rateLimitResult = await enforceRateLimit(from, 'image');
  if (!rateLimitResult.allowed) {
    context.log(`⚠️ Rate limit de imágenes excedido para ${from}`);
    return;
  }

  // Mostrar "Escribiendo..." (fire-and-forget, no bloquea el flujo)
  whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

  // Obtener sesión del usuario (FORZAR LECTURA FRESCA sin caché)
  const session = await db.getSessionFresh(from);
  context.log(`[ImageHandler] Estado inicial de sesión (fresh): ${session.Estado}`);

  // Reactivar sesión si está en estado terminal (con optimistic locking correcto)
  await reactivateSessionIfTerminal(from, session, 'imagen', context);

  // Extraer caption y datos de sesión
  const caption = imageData.caption || '';
  context.log(`[ImageHandler] Caption de imagen: "${caption}"`);

  const datosTemp = safeParseJSON(session.DatosTemp);
  context.log(`[ImageHandler] Tipo de reporte: ${datosTemp?.tipoReporte}`);

  // Ruteo inteligente basado en estado + datos recolectados
  const { route, message: blockMessage } = determineImageRoute(session.Estado, datosTemp);
  context.log(`[ImageHandler] Route: ${route} (estado=${session.Estado})`);

  // Bloquear si hay confirmación pendiente
  if (route === 'BLOCK_CONFIRMATION') {
    await whatsapp.sendAndSaveText(from, blockMessage);
    return;
  }

  // Guardar caption como mensaje de texto (para orden correcto en dashboard)
  if (caption && caption.trim()) {
    try {
      await db.saveMessage(from, 'U', caption.trim(), 'TEXTO');
      context.log(`[ImageHandler] Caption guardado como mensaje: "${caption.trim()}"`);
    } catch (err) {
      context.log.warn(`[ImageHandler] Error guardando caption: ${err.message}`);
    }
  }

  // Guardar placeholder de imagen (la URL real se actualiza en background)
  try {
    await db.saveMessage(from, 'U', `[IMG_PLACEHOLDER:${imageData.id}]`, 'IMAGEN');
    context.log(`[ImageHandler] Placeholder de imagen guardado`);
  } catch (err) {
    context.log.warn(`[ImageHandler] Error guardando placeholder: ${err.message}`);
  }

  // Despachar al procesador correspondiente
  const correlationId = correlation.getCorrelationId();

  switch (route) {
    case 'OCR_SAP':
      context.log(`[ImageHandler] → OCR para código de barras`);
      await whatsapp.sendAndSaveText(
        from,
        '🔍 Analizando código de barras... Un momento por favor.'
      );
      backgroundProcessor
        .processImageInBackground(from, imageData.id, context, { correlationId })
        .catch((err) => context.log.error('Error en procesamiento background OCR:', err));
      break;

    case 'AI_VISION_INICIO':
    case 'AI_VISION_PROBLEMA':
      context.log(`[ImageHandler] → AI Vision (${route})`);
      await whatsapp.sendAndSaveText(
        from,
        '🤖 Analizando imagen con inteligencia artificial... Un momento por favor.'
      );
      backgroundProcessor
        .processImageWithAIVision(from, imageData.id, caption, context, { correlationId })
        .catch((err) => context.log.error('Error en procesamiento background AI Vision:', err));
      break;

    case 'SAVE_ONLY':
      context.log(`[ImageHandler] → Solo guardar (datos completos)`);
      await whatsapp.sendAndSaveText(from, '📷 Imagen recibida y guardada como evidencia.');
      backgroundProcessor
        .saveImageOnly(from, imageData.id, context, { correlationId })
        .catch((err) => context.log.error('Error en guardado de imagen:', err));
      break;
  }
}

module.exports = {
  handleImage,
  determineImageRoute, // Exportar para tests unitarios
  IMAGE_LIMITS,
};
