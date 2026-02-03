/**
 * AC FIXBOT - Handler de Audio
 * Procesa mensajes de voz enviados por los usuarios
 * Transcribe el audio a texto y lo procesa como mensaje de texto
 */

const whatsapp = require('../../core/services/external/whatsappService');
const transcriptionService = require('../../core/services/ai/audioTranscriptionService');
const messageHandler = require('./messageHandler');
const db = require('../../core/services/storage/databaseService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const config = require('../../core/config');
const { TIPO_MENSAJE, TIPO_CONTENIDO } = require('../constants/sessionStates');

/**
 * Límites de tamaño de audio para seguridad
 * @constant
 */
const AUDIO_LIMITS = {
    MAX_SIZE_BYTES: config.audio?.limits?.maxFileSizeBytes || 25 * 1024 * 1024, // 25MB
    MIN_SIZE_BYTES: config.audio?.limits?.minFileSizeBytes || 1024, // 1KB
    // Tipos MIME de audio que WhatsApp puede enviar
    ALLOWED_MIME_TYPES: [
        'audio/ogg',
        'audio/ogg; codecs=opus',
        'audio/opus',
        'audio/mpeg',
        'audio/mp4',
        'audio/amr',
        'audio/aac'
    ]
};

/**
 * Verifica si la transcripción de audio está habilitada
 * @returns {boolean}
 */
function isAudioTranscriptionEnabled() {
    return transcriptionService.isEnabled();
}

/**
 * Procesa un mensaje de audio recibido
 * @param {string} from - Número de teléfono del remitente
 * @param {Object} audioData - Datos del audio de WhatsApp
 * @param {string} audioData.id - ID del archivo de audio en WhatsApp
 * @param {string} audioData.mime_type - Tipo MIME del audio
 * @param {number} audioData.file_size - Tamaño del archivo en bytes (opcional)
 * @param {string} messageId - ID del mensaje recibido
 * @param {Object} context - Contexto de Azure Functions
 */
async function handleAudio(from, audioData, messageId, context) {
    context.log(`[AudioHandler] Procesando audio de ${from}`);
    context.log(`[AudioHandler] Audio ID: ${audioData.id}, MIME: ${audioData.mime_type}`);

    // Verificar si la transcripción está habilitada
    if (!isAudioTranscriptionEnabled()) {
        context.log.warn(`[AudioHandler] Transcripción de audio no habilitada`);
        await whatsapp.sendText(from,
            '🎤 Recibí tu mensaje de voz, pero la transcripción de audio no está disponible en este momento.\n\n' +
            'Por favor, escribe tu mensaje como texto.'
        );
        return;
    }

    // Validar datos de audio recibidos
    if (!audioData || !audioData.id) {
        context.log.warn(`[AudioHandler] Datos de audio inválidos de ${from}`);
        await whatsapp.sendText(from,
            '❌ No pude procesar el audio. Por favor intenta enviarlo nuevamente.'
        );
        return;
    }

    // Validar tipo MIME si está disponible
    const mimeType = audioData.mime_type?.toLowerCase() || 'audio/ogg';
    const isValidMime = AUDIO_LIMITS.ALLOWED_MIME_TYPES.some(allowed =>
        mimeType.includes(allowed.split(';')[0]) || mimeType.includes('ogg') || mimeType.includes('opus')
    );

    if (!isValidMime) {
        context.log.warn(`[AudioHandler] Tipo de audio no permitido: ${mimeType}`);
        await whatsapp.sendText(from,
            '📁 Formato de audio no soportado.\n\n' +
            'Por favor envía un mensaje de voz normal o escribe tu mensaje como texto.'
        );
        return;
    }

    // Validar tamaño de audio si está disponible
    if (audioData.file_size) {
        if (audioData.file_size > AUDIO_LIMITS.MAX_SIZE_BYTES) {
            context.log.warn(`[AudioHandler] Audio muy grande: ${audioData.file_size} bytes`);
            await whatsapp.sendText(from,
                '📐 El audio es demasiado largo (máximo 5 minutos).\n\n' +
                'Por favor envía un mensaje de voz más corto o escribe tu mensaje.'
            );
            return;
        }
        if (audioData.file_size < AUDIO_LIMITS.MIN_SIZE_BYTES) {
            context.log.warn(`[AudioHandler] Audio muy pequeño: ${audioData.file_size} bytes`);
            await whatsapp.sendText(from,
                '🔇 El audio es muy corto para procesarlo.\n\n' +
                'Por favor envía un mensaje de voz más largo o escribe tu mensaje.'
            );
            return;
        }
    }

    // Verificar rate limit para audios
    const rateLimitCheck = rateLimiter.checkRateLimit(from, 'audio');
    if (!rateLimitCheck.allowed) {
        context.log(`[AudioHandler] Rate limit de audio excedido para ${from}`);
        await whatsapp.sendText(from, `⏱️ ${rateLimitCheck.reason}`);
        return;
    }

    // Registrar solicitud de audio
    rateLimiter.recordRequest(from, 'audio');

    // Mostrar "Escribiendo..." mientras procesamos
    whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

    // Notificar al usuario que estamos procesando
    await whatsapp.sendText(from, '🎧 Procesando tu mensaje de voz...');

    try {
        // Descargar el audio de WhatsApp
        context.log(`[AudioHandler] Descargando audio ${audioData.id}...`);
        const audioBuffer = await whatsapp.downloadMedia(audioData.id);
        context.log(`[AudioHandler] Audio descargado: ${audioBuffer.length} bytes`);

        // Transcribir el audio
        context.log(`[AudioHandler] Transcribiendo audio...`);
        const transcription = await transcriptionService.transcribeAudio(audioBuffer, {
            mimeType: mimeType,
            filename: `audio_${messageId}.ogg`
        });

        if (!transcription.success) {
            context.log.warn(`[AudioHandler] Error en transcripción: ${transcription.error}`);

            // Mensajes de error específicos según el código
            let errorMsg = '❌ No pude entender el audio. ';
            if (transcription.errorCode === 'TIMEOUT') {
                errorMsg += 'El audio es muy largo, intenta con uno más corto.';
            } else if (transcription.errorCode === 'INVALID_AUDIO') {
                errorMsg += 'El audio parece estar dañado o vacío.';
            } else if (transcription.errorCode === 'RATE_LIMIT') {
                errorMsg += 'Demasiadas solicitudes, intenta en unos minutos.';
            } else {
                errorMsg += 'Por favor, escribe tu mensaje como texto.';
            }

            await whatsapp.sendText(from, errorMsg);
            return;
        }

        const transcribedText = transcription.text;
        context.log(`[AudioHandler] Audio transcrito: "${transcribedText.substring(0, 100)}${transcribedText.length > 100 ? '...' : ''}"`);

        // Verificar si la transcripción tiene contenido útil
        if (!transcribedText || transcribedText.trim().length < 2) {
            context.log.warn(`[AudioHandler] Transcripción vacía o muy corta`);
            await whatsapp.sendText(from,
                '🔇 No pude detectar palabras en el audio.\n\n' +
                'Por favor habla más claro o escribe tu mensaje.'
            );
            return;
        }

        // Guardar el mensaje de audio en el historial (con el texto transcrito)
        try {
            await db.saveMessage(
                from,
                TIPO_MENSAJE.USUARIO,
                `[Audio transcrito] ${transcribedText}`,
                TIPO_CONTENIDO.AUDIO
            );
        } catch (dbError) {
            context.log.warn(`[AudioHandler] Error guardando mensaje: ${dbError.message}`);
            // Continuar aunque falle el guardado
        }

        // Notificar al usuario qué entendimos
        await whatsapp.sendText(from,
            `🎤 Entendí: _"${transcribedText.substring(0, 200)}${transcribedText.length > 200 ? '...' : ''}"_`
        );

        // Procesar el texto transcrito como si fuera un mensaje de texto normal
        context.log(`[AudioHandler] Procesando texto transcrito como mensaje...`);
        await messageHandler.handleText(from, transcribedText, messageId, context);

        context.log(`[AudioHandler] Audio procesado exitosamente en ${transcription.duration}ms`);

    } catch (error) {
        context.log.error(`[AudioHandler] Error procesando audio:`, error);

        // Determinar mensaje de error apropiado
        let errorMsg = '❌ Hubo un problema procesando tu mensaje de voz.\n\n';
        if (error.message?.includes('download') || error.message?.includes('media')) {
            errorMsg += 'No pude descargar el audio. Por favor, intenta enviarlo nuevamente.';
        } else {
            errorMsg += 'Por favor, escribe tu mensaje como texto o intenta enviar el audio de nuevo.';
        }

        await whatsapp.sendText(from, errorMsg);
    }
}

module.exports = {
    handleAudio,
    isAudioTranscriptionEnabled,
    AUDIO_LIMITS
};
