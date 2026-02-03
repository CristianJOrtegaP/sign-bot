/**
 * AC FIXBOT - Flujo de Encuesta de Satisfaccion (REFACTORIZADO)
 * Maneja el proceso completo de encuesta con preguntas dinámicas
 *
 * Optimizaciones v3 (Normalizado):
 * - Preguntas dinámicas desde catálogo PreguntasEncuesta
 * - Soporte para diferentes tipos de encuesta (CatTipoEncuesta)
 * - Estados normalizados (CatEstadoEncuesta)
 * - Respuestas en tabla normalizada (RespuestasEncuesta)
 * - Número de preguntas configurable por tipo
 * - Query única para obtener encuesta + pregunta actual
 * - Verificación de estado ANTES de enviar WhatsApp (evita race conditions)
 * - Operación atómica para guardar respuesta
 */

const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const EncuestaRepository = require('../../repositories/EncuestaRepository');
const { ENCUESTA: MSG, BUTTONS_ENCUESTA } = require('../../constants/messages');
const { safeParseJSON } = require('../../../core/utils/helpers');
const { logger } = require('../../../core/services/infrastructure/errorHandler');
const {
    ESTADO,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO
} = require('../../constants/sessionStates');

// ============================================
// CACHE EN MEMORIA PARA ENCUESTAS ACTIVAS
// Incluye PreguntaActual, TipoEncuestaId, NumeroPreguntas y Preguntas
// ============================================
const encuestaCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

// Cache de preguntas por tipo (estático, no cambia frecuentemente)
const preguntasCache = new Map();
const PREGUNTAS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

/**
 * Obtiene las preguntas de un tipo de encuesta (con cache)
 * @param {number} tipoEncuestaId - ID del tipo de encuesta
 * @returns {Promise<Array>}
 */
async function getPreguntasCached(tipoEncuestaId) {
    const cacheKey = `tipo_${tipoEncuestaId}`;
    const cached = preguntasCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < PREGUNTAS_CACHE_TTL_MS) {
        return cached.preguntas;
    }

    const preguntas = await EncuestaRepository.getPreguntasByTipo(tipoEncuestaId);
    preguntasCache.set(cacheKey, { preguntas, timestamp: Date.now() });
    return preguntas;
}

/**
 * Obtiene datos de encuesta del cache o BD (query optimizada)
 * Incluye: encuestaId, reporteId, numeroTicket, preguntaActual, tipoEncuestaId, numeroPreguntas, preguntas
 */
async function getEncuestaCached(telefono, context) {
    const cached = encuestaCache.get(telefono);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        context?.log(`[Cache] encuesta hit: ${cached.encuestaId}, preguntaActual: ${cached.preguntaActual}`);
        return cached;
    }

    // Query optimizada: obtiene TODO en una sola llamada (incluye info de tipo)
    const encuesta = await EncuestaRepository.getEncuestaCompletaByTelefono(telefono, false);
    if (encuesta) {
        // Obtener preguntas del tipo de encuesta
        const preguntas = encuesta.TipoEncuestaId
            ? await getPreguntasCached(encuesta.TipoEncuestaId)
            : [];

        const data = {
            encuestaId: encuesta.EncuestaId,
            reporteId: encuesta.ReporteId,
            numeroTicket: encuesta.NumeroTicket,
            preguntaActual: encuesta.PreguntaActual ?? 0,
            estado: encuesta.Estado,
            tipoEncuestaId: encuesta.TipoEncuestaId,
            tipoEncuestaCodigo: encuesta.TipoEncuestaCodigo,
            numeroPreguntas: encuesta.NumeroPreguntas || 6,
            tienePasoComentario: encuesta.TienePasoComentario ?? true,
            mensajeAgradecimiento: encuesta.MensajeAgradecimiento,
            preguntas: preguntas,
            timestamp: Date.now()
        };
        encuestaCache.set(telefono, data);
        context?.log(`[Cache] encuesta set: ${data.encuestaId}, preguntaActual: ${data.preguntaActual}, numPreguntas: ${data.numeroPreguntas}`);
        return data;
    }

    return null;
}

/**
 * Actualiza el cache local con nueva preguntaActual
 */
function updateCachePregunta(telefono, nuevaPreguntaActual) {
    const cached = encuestaCache.get(telefono);
    if (cached) {
        cached.preguntaActual = nuevaPreguntaActual;
        cached.timestamp = Date.now();
    }
}

/**
 * Guarda encuestaId en cache con datos del tipo de encuesta
 * @param {string} telefono
 * @param {number} encuestaId
 * @param {number} reporteId
 * @param {string} numeroTicket
 * @param {Object} tipoEncuesta - Datos del tipo de encuesta (opcional)
 * @param {Array} preguntas - Preguntas de la encuesta (opcional)
 */
function setEncuestaCache(telefono, encuestaId, reporteId, numeroTicket, tipoEncuesta = null, preguntas = []) {
    encuestaCache.set(telefono, {
        encuestaId,
        reporteId,
        numeroTicket,
        preguntaActual: 0,
        estado: 'ENVIADA',
        tipoEncuestaId: tipoEncuesta?.TipoEncuestaId || null,
        tipoEncuestaCodigo: tipoEncuesta?.Codigo || 'SATISFACCION_SERVICIO',
        numeroPreguntas: tipoEncuesta?.NumeroPreguntas || 6,
        tienePasoComentario: tipoEncuesta?.TienePasoComentario ?? true,
        mensajeAgradecimiento: tipoEncuesta?.MensajeAgradecimiento || null,
        preguntas: preguntas,
        timestamp: Date.now()
    });
}

/**
 * Limpia cache para un teléfono
 */
function clearEncuestaCache(telefono) {
    encuestaCache.delete(telefono);
}

// Limpieza periódica del cache (cada 10 minutos)
// .unref() permite que el proceso termine sin esperar este timer
setInterval(() => {
    const now = Date.now();
    for (const [telefono, data] of encuestaCache.entries()) {
        if (now - data.timestamp > CACHE_TTL_MS) {
            encuestaCache.delete(telefono);
        }
    }
}, 10 * 60 * 1000).unref();

// ============================================
// MAPEOS DE ESTADOS (para compatibilidad con estados de sesión)
// ============================================

/**
 * Mapeo de número de pregunta a estado de sesión
 * Usado para actualizar el estado de la sesión según la pregunta actual
 */
const PREGUNTA_A_ESTADO = {
    1: ESTADO.ENCUESTA_PREGUNTA_1,
    2: ESTADO.ENCUESTA_PREGUNTA_2,
    3: ESTADO.ENCUESTA_PREGUNTA_3,
    4: ESTADO.ENCUESTA_PREGUNTA_4,
    5: ESTADO.ENCUESTA_PREGUNTA_5,
    6: ESTADO.ENCUESTA_PREGUNTA_6
};

/**
 * Mensajes de preguntas de fallback (cuando no hay preguntas en catálogo)
 * Estos mensajes se usan solo si la tabla PreguntasEncuesta está vacía
 */
const PREGUNTA_MENSAJES = {
    1: MSG.PREGUNTA_1,
    2: MSG.PREGUNTA_2,
    3: MSG.PREGUNTA_3,
    4: MSG.PREGUNTA_4,
    5: MSG.PREGUNTA_5,
    6: MSG.PREGUNTA_6
};

// ============================================
// FUNCIONES PRINCIPALES
// ============================================

/**
 * Inicia el flujo de encuesta (llamado desde el timer)
 * @param {string} telefono - Teléfono del usuario
 * @param {Object} reporte - Datos del reporte
 * @param {number} encuestaId - ID de la encuesta (si ya fue creada)
 * @param {Object} tipoEncuesta - Datos del tipo de encuesta (opcional)
 * @param {Array} preguntas - Preguntas de la encuesta (opcional)
 */
async function iniciarEncuesta(telefono, reporte, encuestaId, tipoEncuesta = null, preguntas = []) {
    try {
        logger.info(`Iniciando encuesta para ${telefono}, ticket: ${reporte.NumeroTicket}`);

        // Guardar en cache con datos del tipo de encuesta
        setEncuestaCache(telefono, encuestaId, reporte.ReporteId, reporte.NumeroTicket, tipoEncuesta, preguntas);

        const datosTemp = JSON.stringify({
            encuestaId: encuestaId,
            reporteId: reporte.ReporteId,
            numeroTicket: reporte.NumeroTicket,
            tipoEncuestaId: tipoEncuesta?.TipoEncuestaId || null,
            numeroPreguntas: tipoEncuesta?.NumeroPreguntas || 6
        });

        // Enviar invitación PRIMERO (user feedback rápido)
        const msgInvitacion = MSG.invitacion(reporte.NombreCliente, reporte.NumeroTicket);
        await whatsapp.sendInteractiveMessage(
            telefono,
            MSG.INVITACION_TITLE,
            msgInvitacion,
            [BUTTONS_ENCUESTA.ACEPTAR, BUTTONS_ENCUESTA.SALIR]
        );

        // Actualizar sesión y guardar mensaje en paralelo (Promise.allSettled para no perder errores)
        const results = await Promise.allSettled([
            db.updateSession(
                telefono,
                ESTADO.ENCUESTA_INVITACION,
                datosTemp,
                null,
                ORIGEN_ACCION.SISTEMA,
                `Encuesta iniciada para ticket ${reporte.NumeroTicket}`
            ),
            db.saveMessage(telefono, TIPO_MENSAJE.BOT, msgInvitacion, TIPO_CONTENIDO.TEXTO)
        ]);

        // Log de errores sin interrumpir el flujo (mensaje ya enviado)
        results.forEach((result, idx) => {
            if (result.status === 'rejected') {
                logger.warn('Error en operación paralela iniciarEncuesta', {
                    operacion: idx === 0 ? 'updateSession' : 'saveMessage',
                    error: result.reason?.message
                });
            }
        });

        return true;
    } catch (error) {
        logger.error('Error iniciando encuesta', error, { telefono });
        return false;
    }
}

/**
 * Maneja la respuesta a la invitacion
 */
async function handleInvitacion(from, input, session, context) {
    let datosTemp = safeParseJSON(session.DatosTemp) || {};
    let encuestaId = datosTemp?.encuestaId;

    // Intentar recuperar del cache si no está en datosTemp
    if (!encuestaId) {
        const cached = await getEncuestaCached(from, context);
        if (cached) {
            encuestaId = cached.encuestaId;
            datosTemp = { ...datosTemp, ...cached };
        }
    }

    if (!encuestaId) {
        context.log('Error: encuestaId no encontrada');
        await whatsapp.sendText(from, 'Hubo un error. Intenta de nuevo mas tarde.');
        return;
    }

    const inputLower = input.toLowerCase().trim();
    const esAceptar = inputLower === 'aceptar' || inputLower === 'si' || inputLower === 'sí';
    const esRechazar = inputLower === 'salir' || inputLower === 'no';

    if (esAceptar) {
        await aceptarEncuesta(from, encuestaId, datosTemp, context);
    } else if (esRechazar) {
        await rechazarEncuesta(from, encuestaId, context);
    } else {
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.INVITACION_TITLE,
            MSG.SELECCIONA_OPCION,
            [BUTTONS_ENCUESTA.ACEPTAR, BUTTONS_ENCUESTA.SALIR]
        );
    }
}

/**
 * Usuario acepta la encuesta (versión con preguntas dinámicas)
 */
async function aceptarEncuesta(from, encuestaId, datosTemp, context) {
    context?.log(`aceptarEncuesta - encuestaId: ${encuestaId}`);

    // Obtener datos de la encuesta del cache (incluye preguntas)
    const encuestaData = await getEncuestaCached(from, context);
    const preguntas = encuestaData?.preguntas || [];
    const numeroPreguntas = encuestaData?.numeroPreguntas || 6;

    const datosTempActualizado = {
        ...datosTemp,
        encuestaId,
        tipoEncuestaId: encuestaData?.tipoEncuestaId,
        numeroPreguntas
    };
    const datosTempStr = JSON.stringify(datosTempActualizado);

    // 1. Actualizar BD primero (estado EN_PROCESO resetea PreguntaActual a 0)
    const resultsAceptar = await Promise.allSettled([
        EncuestaRepository.updateEstado(encuestaId, 'EN_PROCESO'),
        db.updateSession(from, ESTADO.ENCUESTA_PREGUNTA_1, datosTempStr, null, ORIGEN_ACCION.USUARIO, 'Encuesta aceptada')
    ]);

    // Log errores pero continuar (usuario ya vio la respuesta)
    resultsAceptar.forEach((result, idx) => {
        if (result.status === 'rejected') {
            logger.error('Error en aceptarEncuesta', result.reason, {
                operacion: idx === 0 ? 'updateEstado' : 'updateSession',
                encuestaId
            });
        }
    });

    // 2. Actualizar cache local
    updateCachePregunta(from, 0);

    // 3. Enviar mensajes
    await whatsapp.sendText(from, MSG.INSTRUCCIONES);

    // Obtener primera pregunta (dinámica o fallback)
    const primeraPregunta = preguntas.find(p => p.NumeroPregunta === 1);
    const textoPregunta = primeraPregunta?.TextoPregunta || MSG.PREGUNTA_1;
    const mensajePregunta = `${textoPregunta}\n\n_Escribe un numero del 1 al 5_`;

    await whatsapp.sendInteractiveMessage(
        from,
        MSG.PREGUNTA_TITLE(1),
        mensajePregunta,
        [BUTTONS_ENCUESTA.RATING_1, BUTTONS_ENCUESTA.RATING_3, BUTTONS_ENCUESTA.RATING_5]
    );

    // Fire-and-forget para logs
    db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.INSTRUCCIONES, TIPO_CONTENIDO.TEXTO).catch(() => {});
    db.saveMessage(from, TIPO_MENSAJE.BOT, textoPregunta, TIPO_CONTENIDO.TEXTO).catch(() => {});
}

/**
 * Usuario rechaza la encuesta
 */
async function rechazarEncuesta(from, encuestaId, _context) {
    // 1. Enviar mensaje PRIMERO
    await whatsapp.sendText(from, MSG.ENCUESTA_RECHAZADA);

    // 2. Operaciones de BD en paralelo (Promise.allSettled para capturar todos los errores)
    const resultsRechazar = await Promise.allSettled([
        EncuestaRepository.updateEstado(encuestaId, 'RECHAZADA'),
        db.updateSession(from, ESTADO.FINALIZADO, null, null, ORIGEN_ACCION.USUARIO, 'Encuesta rechazada')
    ]);

    resultsRechazar.forEach((result, idx) => {
        if (result.status === 'rejected') {
            logger.error('Error en rechazarEncuesta', result.reason, {
                operacion: idx === 0 ? 'updateEstado' : 'updateSession',
                encuestaId
            });
        }
    });

    // Limpiar cache
    clearEncuestaCache(from);

    // Fire-and-forget
    db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.ENCUESTA_RECHAZADA, TIPO_CONTENIDO.TEXTO).catch(() => {});
}

/**
 * Procesa la respuesta a una pregunta de calificacion (OPTIMIZADO + DINÁMICO)
 *
 * Flujo optimizado:
 * 1. Obtener encuesta del cache (incluye preguntaActual y preguntas dinámicas)
 * 2. Verificar estado en BD ANTES de enviar WhatsApp (evita race conditions)
 * 3. Si es inválido, no enviar nada (otro webhook ya procesó)
 * 4. Guardar respuesta de forma atómica
 * 5. Solo si tuvo éxito, enviar WhatsApp y actualizar sesión
 */
async function handleRespuestaPregunta(from, input, _session, context) {
    const startTime = Date.now();

    // 1. Obtener encuesta del cache (query optimizada si no está en cache)
    const encuestaData = await getEncuestaCached(from, context);

    if (!encuestaData) {
        context.log(`No se encontro encuesta activa para ${from}`);
        await whatsapp.sendText(from, 'Hubo un error con la encuesta. Por favor, espera a que te enviemos una nueva invitacion.');
        return;
    }

    const {
        encuestaId,
        preguntaActual: preguntaActualCache,
        numeroPreguntas,
        tienePasoComentario,
        preguntas,
        tipoEncuestaId
    } = encuestaData;

    context.log(`encuestaId: ${encuestaId}, preguntaActualCache: ${preguntaActualCache}, numPreguntas: ${numeroPreguntas}`);

    // 2. Extraer calificación
    const respuesta = extraerCalificacion(input);
    if (!respuesta) {
        context.log(`⚠️ Respuesta invalida detectada: "${input}", enviando mensaje de error`);
        await whatsapp.sendText(from, MSG.RESPUESTA_INVALIDA);
        db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.RESPUESTA_INVALIDA, TIPO_CONTENIDO.TEXTO).catch(() => {});
        context.log(`✅ Mensaje de respuesta invalida enviado`);
        return;
    }

    // 3. Calcular pregunta a responder
    const numeroPreguntaAResponder = preguntaActualCache + 1;
    context.log(`Procesando pregunta: ${numeroPreguntaAResponder}`);

    // Validar rango (dinámico basado en numeroPreguntas)
    if (numeroPreguntaAResponder < 1 || numeroPreguntaAResponder > numeroPreguntas) {
        context.log(`Encuesta ya completada (pregunta ${numeroPreguntaAResponder})`);
        await whatsapp.sendText(from, 'Esta encuesta ya fue completada. ¡Gracias!');
        return;
    }

    // 4. VERIFICAR ESTADO EN BD ANTES DE CONTINUAR (evita race conditions)
    const estadoActual = await EncuestaRepository.verificarEstadoEncuesta(encuestaId, numeroPreguntaAResponder);

    if (!estadoActual.valido) {
        context.log(`Race condition detectada: preguntaActual en BD = ${estadoActual.preguntaActual}, esperada = ${numeroPreguntaAResponder - 1}`);
        return;
    }

    // 5. GUARDAR RESPUESTA DE FORMA ATÓMICA (incluye guardado en tabla normalizada)
    const resultado = await EncuestaRepository.guardarRespuestaAtomica(
        encuestaId,
        numeroPreguntaAResponder,
        respuesta,
        tipoEncuestaId
    );

    if (resultado.alreadyAnswered || !resultado.success) {
        context.log(`Respuesta no guardada: alreadyAnswered=${resultado.alreadyAnswered}, success=${resultado.success}`);
        return;
    }

    // 6. Actualizar cache local
    updateCachePregunta(from, resultado.nuevaPreguntaActual);

    // 7. Determinar siguiente estado (dinámico)
    const esUltimaPregunta = numeroPreguntaAResponder >= numeroPreguntas;
    const siguienteEstado = esUltimaPregunta
        ? (tienePasoComentario ? ESTADO.ENCUESTA_COMENTARIO : ESTADO.FINALIZADO)
        : PREGUNTA_A_ESTADO[numeroPreguntaAResponder + 1] || ESTADO.ENCUESTA_PREGUNTA_1;

    const msgConfirm = MSG.RESPUESTA_REGISTRADA(numeroPreguntaAResponder, numeroPreguntas);

    context.log(`Respuesta ${respuesta} guardada para P${numeroPreguntaAResponder}, siguiente: ${siguienteEstado}`);

    // 8. Enviar respuesta y actualizar sesión
    if (esUltimaPregunta && tienePasoComentario) {
        // Última pregunta - preguntar por comentario
        await whatsapp.sendText(from, msgConfirm);
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.COMENTARIO_TITLE,
            MSG.PREGUNTA_COMENTARIO,
            [BUTTONS_ENCUESTA.SI_COMENTARIO, BUTTONS_ENCUESTA.NO_COMENTARIO]
        );

        db.updateSession(from, siguienteEstado, JSON.stringify(encuestaData), null, ORIGEN_ACCION.USUARIO, `P${numeroPreguntaAResponder}: ${respuesta}`).catch(() => {});
        db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.PREGUNTA_COMENTARIO, TIPO_CONTENIDO.TEXTO).catch(() => {});
    } else if (esUltimaPregunta && !tienePasoComentario) {
        // Última pregunta sin paso de comentario - finalizar directamente
        await finalizarEncuesta(from, encuestaId, false, null, context);
    } else {
        // Siguiente pregunta (dinámica)
        const siguientePreguntaNum = numeroPreguntaAResponder + 1;
        const siguientePregunta = preguntas?.find(p => p.NumeroPregunta === siguientePreguntaNum);
        const siguientePreguntaMsg = siguientePregunta?.TextoPregunta || PREGUNTA_MENSAJES[siguientePreguntaNum] || `Pregunta ${siguientePreguntaNum}`;
        const mensajePregunta = `${siguientePreguntaMsg}\n\n_Escribe un numero del 1 al 5_`;

        await whatsapp.sendText(from, msgConfirm);
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.PREGUNTA_TITLE(siguientePreguntaNum),
            mensajePregunta,
            [BUTTONS_ENCUESTA.RATING_1, BUTTONS_ENCUESTA.RATING_3, BUTTONS_ENCUESTA.RATING_5]
        );

        db.updateSession(from, siguienteEstado, JSON.stringify(encuestaData), null, ORIGEN_ACCION.USUARIO, `P${numeroPreguntaAResponder}: ${respuesta}`).catch(() => {});
        db.saveMessage(from, TIPO_MENSAJE.BOT, siguientePreguntaMsg, TIPO_CONTENIDO.TEXTO).catch(() => {});
    }

    context.log(`handleRespuestaPregunta completado en ${Date.now() - startTime}ms`);
}

/**
 * Maneja la respuesta sobre si quiere dejar comentario
 */
async function handleComentarioDecision(from, input, session, context) {
    context?.log(`[handleComentarioDecision] Iniciando - input: "${input}"`);

    let encuestaId = safeParseJSON(session.DatosTemp)?.encuestaId;

    if (!encuestaId) {
        const cached = await getEncuestaCached(from, context);
        if (cached) {
            encuestaId = cached.encuestaId;
        }
    }

    context?.log(`[handleComentarioDecision] encuestaId: ${encuestaId}`);

    const inputLower = input.toLowerCase().trim();
    const quiereComentario = inputLower === 'si' || inputLower === 'sí';
    const noQuiereComentario = inputLower === 'no';

    context?.log(`[handleComentarioDecision] inputLower: "${inputLower}", quiereComentario: ${quiereComentario}, noQuiereComentario: ${noQuiereComentario}`);

    if (quiereComentario) {
        context?.log(`[handleComentarioDecision] Usuario quiere dejar comentario`);
        context?.log(`[handleComentarioDecision] Estado ANTES de updateSession: ${session?.Estado}`);
        await whatsapp.sendText(from, MSG.ESPERA_COMENTARIO);
        context?.log(`[handleComentarioDecision] Actualizando estado a ENCUESTA_ESPERA_COMENTARIO...`);
        await db.updateSession(from, ESTADO.ENCUESTA_ESPERA_COMENTARIO, session.DatosTemp, null, ORIGEN_ACCION.USUARIO, 'Quiere comentar');
        context?.log(`[handleComentarioDecision] Estado actualizado a ENCUESTA_ESPERA_COMENTARIO exitosamente`);
        db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.ESPERA_COMENTARIO, TIPO_CONTENIDO.TEXTO).catch(() => {});
    } else if (noQuiereComentario) {
        context?.log(`[handleComentarioDecision] Usuario NO quiere comentario, finalizando`);
        await finalizarEncuesta(from, encuestaId, false, null, context);
    } else {
        // Respuesta no reconocida - reenviar botones con mensaje de ayuda
        context?.log(`[handleComentarioDecision] Respuesta no reconocida: "${input}", reenviando botones`);
        await whatsapp.sendText(from, 'Por favor selecciona una opción usando los botones:');
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.COMENTARIO_TITLE,
            MSG.SELECCIONA_OPCION,
            [BUTTONS_ENCUESTA.SI_COMENTARIO, BUTTONS_ENCUESTA.NO_COMENTARIO]
        );
        context?.log(`[handleComentarioDecision] Botones reenviados`);
    }
}

/**
 * Recibe y guarda el comentario del usuario
 */
async function handleComentario(from, input, session, context) {
    let encuestaId = safeParseJSON(session.DatosTemp)?.encuestaId;

    if (!encuestaId) {
        const cached = await getEncuestaCached(from, context);
        if (cached) {
            encuestaId = cached.encuestaId;
        } else {
            context.log('Error: encuestaId no encontrada para comentario');
            await whatsapp.sendText(from, 'Hubo un error guardando tu comentario.');
            return;
        }
    }

    await finalizarEncuesta(from, encuestaId, true, input, context);
}

/**
 * Finaliza la encuesta (con mensaje dinámico del tipo de encuesta)
 */
async function finalizarEncuesta(from, encuestaId, conComentario, comentario, _context) {
    // Intentar obtener mensaje personalizado del cache
    const encuestaData = encuestaCache.get(from);
    const mensajePersonalizado = encuestaData?.mensajeAgradecimiento;

    // Usar mensaje personalizado si existe, sino fallback a constantes
    let msgAgradecimiento;
    if (mensajePersonalizado) {
        msgAgradecimiento = mensajePersonalizado;
    } else {
        msgAgradecimiento = conComentario
            ? MSG.AGRADECIMIENTO_CON_COMENTARIO
            : MSG.AGRADECIMIENTO;
    }

    // 1. Enviar agradecimiento PRIMERO
    await whatsapp.sendText(from, msgAgradecimiento);

    // 2. BD en paralelo (Promise.allSettled para no perder errores)
    const dbOperations = [
        db.updateSession(from, ESTADO.FINALIZADO, null, null, ORIGEN_ACCION.BOT, 'Encuesta completada')
    ];

    if (conComentario) {
        dbOperations.push(EncuestaRepository.guardarComentario(encuestaId, comentario));
    } else {
        dbOperations.push(EncuestaRepository.finalizarSinComentario(encuestaId));
    }

    const resultsFinalizar = await Promise.allSettled(dbOperations);

    resultsFinalizar.forEach((result, idx) => {
        if (result.status === 'rejected') {
            logger.error('Error en finalizarEncuesta', result.reason, {
                operacion: idx === 0 ? 'updateSession' : (conComentario ? 'guardarComentario' : 'finalizarSinComentario'),
                encuestaId
            });
        }
    });

    // Limpiar cache
    clearEncuestaCache(from);

    // Fire-and-forget
    db.saveMessage(from, TIPO_MENSAJE.BOT, msgAgradecimiento, TIPO_CONTENIDO.TEXTO).catch(() => {});

    logger.info(`Encuesta ${encuestaId} completada`, { telefono: from, conComentario });
}

/**
 * Extrae calificacion numerica del input
 */
function extraerCalificacion(input) {
    const buttonMatch = input.match(/btn_rating_(\d)/);
    if (buttonMatch) {
        return parseInt(buttonMatch[1], 10);
    }

    const numero = parseInt(input.trim(), 10);
    if (numero >= 1 && numero <= 5) {
        return numero;
    }

    const palabras = {
        'pesimo': 1, 'muy malo': 1, 'terrible': 1,
        'malo': 2, 'mal': 2,
        'regular': 3, 'normal': 3, 'ok': 3,
        'bueno': 4, 'bien': 4,
        'excelente': 5, 'muy bueno': 5, 'perfecto': 5
    };

    return palabras[input.toLowerCase().trim()] || null;
}

// ============================================
// HANDLERS PARA BOTONES
// ============================================

async function handleBotonAceptar(from, session, context) {
    const datosTemp = safeParseJSON(session.DatosTemp);
    let encuestaId = datosTemp?.encuestaId;

    if (!encuestaId) {
        const cached = await getEncuestaCached(from, context);
        if (cached) {
            encuestaId = cached.encuestaId;
        }
    }

    await aceptarEncuesta(from, encuestaId, datosTemp || {}, context);
}

async function handleBotonSalir(from, session, context) {
    const datosTemp = safeParseJSON(session.DatosTemp);
    let encuestaId = datosTemp?.encuestaId;

    if (!encuestaId) {
        const cached = await getEncuestaCached(from, context);
        if (cached) {
            encuestaId = cached.encuestaId;
        }
    }

    await rechazarEncuesta(from, encuestaId, context);
}

async function handleBotonRating(from, rating, session, context) {
    context.log(`handleBotonRating - rating: ${rating}, estado: ${session?.Estado}`);
    await handleRespuestaPregunta(from, `btn_rating_${rating}`, session, context);
}

async function handleBotonSiComentario(from, session, context) {
    context?.log(`[handleBotonSiComentario] Botón SÍ presionado, estado actual: ${session?.Estado}`);
    await handleComentarioDecision(from, 'si', session, context);
    context?.log(`[handleBotonSiComentario] Completado`);
}

async function handleBotonNoComentario(from, session, context) {
    await handleComentarioDecision(from, 'no', session, context);
}

module.exports = {
    iniciarEncuesta,
    handleInvitacion,
    handleRespuestaPregunta,
    handleComentarioDecision,
    handleComentario,
    handleBotonAceptar,
    handleBotonSalir,
    handleBotonRating,
    handleBotonSiComentario,
    handleBotonNoComentario,
    // Exportar para testing/debugging
    clearEncuestaCache
};
