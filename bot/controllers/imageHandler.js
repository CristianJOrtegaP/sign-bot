/**
 * AC FIXBOT - Handler de Imágenes
 * Procesa imágenes enviadas por los usuarios (códigos de barras)
 */

const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const { ESTADO, TIPO_REPORTE } = require('../constants/sessionStates');
const { safeParseJSON } = require('../../core/utils/helpers');

/**
 * Límites de tamaño de imagen para seguridad
 * @constant
 */
const IMAGE_LIMITS = {
    MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB máximo
    MIN_SIZE_BYTES: 1024,              // 1KB mínimo
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
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
        await whatsapp.sendText(from,
            '❌ No pude procesar la imagen. Por favor intenta enviarla nuevamente.'
        );
        return;
    }

    // Validar tipo MIME si está disponible
    if (imageData.mime_type && !IMAGE_LIMITS.ALLOWED_MIME_TYPES.includes(imageData.mime_type)) {
        context.log.warn(`Tipo de imagen no permitido: ${imageData.mime_type}`);
        await whatsapp.sendText(from,
            '📁 Formato de imagen no soportado.\n\n' +
            'Por favor envía una imagen en formato JPG, PNG o WEBP.'
        );
        return;
    }

    // Validar tamaño de imagen si está disponible (WhatsApp envía file_size)
    if (imageData.file_size) {
        if (imageData.file_size > IMAGE_LIMITS.MAX_SIZE_BYTES) {
            context.log.warn(`Imagen muy grande: ${imageData.file_size} bytes`);
            await whatsapp.sendText(from,
                '📐 La imagen es demasiado grande (máximo 10MB).\n\n' +
                'Por favor envía una imagen más pequeña o recórtala.'
            );
            return;
        }
        if (imageData.file_size < IMAGE_LIMITS.MIN_SIZE_BYTES) {
            context.log.warn(`Imagen muy pequeña: ${imageData.file_size} bytes`);
            await whatsapp.sendText(from,
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
        await whatsapp.sendText(from, `⏱️ ${rateLimitCheck.reason}`);
        return;
    }

    // Registrar solicitud de imagen
    rateLimiter.recordRequest(from, 'image');

    // Mostrar "Escribiendo..." (fire-and-forget, no bloquea el flujo)
    whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

    // Obtener sesión del usuario
    let session = await db.getSession(from);
    context.log(`[ImageHandler] Estado inicial de sesión: ${session.Estado}`);

    // Extraer caption de la imagen (texto que acompaña la imagen)
    const caption = imageData.caption || '';
    context.log(`[ImageHandler] Caption de imagen: "${caption}"`);

    // Obtener datosTemp
    const datosTemp = safeParseJSON(session.DatosTemp);
    const tipoReporte = datosTemp?.tipoReporte;

    context.log(`[ImageHandler] Tipo de reporte: ${tipoReporte}`);

    // Determinar si la imagen es para flujo de refrigerador (OCR) o cualquier otro (AI Vision)
    const esFlujoCodBarras = session.Estado === ESTADO.REFRI_ESPERA_SAP;

    // Manejar race condition para flujo de refrigerador (código de barras)
    if (!esFlujoCodBarras && tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
        context.log(`[ImageHandler] Race condition detectada, verificando...`);

        // Invalidar caché y releer de BD
        db.clearSessionCache(from);
        session = await db.getSession(from);
        context.log(`[ImageHandler] Estado después de invalidar caché: ${session.Estado}`);

        // Si ahora es REFRI_ESPERA_SAP, actualizar bandera
        if (session.Estado === ESTADO.REFRI_ESPERA_SAP) {
            context.log(`[ImageHandler] Estado actualizado a REFRI_ESPERA_SAP`);
        } else {
            // Actualizar estado manualmente para continuar el flujo
            await db.updateSession(
                from,
                ESTADO.REFRI_ESPERA_SAP,
                datosTemp,
                session.EquipoIdTemp,
                'BOT',
                'Estado corregido por race condition en imagen'
            );
            session.Estado = ESTADO.REFRI_ESPERA_SAP;
        }
    }

    // Decidir qué tipo de procesamiento usar
    const usarOCR = session.Estado === ESTADO.REFRI_ESPERA_SAP;

    if (usarOCR) {
        // Flujo tradicional: OCR para códigos de barras (refrigeradores)
        context.log(`[ImageHandler] Usando procesamiento OCR para código de barras`);
        await whatsapp.sendText(from, '🔍 Analizando código de barras... Un momento por favor.');

        backgroundProcessor.processImageInBackground(from, imageData.id, context)
            .catch(err => {
                context.log.error('Error en procesamiento background OCR:', err);
            });
    } else {
        // Nuevo flujo: AI Vision para análisis general (vehículos y cualquier otro caso)
        context.log(`[ImageHandler] Usando procesamiento AI Vision`);
        await whatsapp.sendText(from, '🤖 Analizando imagen con inteligencia artificial... Un momento por favor.');

        backgroundProcessor.processImageWithAIVision(from, imageData.id, caption, context)
            .catch(err => {
                context.log.error('Error en procesamiento background AI Vision:', err);
            });
    }
}

module.exports = {
    handleImage,
    IMAGE_LIMITS // Exportar para tests
};
