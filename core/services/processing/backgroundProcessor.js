/**
 * AC FIXBOT - Procesador en Background
 * Ejecuta tareas pesadas de forma asíncrona sin bloquear el webhook
 */

const whatsapp = require('../external/whatsappService');
const vision = require('../ai/visionService');
const aiService = require('../ai/aiService');
const db = require('../storage/databaseService');
const blobService = require('../storage/blobService');
const imageProcessor = require('./imageProcessor');
const MSG = require('../../../bot/constants/messages');
const { ESTADO, ORIGEN_ACCION, TIPO_REPORTE } = require('../../../bot/constants/sessionStates');
const { safeParseJSON } = require('../../utils/helpers');
const { OCRError } = vision;

/**
 * Procesa una imagen en background (OCR + búsqueda de equipo)
 * @param {string} from - Número de teléfono del usuario
 * @param {string} imageId - ID de la imagen en WhatsApp
 * @param {Object} context - Contexto de Azure Functions para logs
 */
async function processImageInBackground(from, imageId, context) {
    try {
        context.log(`[Background] Iniciando procesamiento de imagen para ${from}`);

        // 1. Descargar imagen
        const imageBuffer = await whatsapp.downloadMedia(imageId);
        context.log(`[Background] Imagen descargada: ${imageBuffer.length} bytes`);

        // 2. Comprimir y subir imagen a Azure Blob Storage
        let imagenUrl = null;
        try {
            const { buffer: compressedBuffer, originalSize, compressedSize } =
                await imageProcessor.compressImage(imageBuffer);
            context.log(`[Background] Imagen comprimida: ${(originalSize/1024).toFixed(1)}KB → ${(compressedSize/1024).toFixed(1)}KB`);

            imagenUrl = await blobService.uploadImage(compressedBuffer, from);
            context.log(`[Background] Imagen subida a Blob Storage: ${imagenUrl}`);
        } catch (uploadError) {
            context.log.warn(`[Background] No se pudo subir imagen a Blob Storage: ${uploadError.message}`);
            // Continuar sin URL de imagen (no es crítico)
        }

        // 3. Extraer texto con OCR
        let ocrResult;
        try {
            ocrResult = await vision.extractTextFromImage(imageBuffer);
            context.log(`[Background] OCR completado: ${ocrResult.lines.length} líneas`);
        } catch (ocrError) {
            // Manejar errores de OCR con mensajes específicos
            if (ocrError instanceof OCRError) {
                context.log(`[Background] ❌ Error OCR tipado: ${ocrError.type}`);
                await whatsapp.sendText(from, ocrError.getUserMessage());
                return;
            }
            throw ocrError;
        }

        // 3. Buscar código SAP
        const codigoSAP = vision.findSAPCode(ocrResult.lines);

        if (codigoSAP) {
            context.log(`[Background] ✅ Código SAP detectado: ${codigoSAP}`);

            // 4. Buscar equipo en BD
            const equipo = await db.getEquipoBySAP(codigoSAP);

            if (equipo) {
                // Equipo encontrado - obtener sesión actual para preservar datosTemp
                const session = await db.getSession(from);
                const datosTemp = safeParseJSON(session.DatosTemp) || {};

                // DEBUG: Log de datosTemp antes de agregar imagenUrl
                context.log(`[Background] datosTemp ANTES: ${JSON.stringify(datosTemp)}`);

                // Agregar URL de imagen a datosTemp
                if (imagenUrl) {
                    datosTemp.imagenUrl = imagenUrl;
                    context.log(`[Background] ✅ imagenUrl agregada a datosTemp: ${imagenUrl}`);
                } else {
                    context.log(`[Background] ⚠️ imagenUrl es NULL, no se agregará a datosTemp`);
                }

                // DEBUG: Log de datosTemp después de agregar imagenUrl
                context.log(`[Background] datosTemp DESPUÉS: ${JSON.stringify(datosTemp)}`);

                // Actualizar sesión preservando datosTemp con la imagen
                await db.updateSession(
                    from,
                    ESTADO.REFRI_CONFIRMAR_EQUIPO,
                    datosTemp,
                    equipo.EquipoId,
                    ORIGEN_ACCION.BOT,
                    `Equipo detectado por OCR: ${equipo.CodigoSAP}`
                );

                context.log(`[Background] ✅ Sesión actualizada con datosTemp que incluye imagenUrl`);

                await whatsapp.sendInteractiveMessage(
                    from,
                    '✅ Código Detectado',
                    `• *Código SAP:* ${equipo.CodigoSAP}\n` +
                    `• *Modelo:* ${equipo.Modelo}\n` +
                    `• *Marca:* ${equipo.Marca || 'N/A'}\n` +
                    `• *Cliente:* ${equipo.NombreCliente}\n` +
                    `• *Ubicación:* ${equipo.Ubicacion || 'N/A'}\n\n` +
                    '¿La información del equipo es correcta?',
                    [
                        MSG.BUTTONS.CONFIRMAR_EQUIPO,
                        MSG.BUTTONS.CORREGIR_EQUIPO,
                        MSG.BUTTONS.CANCELAR
                    ]
                );
            } else {
                // Código detectado pero equipo no encontrado
                await whatsapp.sendText(from,
                    `🔍 Detecté el código *${codigoSAP}* en la imagen,\n` +
                    'pero no encontré ningún equipo registrado con ese número.\n\n' +
                    '¿Podrías verificar que el código es correcto e intentar de nuevo?'
                );
            }
        } else {
            // Texto encontrado pero sin código SAP válido
            context.log('[Background] ❌ No se encontró código SAP en el texto extraído');
            const linesPreview = ocrResult.lines.slice(0, 3).join(', ');
            context.log(`[Background] Texto encontrado: ${linesPreview}...`);

            await whatsapp.sendText(from,
                '🔍 Analicé la imagen pero no encontré un código SAP válido.\n\n' +
                '*El código SAP debe tener 7 dígitos numéricos.*\n\n' +
                '*Sugerencias:*\n' +
                '• Asegúrate de que el código de barras esté completo en la imagen\n' +
                '• Los números debajo del código deben ser legibles\n' +
                '• Evita sombras o reflejos sobre el código\n\n' +
                'También puedes ingresar el código SAP manualmente (7 dígitos).'
            );
        }

        context.log(`[Background] ✅ Procesamiento completado para ${from}`);

    } catch (error) {
        context.log.error('[Background] ❌ Error procesando imagen:', error);

        // Si es un OCRError que no fue manejado antes
        if (error instanceof OCRError) {
            await whatsapp.sendText(from, error.getUserMessage());
        } else {
            await whatsapp.sendText(from,
                '❌ Hubo un problema al procesar la imagen.\n\n' +
                '*Sugerencias:*\n' +
                '• Verifica que la imagen no esté corrupta\n' +
                '• Intenta enviar una nueva foto\n\n' +
                'También puedes ingresar el código SAP manualmente (7 dígitos).'
            );
        }
    }
}

/**
 * Procesa una imagen con AI Vision en background (extracción de datos con IA)
 * @param {string} from - Número de teléfono del usuario
 * @param {string} imageId - ID de la imagen en WhatsApp
 * @param {string} caption - Texto opcional que acompañó la imagen
 * @param {Object} context - Contexto de Azure Functions para logs
 */
async function processImageWithAIVision(from, imageId, caption, context) {
    try {
        context.log(`[Background AI Vision] Iniciando análisis de imagen para ${from}`);

        // 1. Descargar imagen
        const imageBuffer = await whatsapp.downloadMedia(imageId);
        context.log(`[Background AI Vision] Imagen descargada: ${imageBuffer.length} bytes`);

        // 2. Comprimir y subir imagen a Azure Blob Storage
        let imagenUrl = null;
        try {
            const { buffer: compressedBuffer, originalSize, compressedSize } =
                await imageProcessor.compressImage(imageBuffer);
            context.log(`[Background AI Vision] Imagen comprimida: ${(originalSize/1024).toFixed(1)}KB → ${(compressedSize/1024).toFixed(1)}KB`);

            imagenUrl = await blobService.uploadImage(compressedBuffer, from);
            context.log(`[Background AI Vision] Imagen subida a Blob Storage: ${imagenUrl}`);
        } catch (uploadError) {
            context.log.warn(`[Background AI Vision] No se pudo subir imagen a Blob Storage: ${uploadError.message}`);
        }

        // 3. Analizar imagen con AI Vision
        context.log(`[Background AI Vision] Analizando imagen con AI...`);
        const analisisAI = await aiService.analyzeImageWithVision(imageBuffer, caption);
        context.log(`[Background AI Vision] Análisis completado:`, JSON.stringify(analisisAI));

        // 4. Obtener sesión actual
        const session = await db.getSession(from);
        const datosTemp = safeParseJSON(session.DatosTemp) || {};

        // 5. Agregar URL de imagen a datosTemp
        if (imagenUrl) {
            datosTemp.imagenUrl = imagenUrl;
            context.log(`[Background AI Vision] imagenUrl agregada a datosTemp`);
        }

        // 6. Enriquecer datosTemp con datos extraídos de la imagen
        let codigoDetectado = false;
        let empleadoDetectado = false;
        let problemaDetectado = false;

        if (analisisAI.codigo_sap && analisisAI.confianza > 50) {
            // Para vehículos usamos codigoSAPVehiculo
            if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO) {
                datosTemp.codigoSAPVehiculo = analisisAI.codigo_sap;
                context.log(`[Background AI Vision] Código SAP Vehículo detectado: ${analisisAI.codigo_sap}`);
            } else {
                datosTemp.codigoSAP = analisisAI.codigo_sap;
                context.log(`[Background AI Vision] Código SAP detectado: ${analisisAI.codigo_sap}`);
            }
            codigoDetectado = true;
        }

        if (analisisAI.numero_empleado) {
            datosTemp.numeroEmpleado = analisisAI.numero_empleado;
            context.log(`[Background AI Vision] Número de empleado detectado: ${analisisAI.numero_empleado}`);
            empleadoDetectado = true;
        }

        if (analisisAI.problema) {
            // Para vehículos usamos problemaTemp
            if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO) {
                datosTemp.problemaTemp = analisisAI.problema;
            } else {
                datosTemp.problema = analisisAI.problema;
            }
            context.log(`[Background AI Vision] Problema detectado: ${analisisAI.problema}`);
            problemaDetectado = true;
        }

        // 7. Guardar información visual para referencia
        if (analisisAI.informacion_visual) {
            datosTemp.informacionVisual = analisisAI.informacion_visual;
        }

        // 8. Determinar tipo de equipo si no está definido
        if (!datosTemp.tipoReporte && analisisAI.tipo_equipo) {
            if (analisisAI.tipo_equipo === 'REFRIGERADOR') {
                datosTemp.tipoReporte = TIPO_REPORTE.REFRIGERADOR;
            } else if (analisisAI.tipo_equipo === 'VEHICULO') {
                datosTemp.tipoReporte = TIPO_REPORTE.VEHICULO;
            }
        }

        // 9. Determinar el nuevo estado según los datos extraídos
        let nuevoEstado = session.Estado;

        // Si detectamos datos de vehículo y hay información útil, pedir confirmación
        if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO && (codigoDetectado || empleadoDetectado || problemaDetectado)) {
            nuevoEstado = ESTADO.VEHICULO_CONFIRMAR_DATOS_AI;
            context.log(`[Background AI Vision] Cambiando estado a VEHICULO_CONFIRMAR_DATOS_AI para confirmación`);
        }

        // Actualizar sesión con los datos extraídos y nuevo estado
        await db.updateSession(
            from,
            nuevoEstado,
            datosTemp,
            session.EquipoIdTemp,
            ORIGEN_ACCION.BOT,
            'Datos extraídos de imagen con AI Vision'
        );

        // 10. Construir mensaje de respuesta
        let mensaje = '🤖 *Análisis de imagen completado*\n\n';

        if (analisisAI.informacion_visual) {
            mensaje += `📷 *Lo que veo:* ${analisisAI.informacion_visual}\n\n`;
        }

        const datosDetectados = [];
        if (analisisAI.codigo_sap) {
            datosDetectados.push(`• Código SAP: *${analisisAI.codigo_sap}*`);
        }
        if (analisisAI.numero_empleado) {
            datosDetectados.push(`• Número de empleado: *${analisisAI.numero_empleado}*`);
        }
        if (analisisAI.problema) {
            datosDetectados.push(`• Problema: *${analisisAI.problema}*`);
        }
        if (analisisAI.codigos_visibles && analisisAI.codigos_visibles.length > 0) {
            datosDetectados.push(`• Códigos visibles: ${analisisAI.codigos_visibles.join(', ')}`);
        }

        if (datosDetectados.length > 0) {
            mensaje += '*Información detectada:*\n' + datosDetectados.join('\n') + '\n\n';
            mensaje += '¿La información es correcta?';
        } else {
            mensaje += '⚠️ No pude detectar información específica en la imagen.\n\n';
            mensaje += 'Por favor, proporciona los datos manualmente o intenta con una imagen más clara.';
        }

        await whatsapp.sendText(from, mensaje);

        context.log(`[Background AI Vision] ✅ Procesamiento completado para ${from}`);

    } catch (error) {
        context.log.error('[Background AI Vision] ❌ Error procesando imagen:', error);
        await whatsapp.sendText(from,
            '❌ Hubo un problema al analizar la imagen.\n\n' +
            'Por favor, intenta nuevamente o proporciona los datos manualmente.'
        );
    }
}

module.exports = {
    processImageInBackground,
    processImageWithAIVision
};
