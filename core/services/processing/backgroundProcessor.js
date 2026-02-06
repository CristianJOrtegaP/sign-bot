/**
 * AC FIXBOT - Procesador en Background
 * Ejecuta tareas pesadas de forma asíncrona sin bloquear el webhook
 */

const whatsapp = require('../external/whatsappService');
const vision = require('../ai/visionService');
const aiService = require('../ai/aiService');
const teamsService = require('../external/teamsService');
const db = require('../storage/databaseService');
const blobService = require('../storage/blobService');
const imageProcessor = require('./imageProcessor');
const _MSG = require('../../../bot/constants/messages');
const { ESTADO, ORIGEN_ACCION, TIPO_REPORTE } = require('../../../bot/constants/sessionStates');
const { safeParseJSON } = require('../../utils/helpers');
const { OCRError } = vision;
const fieldExtractor = require('../../../bot/services/fieldExtractor');
const appInsights = require('../infrastructure/appInsightsService');
const correlation = require('../infrastructure/correlationService');
const config = require('../../config');
const { Semaphore } = require('../../utils/semaphore');

// Limitar concurrencia de procesamiento de imagen (OCR + Vision AI + DB)
const limiter = new Semaphore(config.backgroundProcessor.maxConcurrent, 'BackgroundProcessor');
// FASE 2b: Lazy load para evitar dependencia circular
let flexibleFlowManager = null;
function getFlexibleFlowManager() {
  if (!flexibleFlowManager) {
    flexibleFlowManager = require('../../../bot/flows/reporteFlow');
  }
  return flexibleFlowManager;
}

/**
 * Procesa una imagen en background (OCR + búsqueda de equipo)
 * @param {string} from - Número de teléfono del usuario
 * @param {string} imageId - ID de la imagen en WhatsApp
 * @param {Object} context - Contexto de Azure Functions para logs
 */
async function _processImageInBackgroundCore(from, imageId, context, opts = {}) {
  const startTime = Date.now();
  // Propagar correlation ID si viene del handler
  if (opts.correlationId) {
    correlation.addToContext({ correlationId: opts.correlationId });
  }
  try {
    context.log(`[Background] Iniciando procesamiento de imagen para ${from}`);

    // 1. Descargar imagen
    const imageBuffer = await whatsapp.downloadMedia(imageId);
    context.log(`[Background] Imagen descargada: ${imageBuffer.length} bytes`);

    // 2. Comprimir y subir imagen a Azure Blob Storage
    let imagenUrl = null;
    try {
      const {
        buffer: compressedBuffer,
        originalSize,
        compressedSize,
      } = await imageProcessor.compressImage(imageBuffer);
      context.log(
        `[Background] Imagen comprimida: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB`
      );

      imagenUrl = await blobService.uploadImage(compressedBuffer, from);
      context.log(`[Background] Imagen subida a Blob Storage: ${imagenUrl}`);

      // Actualizar el placeholder con la URL real (en lugar de crear mensaje duplicado)
      const updated = await db.updateImagePlaceholder(from, imageId, imagenUrl);
      if (updated) {
        context.log(`[Background] Placeholder actualizado con URL real`);
      } else {
        // Si no se encontró el placeholder, guardar como nuevo mensaje
        await db.saveMessage(from, 'U', imagenUrl, 'IMAGEN');
        context.log(`[Background] Imagen guardada como mensaje nuevo (placeholder no encontrado)`);
      }
    } catch (uploadError) {
      context.log.warn(
        `[Background] No se pudo subir imagen a Blob Storage: ${uploadError.message}`
      );
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
        await whatsapp.sendAndSaveText(from, ocrError.getUserMessage());
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
        // FASE 2b: Equipo encontrado - usar flujo flexible
        context.log(`[Background] ✅ Equipo encontrado: ${equipo.CodigoSAP} - ${equipo.Modelo}`);

        // Obtener sesión actual (fresh para evitar datos stale en background)
        const session = await db.getSessionFresh(from);
        const datosTemp = safeParseJSON(session.DatosTemp) || {};

        // Agregar URL de imagen a datosTemp
        if (imagenUrl) {
          datosTemp.imagenUrl = imagenUrl;
        }

        // Actualizar campos con el código SAP extraído y datos del equipo
        const camposNuevos = {
          codigoSAP: {
            valor: codigoSAP,
            confianza: 95,
            fuente: 'ocr',
          },
        };

        // Guardar datos del equipo para referencia
        datosTemp.datosEquipo = {
          EquipoId: equipo.EquipoId,
          CodigoSAP: equipo.CodigoSAP,
          Modelo: equipo.Modelo,
          Marca: equipo.Marca,
          NombreCliente: equipo.NombreCliente,
          Ubicacion: equipo.Ubicacion,
        };
        datosTemp.equipoIdTemp = equipo.EquipoId;

        // Usar flexibleFlowManager para procesar y continuar el flujo
        const _flexManager = getFlexibleFlowManager();
        const fieldManager = require('../../../bot/services/fieldManager');

        // Actualizar datosTemp con el nuevo campo
        const { datosActualizados, resumenActualizacion: _resumenActualizacion } =
          fieldManager.actualizarDatosTemp(datosTemp, camposNuevos);

        // Cambiar a estado de confirmación (con optimistic locking)
        await db.updateSession(
          from,
          ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
          datosActualizados,
          equipo.EquipoId,
          ORIGEN_ACCION.BOT,
          `Código SAP detectado por OCR: ${codigoSAP}, esperando confirmación`,
          null,
          session.Version
        );

        // Pedir confirmación al usuario con botones
        const mensajeConfirmacion =
          `✅ *Equipo detectado:*\n\n` +
          `• *SAP:* ${equipo.CodigoSAP}\n` +
          `• *Modelo:* ${equipo.Modelo}\n` +
          `• *Marca:* ${equipo.Marca || 'N/A'}\n` +
          `• *Cliente:* ${equipo.NombreCliente}\n` +
          `• *Ubicación:* ${equipo.Ubicacion || 'N/A'}\n\n` +
          `¿Es correcto este equipo?`;

        await whatsapp.sendAndSaveInteractive(from, '🔍 Confirmar Equipo', mensajeConfirmacion, [
          { id: 'btn_confirmar_equipo', title: '✅ Sí, es correcto' },
          { id: 'btn_rechazar_equipo', title: '❌ No, es otro' },
        ]);

        context.log(`[Background] ⏳ Esperando confirmación del usuario`);
      } else {
        // Código detectado pero equipo no encontrado
        await whatsapp.sendAndSaveText(
          from,
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

      await whatsapp.sendAndSaveText(
        from,
        '🔍 Analicé la imagen pero no encontré un código SAP válido.\n\n' +
          '*El código SAP debe tener 7 dígitos numéricos.*\n\n' +
          '*Sugerencias:*\n' +
          '• Asegúrate de que el código de barras esté completo en la imagen\n' +
          '• Los números debajo del código deben ser legibles\n' +
          '• Evita sombras o reflejos sobre el código\n\n' +
          'También puedes ingresar el código SAP manualmente (7 dígitos).'
      );
    }

    // App Insights: rastrear procesamiento de imagen OCR
    appInsights.trackEvent(
      'image_processed',
      {
        metodo: 'OCR',
        exito: true,
        codigoDetectado: Boolean(codigoSAP),
        codigoSAP: codigoSAP || null,
      },
      {
        duracionMs: Date.now() - startTime,
        lineasOCR: ocrResult?.lines?.length || 0,
      }
    );

    context.log(`[Background] ✅ Procesamiento completado para ${from}`);
  } catch (error) {
    context.log.error('[Background] ❌ Error procesando imagen:', error);

    appInsights.trackEvent(
      'image_processed',
      {
        metodo: 'OCR',
        exito: false,
        errorMessage: error.message,
      },
      {
        duracionMs: Date.now() - startTime,
      }
    );

    // Si es un OCRError que no fue manejado antes
    if (error instanceof OCRError) {
      await whatsapp.sendAndSaveText(from, error.getUserMessage());
    } else {
      await whatsapp.sendAndSaveText(
        from,
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
async function _processImageWithAIVisionCore(from, imageId, caption, context, opts = {}) {
  const startTime = Date.now();
  // Propagar correlation ID si viene del handler
  if (opts.correlationId) {
    correlation.addToContext({ correlationId: opts.correlationId });
  }
  try {
    context.log(`[Background AI Vision] Iniciando análisis de imagen para ${from}`);

    // 1. Descargar imagen
    const imageBuffer = await whatsapp.downloadMedia(imageId);
    context.log(`[Background AI Vision] Imagen descargada: ${imageBuffer.length} bytes`);

    // 2. Comprimir y subir imagen a Azure Blob Storage
    let imagenUrl = null;
    try {
      const {
        buffer: compressedBuffer,
        originalSize,
        compressedSize,
      } = await imageProcessor.compressImage(imageBuffer);
      context.log(
        `[Background AI Vision] Imagen comprimida: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB`
      );

      imagenUrl = await blobService.uploadImage(compressedBuffer, from);
      context.log(`[Background AI Vision] Imagen subida a Blob Storage: ${imagenUrl}`);

      // Actualizar el placeholder con la URL real (en lugar de crear mensaje duplicado)
      const updated = await db.updateImagePlaceholder(from, imageId, imagenUrl);
      if (updated) {
        context.log(`[Background AI Vision] Placeholder actualizado con URL real`);
      } else {
        // Si no se encontró el placeholder, guardar como nuevo mensaje
        await db.saveMessage(from, 'U', imagenUrl, 'IMAGEN');
        context.log(
          `[Background AI Vision] Imagen guardada como mensaje nuevo (placeholder no encontrado)`
        );
      }
    } catch (uploadError) {
      context.log.warn(
        `[Background AI Vision] No se pudo subir imagen a Blob Storage: ${uploadError.message}`
      );
    }

    // 3. Filtro de calidad: detectar imagen borrosa antes de gastar tokens
    const blurResult = await imageProcessor.detectBlur(imageBuffer);
    if (blurResult.isBlurry) {
      context.log.warn(
        `[Background AI Vision] Imagen borrosa detectada (score: ${blurResult.score}, umbral: ${blurResult.threshold})`
      );
      appInsights.trackEvent('image_blur_rejected', {
        from,
        score: blurResult.score,
        threshold: blurResult.threshold,
      });
      await whatsapp.sendAndSaveText(
        from,
        '📷 La imagen parece estar *borrosa o desenfocada*.\n\n' +
          '*Sugerencias para una mejor foto:*\n' +
          '• Mantén la cámara estable al tomar la foto\n' +
          '• Asegúrate de que haya buena iluminación\n' +
          '• Enfoca el objeto antes de tomar la foto\n' +
          '• Limpia el lente de la cámara\n\n' +
          'Por favor, intenta enviar una nueva foto más clara.'
      );
      return;
    }
    context.log(`[Background AI Vision] Filtro de blur pasado (score: ${blurResult.score})`);

    // 4. Analizar imagen con AI Vision
    context.log(`[Background AI Vision] Analizando imagen con AI...`);
    const analisisAI = await aiService.analyzeImageWithVision(imageBuffer, caption);
    context.log(`[Background AI Vision] Análisis completado:`, JSON.stringify(analisisAI));

    // 4.1 Validar calidad reportada por IA
    if (analisisAI.calidad_imagen === 'baja' && analisisAI.confianza < 30) {
      context.log.warn(
        `[Background AI Vision] IA reporta calidad baja con confianza ${analisisAI.confianza}`
      );
      appInsights.trackEvent('image_low_quality_ai', {
        from,
        calidad: analisisAI.calidad_imagen,
        confianza: analisisAI.confianza,
      });
      await whatsapp.sendAndSaveText(
        from,
        '📷 No pude distinguir la información en la imagen con suficiente claridad.\n\n' +
          '*Sugerencias:*\n' +
          '• Toma la foto más de cerca\n' +
          '• Mejora la iluminación\n' +
          '• Evita ángulos muy inclinados\n\n' +
          'Intenta enviar una nueva foto o proporciona los datos manualmente.'
      );
      return;
    }

    // 3.5 NUEVO: Procesar caption con fieldExtractor para complementar AI Vision
    // AI Vision puede no reconocer patrones como "Vehículo 628329" = código SAP
    let camposCaption = {};
    if (caption && caption.trim().length > 0) {
      context.log(`[Background AI Vision] Procesando caption con fieldExtractor: "${caption}"`);
      const resultCaption = await fieldExtractor.extractAllFields(caption, {
        tipoReporte: analisisAI.tipo_equipo || null,
        useAI: false, // Solo regex, AI ya analizó
        context: null,
      });
      camposCaption = resultCaption.campos || {};
      context.log(
        `[Background AI Vision] Campos extraídos del caption: ${JSON.stringify(Object.keys(camposCaption))}`
      );

      // Complementar AI Vision con campos del caption que no detectó
      if (!analisisAI.codigo_sap && camposCaption.codigoSAP) {
        analisisAI.codigo_sap = camposCaption.codigoSAP.valor;
        context.log(
          `[Background AI Vision] ✅ Código SAP extraído del caption: ${analisisAI.codigo_sap}`
        );
      }
      if (!analisisAI.numero_empleado && camposCaption.numeroEmpleado) {
        analisisAI.numero_empleado = camposCaption.numeroEmpleado.valor;
        context.log(
          `[Background AI Vision] ✅ Número empleado extraído del caption: ${analisisAI.numero_empleado}`
        );
      }
    }

    // 4. Obtener sesión actual (fresh para evitar datos stale en background)
    const session = await db.getSessionFresh(from);
    const datosTemp = safeParseJSON(session.DatosTemp) || {};

    // 5. Agregar URL de imagen a datosTemp
    if (imagenUrl) {
      datosTemp.imagenUrl = imagenUrl;
      context.log(`[Background AI Vision] imagenUrl agregada a datosTemp`);
    }

    // 6. PRIMERO: Determinar tipo de equipo (antes de guardar datos)
    // Esto es crítico para guardar los datos en los campos correctos
    if (!datosTemp.tipoReporte && analisisAI.tipo_equipo) {
      if (analisisAI.tipo_equipo === 'REFRIGERADOR') {
        datosTemp.tipoReporte = TIPO_REPORTE.REFRIGERADOR;
        context.log(`[Background AI Vision] Tipo de equipo detectado: REFRIGERADOR`);
      } else if (analisisAI.tipo_equipo === 'VEHICULO') {
        datosTemp.tipoReporte = TIPO_REPORTE.VEHICULO;
        context.log(`[Background AI Vision] Tipo de equipo detectado: VEHICULO`);
      }
    }

    // 7. Ahora guardar los datos en los campos correctos según el tipo
    let codigoDetectado = false;
    let empleadoDetectado = false;
    let problemaDetectado = false;
    const tipoEquipoDetectado = Boolean(datosTemp.tipoReporte);

    if (analisisAI.codigo_sap && analisisAI.confianza > 50) {
      // Para vehículos usamos codigoSAPVehiculo
      if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO) {
        datosTemp.codigoSAPVehiculo = analisisAI.codigo_sap;
        context.log(
          `[Background AI Vision] Código SAP Vehículo detectado: ${analisisAI.codigo_sap}`
        );
      } else {
        datosTemp.codigoSAP = analisisAI.codigo_sap;
        context.log(`[Background AI Vision] Código SAP detectado: ${analisisAI.codigo_sap}`);
      }
      codigoDetectado = true;
    }

    if (analisisAI.numero_empleado) {
      datosTemp.numeroEmpleado = analisisAI.numero_empleado;
      context.log(
        `[Background AI Vision] Número de empleado detectado: ${analisisAI.numero_empleado}`
      );
      empleadoDetectado = true;
    }

    if (analisisAI.problema) {
      // Para vehículos usamos problemaTemp, para refrigerador usamos problema
      if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO) {
        datosTemp.problemaTemp = analisisAI.problema;
      } else {
        datosTemp.problema = analisisAI.problema;
      }
      context.log(`[Background AI Vision] Problema detectado: ${analisisAI.problema}`);
      problemaDetectado = true;
    }

    // 8. Guardar información visual para referencia
    if (analisisAI.informacion_visual) {
      datosTemp.informacionVisual = analisisAI.informacion_visual;
    }

    // 9. Determinar el nuevo estado según tipo de equipo y datos detectados
    // NOTA: session.Estado contiene el código del estado actual (no session.EstadoCodigo)
    let nuevoEstado = session.Estado;
    context.log(`[Background AI Vision] Estado actual de sesión: ${nuevoEstado}`);
    const hayDatosUtiles =
      codigoDetectado || empleadoDetectado || problemaDetectado || tipoEquipoDetectado;
    context.log(
      `[Background AI Vision] hayDatosUtiles=${hayDatosUtiles}, tipoReporte=${datosTemp.tipoReporte}`
    );

    if (hayDatosUtiles && datosTemp.tipoReporte) {
      // Cambiar a estado de confirmación según tipo de equipo
      if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO) {
        nuevoEstado = ESTADO.VEHICULO_CONFIRMAR_DATOS_AI;
        context.log(`[Background AI Vision] Cambiando estado a VEHICULO_CONFIRMAR_DATOS_AI`);
      } else if (datosTemp.tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
        nuevoEstado = ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI;
        context.log(`[Background AI Vision] Cambiando estado a REFRIGERADOR_CONFIRMAR_DATOS_AI`);
      }
    }

    // Actualizar sesión con los datos extraídos y nuevo estado
    context.log(
      `[Background AI Vision] 📝 Actualizando sesión: estado=${nuevoEstado}, datosTemp=${JSON.stringify(datosTemp)}`
    );
    try {
      await db.updateSession(
        from,
        nuevoEstado,
        datosTemp,
        session.EquipoIdTemp,
        ORIGEN_ACCION.BOT,
        'Datos extraídos de imagen con AI Vision',
        null,
        session.Version
      );
      context.log(`[Background AI Vision] ✅ Sesión actualizada exitosamente a ${nuevoEstado}`);

      // Notificar a Teams sobre análisis AI Vision (fire-and-forget)
      teamsService
        .notifyAIVisionAnalysis(from, {
          tipo_equipo: datosTemp.tipoReporte,
          codigo_sap: analisisAI.codigo_sap,
          numero_empleado: analisisAI.numero_empleado,
          problema: analisisAI.problema,
          informacion_visual: analisisAI.informacion_visual,
        })
        .catch(() => {}); // Silenciar errores de Teams
    } catch (updateError) {
      context.log.error(
        `[Background AI Vision] ❌ Error actualizando sesión: ${updateError.message}`
      );
      throw updateError;
    }

    // 10. Construir mensaje de respuesta
    let mensaje = '🤖 *Análisis de imagen completado*\n\n';

    if (analisisAI.informacion_visual) {
      mensaje += `📷 *Lo que veo:* ${analisisAI.informacion_visual}\n\n`;
    }

    const datosDetectados = [];

    // Mostrar tipo de equipo detectado
    if (datosTemp.tipoReporte) {
      const tipoTexto =
        datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO ? 'Vehículo' : 'Refrigerador';
      datosDetectados.push(`• Tipo de equipo: *${tipoTexto}*`);
    }

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
      mensaje += `*Información detectada:*\n${datosDetectados.join('\n')}\n\n`;
      mensaje += '¿La información es correcta? Confirma para continuar con el reporte.';

      // Enviar mensaje con botones de confirmación
      await whatsapp.sendAndSaveInteractive(from, '🤖 Confirmar datos', mensaje, [
        { id: 'btn_confirmar_ai', title: '✅ Sí, continuar' },
        { id: 'btn_rechazar_ai', title: '❌ No, corregir' },
      ]);
    } else {
      mensaje += '⚠️ No pude detectar información específica en la imagen.\n\n';
      mensaje += 'Por favor, proporciona los datos manualmente o intenta con una imagen más clara.';
      await whatsapp.sendAndSaveText(from, mensaje);
    }

    // App Insights: rastrear procesamiento de imagen AI Vision
    appInsights.trackEvent(
      'image_processed',
      {
        metodo: 'AI_VISION',
        exito: true,
        tipoEquipo: datosTemp.tipoReporte || null,
        codigoDetectado: codigoDetectado,
        empleadoDetectado: empleadoDetectado,
        problemaDetectado: problemaDetectado,
      },
      {
        duracionMs: Date.now() - startTime,
        confianza: analisisAI.confianza || 0,
        datosDetectados: datosDetectados.length,
      }
    );

    context.log(`[Background AI Vision] ✅ Procesamiento completado para ${from}`);
  } catch (error) {
    context.log.error('[Background AI Vision] ❌ Error procesando imagen:', error);

    appInsights.trackEvent(
      'image_processed',
      {
        metodo: 'AI_VISION',
        exito: false,
        errorMessage: error.message,
      },
      {
        duracionMs: Date.now() - startTime,
      }
    );

    await whatsapp.sendAndSaveText(
      from,
      '❌ Hubo un problema al analizar la imagen.\n\n' +
        'Por favor, intenta nuevamente o proporciona los datos manualmente.'
    );
  }
}

/**
 * Wrapper con semáforo de concurrencia para processImageInBackground.
 * Si el límite está alcanzado, notifica al usuario y retorna sin procesar.
 */
async function processImageInBackground(from, imageId, context, opts = {}) {
  const result = limiter.tryRun(() => _processImageInBackgroundCore(from, imageId, context, opts));
  if (result === null) {
    context.log.warn(
      `[Background] Capacidad de procesamiento alcanzada, rechazando imagen de ${from}`
    );
    const whatsappSvc = require('../external/whatsappService');
    await whatsappSvc.sendAndSaveText(
      from,
      '⏳ Hay muchas imágenes procesándose en este momento.\nPor favor, intenta de nuevo en unos segundos.'
    );
    return;
  }
  return result;
}

/**
 * Wrapper con semáforo de concurrencia para processImageWithAIVision.
 * Si el límite está alcanzado, notifica al usuario y retorna sin procesar.
 */
async function processImageWithAIVision(from, imageId, caption, context, opts = {}) {
  const result = limiter.tryRun(() =>
    _processImageWithAIVisionCore(from, imageId, caption, context, opts)
  );
  if (result === null) {
    context.log.warn(
      `[Background AI Vision] Capacidad de procesamiento alcanzada, rechazando imagen de ${from}`
    );
    const whatsappSvc = require('../external/whatsappService');
    await whatsappSvc.sendAndSaveText(
      from,
      '⏳ Hay muchas imágenes procesándose en este momento.\nPor favor, intenta de nuevo en unos segundos.'
    );
    return;
  }
  return result;
}

function getProcessingStats() {
  return limiter.stats();
}

module.exports = {
  processImageInBackground,
  processImageWithAIVision,
  getProcessingStats,
};
