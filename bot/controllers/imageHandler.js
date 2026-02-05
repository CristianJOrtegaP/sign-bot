/**
 * AC FIXBOT - Handler de Imágenes
 * Procesa imágenes enviadas por los usuarios (códigos de barras)
 */

const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const {
  ESTADO,
  TIPO_REPORTE: _TIPO_REPORTE,
  ORIGEN_ACCION,
  esEstadoTerminal,
} = require('../constants/sessionStates');
const { safeParseJSON } = require('../../core/utils/helpers');

/**
 * Límites de tamaño de imagen para seguridad
 * @constant
 */
const IMAGE_LIMITS = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB máximo
  MIN_SIZE_BYTES: 1024, // 1KB mínimo
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

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

  // Verificar rate limit para imágenes
  const rateLimitCheck = rateLimiter.checkRateLimit(from, 'image');
  if (!rateLimitCheck.allowed) {
    context.log(`⚠️ Rate limit de imágenes excedido para ${from}`);
    await whatsapp.sendAndSaveText(from, `⏱️ ${rateLimitCheck.reason}`);
    return;
  }

  // Registrar solicitud de imagen
  rateLimiter.recordRequest(from, 'image');

  // Mostrar "Escribiendo..." (fire-and-forget, no bloquea el flujo)
  whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

  // Obtener sesión del usuario (FORZAR LECTURA FRESCA sin caché)
  // Esto evita race conditions donde el caché tiene estado antiguo
  const session = await db.getSessionFresh(from);
  context.log(`[ImageHandler] Estado inicial de sesión (fresh): ${session.Estado}`);

  // Si la sesión está en estado terminal, reiniciar a INICIO
  // Esto asegura que cada nueva imagen comience con sesión limpia
  if (esEstadoTerminal(session.Estado)) {
    context.log(`[ImageHandler] Reiniciando sesión desde estado terminal: ${session.Estado}`);
    await db.updateSession(
      from,
      ESTADO.INICIO,
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      `Sesión reiniciada desde ${session.Estado} por imagen`
    );
    session.Estado = ESTADO.INICIO;
    session.DatosTemp = null;
  }

  // Extraer caption de la imagen (texto que acompaña la imagen)
  const caption = imageData.caption || '';
  context.log(`[ImageHandler] Caption de imagen: "${caption}"`);

  // Obtener datosTemp
  const datosTemp = safeParseJSON(session.DatosTemp);
  const tipoReporte = datosTemp?.tipoReporte;

  context.log(`[ImageHandler] Tipo de reporte: ${tipoReporte}`);

  // FASE 2b: Determinar si usar OCR (refrigerador) o AI Vision (vehículo/otros)
  // En flujo flexible, usamos OCR solo para refrigeradores YA activos
  const esFlexibleRefrigerador = session.Estado === ESTADO.REFRIGERADOR_ACTIVO;
  const _esFlexibleVehiculo = session.Estado === ESTADO.VEHICULO_ACTIVO;
  const esEstadoInicio = session.Estado === ESTADO.INICIO;

  // Decidir qué tipo de procesamiento usar:
  // - AI Vision: para INICIO (detectar tipo de equipo), vehículos, y casos desconocidos
  // - OCR: SOLO cuando ya estamos en flujo de refrigerador activo
  // IMPORTANTE: Si estamos en INICIO, SIEMPRE usar AI Vision para detectar qué es
  const usarOCR = esFlexibleRefrigerador && !esEstadoInicio;

  context.log(
    `[ImageHandler] esEstadoInicio=${esEstadoInicio}, esFlexibleRefrigerador=${esFlexibleRefrigerador}, usarOCR=${usarOCR}`
  );

  // Si hay caption, guardarlo como mensaje de texto del usuario ANTES de la imagen
  if (caption && caption.trim()) {
    try {
      await db.saveMessage(from, 'U', caption.trim(), 'TEXTO');
      context.log(`[ImageHandler] Caption guardado como mensaje: "${caption.trim()}"`);
    } catch (err) {
      context.log.warn(`[ImageHandler] Error guardando caption: ${err.message}`);
    }
  }

  // Guardar placeholder de imagen del usuario (para orden correcto en dashboard)
  // La imagen real con URL se guardará en backgroundProcessor después de subirla a blob
  try {
    await db.saveMessage(from, 'U', `[IMG_PLACEHOLDER:${imageData.id}]`, 'IMAGEN');
    context.log(`[ImageHandler] Placeholder de imagen guardado para orden correcto`);
  } catch (err) {
    context.log.warn(`[ImageHandler] Error guardando placeholder: ${err.message}`);
  }

  if (usarOCR) {
    // Flujo tradicional: OCR para códigos de barras (refrigeradores)
    context.log(`[ImageHandler] Usando procesamiento OCR para código de barras`);
    await whatsapp.sendAndSaveText(from, '🔍 Analizando código de barras... Un momento por favor.');

    backgroundProcessor.processImageInBackground(from, imageData.id, context).catch((err) => {
      context.log.error('Error en procesamiento background OCR:', err);
    });
  } else {
    // Nuevo flujo: AI Vision para análisis general (vehículos y cualquier otro caso)
    context.log(`[ImageHandler] Usando procesamiento AI Vision`);
    await whatsapp.sendAndSaveText(
      from,
      '🤖 Analizando imagen con inteligencia artificial... Un momento por favor.'
    );

    backgroundProcessor
      .processImageWithAIVision(from, imageData.id, caption, context)
      .catch((err) => {
        context.log.error('Error en procesamiento background AI Vision:', err);
      });
  }
}

module.exports = {
  handleImage,
  IMAGE_LIMITS, // Exportar para tests
};
