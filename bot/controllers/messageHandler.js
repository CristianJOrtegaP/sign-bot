/**
 * AC FIXBOT - Handler de Mensajes V2
 * Procesa mensajes de texto y botones interactivos
 * Incluye spam check BD y guardado de mensajes
 */

const whatsapp = require('../../core/services/external/whatsappService');
const intent = require('../../core/services/ai/intentService');
const db = require('../../core/services/storage/databaseService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const metrics = require('../../core/services/infrastructure/metricsService');
const security = require('../../core/services/infrastructure/securityService');
const MSG = require('../constants/messages');
const { safeParseJSON, sanitizeMessage, validatePhoneE164 } = require('../../core/utils/helpers');
const FlowManager = require('./flows/FlowManager');
const consultaEstadoFlow = require('./flows/consultaEstadoFlow');
const EncuestaRepository = require('../repositories/EncuestaRepository');
const {
    ESTADO,
    TIPO_MENSAJE,
    TIPO_CONTENIDO,
    ORIGEN_ACCION,
    esEstadoTerminal
} = require('../constants/sessionStates');

// Botones de encuesta que NO deben reactivar la sesion a INICIO
const ENCUESTA_BUTTONS = new Set([
    'btn_encuesta_aceptar',
    'btn_encuesta_salir',
    'btn_rating_1',
    'btn_rating_2',
    'btn_rating_3',
    'btn_rating_4',
    'btn_rating_5',
    'btn_si_comentario',
    'btn_no_comentario'
]);

/**
 * Formatea mensaje de confirmación cuando se modifica información
 * @param {Array} modificaciones - Lista de campos modificados
 * @returns {string} - Mensaje formateado
 */
function formatModificacionConfirmacion(modificaciones) {
    const camposFormateados = {
        problema: 'descripción del problema',
        codigo_sap: 'código SAP',
        numero_empleado: 'número de empleado'
    };

    const cambios = modificaciones.map(m => {
        const campoNombre = camposFormateados[m.campo] || m.campo;
        return `*${campoNombre}* actualizado:\n  _Anterior:_ ${m.anterior}\n  _Nuevo:_ ${m.nuevo}`;
    });

    return `Informacion actualizada:\n\n${cambios.join('\n\n')}\n\nContinuamos con tu reporte.`;
}

/**
 * Procesa un mensaje de texto entrante de WhatsApp
 * @param {string} from - Número de teléfono del remitente (formato E.164)
 * @param {string} text - Contenido del mensaje de texto
 * @param {string} messageId - ID único del mensaje de WhatsApp
 * @param {Object} context - Contexto de Azure Functions con logging
 * @returns {Promise<void>}
 */
async function handleText(from, text, messageId, context) {
    const timer = metrics.startTimer('message_handling', context);
    context.log(`Procesando texto de ${from}: ${text}`);

    // Validar formato de teléfono E.164
    const phoneValidation = validatePhoneE164(from);
    if (!phoneValidation.valid) {
        context.log.warn(`⚠️ Teléfono con formato inválido: ${from} - ${phoneValidation.error}`);
        // Continuamos pero registramos la anomalía
    }

    // Sanitizar mensaje de entrada
    const sanitizedText = sanitizeMessage(text);
    if (sanitizedText !== text.trim()) {
        context.log(`🔒 Mensaje sanitizado: "${text}" -> "${sanitizedText}"`);
    }
    text = sanitizedText;

    // Verificar rate limit
    const rateLimitCheck = rateLimiter.checkRateLimit(from, 'message');
    if (!rateLimitCheck.allowed) {
        context.log(`⚠️ Rate limit excedido para ${from}`);
        await whatsapp.sendText(from, `⏱️ ${rateLimitCheck.reason}`);
        timer.end({ rateLimited: true });
        return;
    }

    // Detectar spam (memoria local)
    if (rateLimiter.isSpamming(from)) {
        context.log(`🚨 Spam detectado de ${from} (rate limiter local)`);
        await whatsapp.sendText(from, MSG.RATE_LIMIT.SPAM_WARNING);
        timer.end({ spam: true, source: 'local' });
        return;
    }

    // Detectar spam (base de datos - más preciso)
    const spamCheck = await db.checkSpam(from);
    if (spamCheck.esSpam) {
        context.log(`🚨 Spam detectado de ${from} (BD): ${spamCheck.razon}, ${spamCheck.totalMensajes} mensajes`);
        await whatsapp.sendText(from, MSG.RATE_LIMIT.SPAM_WARNING);
        timer.end({ spam: true, source: 'database', reason: spamCheck.razon });
        return;
    }

    // Registrar solicitud
    rateLimiter.recordRequest(from, 'message');

    // Mostrar "Escribiendo..." (fire-and-forget, no bloquea el flujo)
    whatsapp.sendTypingIndicator(from, messageId).catch(() => {});

    // PERFORMANCE: Paralelizar saveMessage + getSession (~80ms ahorro)
    // Usar allSettled para que fallo en saveMessage no afecte getSession
    const results = await Promise.allSettled([
        db.saveMessage(from, TIPO_MENSAJE.USUARIO, text, TIPO_CONTENIDO.TEXTO),
        db.getSession(from)
    ]);

    // Verificar resultado de saveMessage (no crítico, solo logging)
    if (results[0].status === 'rejected') {
        context.log.warn(`⚠️ Error guardando mensaje: ${results[0].reason?.message}`);
    }

    // Verificar resultado de getSession (crítico, debe existir)
    if (results[1].status === 'rejected') {
        context.log.error(`❌ Error obteniendo sesión: ${results[1].reason?.message}`);
        throw results[1].reason; // Re-lanzar error crítico
    }

    const session = results[1].value;
    context.log(`Estado actual de sesión: ${session.Estado}`);

    // Si la sesión está en un estado terminal (CANCELADO, FINALIZADO, TIMEOUT),
    // reactivarla a INICIO y mostrar bienvenida
    if (session.Estado !== ESTADO.INICIO && esEstadoTerminal(session.Estado)) {
        context.log(`🔄 Reactivando sesión de ${from} desde estado ${session.Estado}`);
        await db.updateSession(
            from,
            ESTADO.INICIO,
            null,
            null,
            ORIGEN_ACCION.USUARIO,
            `Sesión reactivada desde ${session.Estado}`
        );
        session.Estado = ESTADO.INICIO;
    }

    // PERFORMANCE: Paralelizar updateLastActivity + detectIntent (~50ms ahorro)
    // Ambos son independientes: uno actualiza timestamp, otro detecta intencion
    // Usar allSettled para que fallo en updateLastActivity no afecte detectIntent
    const activityResults = await Promise.allSettled([
        db.updateLastActivity(from),
        intent.detectIntent(text)
    ]);

    // Verificar resultado de updateLastActivity (no crítico, solo logging)
    if (activityResults[0].status === 'rejected') {
        context.log.warn(`⚠️ Error actualizando última actividad: ${activityResults[0].reason?.message}`);
    }

    // Verificar resultado de detectIntent (crítico, debe existir)
    if (activityResults[1].status === 'rejected') {
        context.log.error(`❌ Error detectando intención: ${activityResults[1].reason?.message}`);
        throw activityResults[1].reason; // Re-lanzar error crítico
    }

    let detectedIntent = activityResults[1].value;
    context.log(`Intención detectada: ${detectedIntent.intencion} (${detectedIntent.confianza}) - Método: ${detectedIntent.metodo}`);

    // DETECCIÓN DE CONSULTA DE TICKETS: Si el usuario escribe un número de ticket o comando de consulta
    // Detectar patrones como "TKT-BC671636", "BC671636", "mis tickets", "consultar ticket"
    // Formato real: TKT-XXXXXXXX (8 caracteres alfanuméricos)
    const ticketPatternFull = /TKT-[A-Z0-9]{8}/i;
    const ticketPatternShort = /^[A-Z0-9]{8}$/i;
    const consultaKeywords = /^(mis\s*tickets?|ver\s*(mis\s*)?tickets?|consultar\s*tickets?|estado\s*tickets?|ver\s*(mis\s*)?reportes?|consultar\s*reportes?)$/i;

    // Detectar número de ticket en el mensaje
    const ticketMatch = text.match(ticketPatternFull);
    const isShortTicket = ticketPatternShort.test(text.trim());
    const isConsultaKeyword = consultaKeywords.test(text.trim());

    if (session.Estado === ESTADO.INICIO && (ticketMatch || isShortTicket || isConsultaKeyword)) {
        context.log(`🎫 Consulta de ticket detectada: ${text}`);

        if (ticketMatch || isShortTicket) {
            // Consulta directa de un ticket específico
            const numeroTicket = ticketMatch ? ticketMatch[0].toUpperCase() : `TKT-${text.trim().toUpperCase()}`;
            await consultaEstadoFlow.consultarTicketDirecto(from, numeroTicket, context);
        } else {
            // Comando para ver lista de tickets
            await consultaEstadoFlow.iniciarFlujo(from, context);
        }

        timer.end({ intent: 'CONSULTAR_TICKET', method: 'pattern_detection' });
        return;
    }

    // EXTRACCIÓN COMPLETA: Si detectamos REPORTAR_FALLA en mensaje, extraer TODOS los datos posibles
    // Aplica para cualquier método de detección (regex o ai_extract) porque ai_extract no extrae SAP
    // Umbral bajo (15 chars) para capturar mensajes como "Mi carro no enciende" (24 chars)
    if (detectedIntent.intencion === 'REPORTAR_FALLA' &&
        text.trim().length > 15 &&
        !detectedIntent.codigo_sap) {  // Solo si no tenemos SAP aún

        context.log(`🔍 Mensaje detectado (${text.trim().length} chars), extrayendo TODOS los datos con extractAllData...`);
        detectedIntent = await enrichIntentWithStructuredData(text, detectedIntent, context, session.Estado);
    }

    // Si detectamos DESPEDIDA, reiniciar sesión
    if (detectedIntent.intencion === 'DESPEDIDA') {
        await whatsapp.sendText(from, MSG.GENERAL.GOODBYE);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.GOODBYE, TIPO_CONTENIDO.TEXTO);
        await db.updateSession(from, ESTADO.INICIO, null, null, ORIGEN_ACCION.USUARIO, 'Usuario se despidió');
        timer.end({ intent: 'DESPEDIDA', sessionReset: true });
        return;
    }

    // Si detectamos CANCELAR y hay un flujo activo (no en estado terminal), cancelar
    if (detectedIntent.intencion === 'CANCELAR' && !esEstadoTerminal(session.Estado)) {
        await FlowManager.cancelarFlujo(from, context);
        timer.end({ intent: 'CANCELAR', sessionReset: true });
        return;
    }

    // SMART EXTRACTION: Si el usuario está en un flujo y envía mensaje,
    // extraer datos adicionales y actualizar la sesión
    // También detecta si quiere MODIFICAR datos existentes
    if (!esEstadoTerminal(session.Estado) && text.trim().length > 15) {
        const resultado = await enrichSessionWithExtractedData(from, text, session, context);

        // Si hubo modificaciones, enviar confirmación y continuar el flujo
        if (resultado && resultado.modificaciones && resultado.modificaciones.length > 0) {
            const confirmacionMsg = formatModificacionConfirmacion(resultado.modificaciones);
            await whatsapp.sendText(from, confirmacionMsg);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, confirmacionMsg, TIPO_CONTENIDO.TEXTO);
            context.log(`📝 Confirmación de modificación enviada`);
            // NO retornar aquí - dejar que el flujo continúe para pedir siguiente dato
        }
    }

    // Procesar según el estado de la sesión (usando FlowManager)
    const handled = await FlowManager.processSessionState(from, text, session, context);
    if (handled) {
        timer.end({ intent: detectedIntent.intencion, state: session.Estado });
        return;
    }

    // Procesar según la intención detectada
    await processIntent(from, text, session, detectedIntent, context);
    timer.end({ intent: detectedIntent.intencion });
}

/**
 * Enriquece la sesión con datos extraídos de un mensaje (mid-flow)
 * Soporta:
 * - Agregar datos nuevos cuando no existen
 * - MODIFICAR datos existentes cuando el usuario lo solicita explícitamente
 * @returns {Object|null} Información sobre modificaciones realizadas, o null si no hubo cambios
 */
async function enrichSessionWithExtractedData(from, text, session, context) {
    try {
        const aiService = require('../../core/services/ai/aiService');
        const extracted = await aiService.extractAllData(text, session.Estado);

        if (extracted.confianza < 0.7 || extracted.datos_encontrados.length === 0) {
            return null; // No hay datos relevantes para extraer
        }

        context.log(`🧠 Extracción mid-flow: ${JSON.stringify(extracted.datos_encontrados)}, modificación: ${extracted.es_modificacion}`);

        // Obtener datos actuales de la sesión
        const datosTemp = safeParseJSON(session.DatosTemp) || {};
        let needsUpdate = false;
        const modificaciones = [];

        // Determinar si es una modificación explícita
        const esModificacion = extracted.es_modificacion || false;

        // PROBLEMA: Agregar si no existe O modificar si el usuario lo pide
        if (extracted.problema) {
            if (!datosTemp.problemaTemp) {
                // Agregar problema nuevo
                datosTemp.problemaTemp = extracted.problema;
                needsUpdate = true;
                context.log(`🧠 Problema extraído mid-flow: "${extracted.problema}"`);
            } else if (esModificacion && extracted.campo_modificado === 'problema') {
                // Modificar problema existente
                const problemaAnterior = datosTemp.problemaTemp;
                datosTemp.problemaTemp = extracted.problema;
                needsUpdate = true;
                modificaciones.push({
                    campo: 'problema',
                    anterior: problemaAnterior,
                    nuevo: extracted.problema
                });
                context.log(`✏️ Problema MODIFICADO: "${problemaAnterior}" → "${extracted.problema}"`);
            }
        }

        // NÚMERO DE EMPLEADO (solo vehículos): Agregar o modificar
        if (extracted.numero_empleado && datosTemp.tipoReporte === 'VEHICULO') {
            if (!datosTemp.numeroEmpleado) {
                // Agregar empleado nuevo
                datosTemp.numeroEmpleado = extracted.numero_empleado;
                needsUpdate = true;
                context.log(`🧠 Empleado extraído mid-flow: "${extracted.numero_empleado}"`);
            } else if (esModificacion && extracted.campo_modificado === 'numero_empleado') {
                // Modificar empleado existente
                const empleadoAnterior = datosTemp.numeroEmpleado;
                datosTemp.numeroEmpleado = extracted.numero_empleado;
                needsUpdate = true;
                modificaciones.push({
                    campo: 'numero_empleado',
                    anterior: empleadoAnterior,
                    nuevo: extracted.numero_empleado
                });
                context.log(`✏️ Empleado MODIFICADO: "${empleadoAnterior}" → "${extracted.numero_empleado}"`);
            }
        }

        // CÓDIGO SAP: Agregar o modificar
        if (extracted.codigo_sap) {
            const campoSap = datosTemp.tipoReporte === 'VEHICULO' ? 'codigoSAPVehiculo' : 'codigoSapExtraido';
            if (!datosTemp[campoSap]) {
                // Agregar SAP nuevo
                datosTemp[campoSap] = extracted.codigo_sap;
                needsUpdate = true;
                context.log(`🧠 SAP extraído mid-flow: "${extracted.codigo_sap}"`);
            } else if (esModificacion && extracted.campo_modificado === 'codigo_sap') {
                // Modificar SAP existente
                const sapAnterior = datosTemp[campoSap];
                datosTemp[campoSap] = extracted.codigo_sap;
                needsUpdate = true;
                modificaciones.push({
                    campo: 'codigo_sap',
                    anterior: sapAnterior,
                    nuevo: extracted.codigo_sap
                });
                context.log(`✏️ SAP MODIFICADO: "${sapAnterior}" → "${extracted.codigo_sap}"`);
            }
        }

        // Actualizar sesión si encontramos datos nuevos o modificaciones
        if (needsUpdate) {
            const accion = modificaciones.length > 0
                ? `Datos MODIFICADOS: ${modificaciones.map(m => m.campo).join(', ')}`
                : `Datos adicionales extraídos por IA: ${extracted.datos_encontrados.join(', ')}`;

            await db.updateSession(
                from,
                session.Estado,
                datosTemp,
                session.EquipoIdTemp,
                ORIGEN_ACCION.BOT,
                accion
            );
            // Actualizar la referencia local de la sesión
            session.DatosTemp = JSON.stringify(datosTemp);
            context.log(`✅ Sesión ${modificaciones.length > 0 ? 'MODIFICADA' : 'enriquecida'} con datos extraídos`);

            // Retornar información sobre modificaciones para enviar confirmación
            if (modificaciones.length > 0) {
                return { modificaciones, datosTemp };
            }
        }
        return null;
    } catch (error) {
        context.log.error(`❌ Error en extracción mid-flow:`, error);
        return null;
    }
}

/**
 * Detecta tipo de equipo usando regex (fallback cuando AI falla)
 */
function detectTipoEquipoRegex(text) {
    const textLower = text.toLowerCase();

    // Patrones para VEHICULO
    const vehiculoPatterns = [
        /\b(veh[ií]culo|carro|auto|cami[oó]n|camioneta|unidad|transporte)\b/i,
        /\b(sin gas|sin gasolina|sin combustible|se qued[oó] sin gas|falta gasolina)\b/i,
        /\b(no (arranca|enciende|prende)|ponchadura|llanta|motor|frenos|bater[ií]a|aceite|transmisi[oó]n)\b/i
    ];

    // Patrones para REFRIGERADOR
    const refrigeradorPatterns = [
        /\b(refrigerador|refri|nevera|enfriador|cooler|congelador|frigor[ií]fico|hielera|equipo de fr[ií]o)\b/i,
        /\b(no enfr[ií]a|gotea agua|hielo|escarcha|temperatura)\b/i
    ];

    // Verificar VEHICULO
    for (const pattern of vehiculoPatterns) {
        if (pattern.test(textLower)) {
            return 'VEHICULO';
        }
    }

    // Verificar REFRIGERADOR
    for (const pattern of refrigeradorPatterns) {
        if (pattern.test(textLower)) {
            return 'REFRIGERADOR';
        }
    }

    return null;
}

/**
 * Enriquece la intención con TODOS los datos posibles extraídos por IA
 * Incluye: tipo_equipo, problema, codigo_sap, numero_empleado
 * Con regex fallback si AI falla
 */
async function enrichIntentWithStructuredData(text, detectedIntent, context, estadoActual = null) {
    try {
        const aiService = require('../../core/services/ai/aiService');
        const extracted = await aiService.extractAllData(text, estadoActual);

        context.log(`📦 Extracción completa:`, JSON.stringify(extracted));

        // REGEX FALLBACK: Si AI no detectó tipo de equipo, usar regex
        let tipoEquipo = extracted.tipo_equipo;
        if (!tipoEquipo || tipoEquipo === 'OTRO') {
            tipoEquipo = detectTipoEquipoRegex(text);
            if (tipoEquipo) {
                context.log(`🎯 Regex fallback detectó tipo: ${tipoEquipo}`);
            }
        }

        if (extracted.confianza >= 0.7 || tipoEquipo) {
            const tipoFinal = tipoEquipo || detectedIntent.tipo_equipo;

            // Solo procesar si tenemos tipo de equipo válido
            if (tipoFinal && tipoFinal !== 'OTRO') {
                return {
                    ...detectedIntent,
                    tipo_equipo: tipoFinal,
                    problema: extracted.problema || detectedIntent.problema,
                    codigo_sap: extracted.codigo_sap,
                    numero_empleado: extracted.numero_empleado,
                    metodo: tipoEquipo && !extracted.tipo_equipo ? 'regex_fallback+ai_extract' : 'regex+ai_extract_all',
                    datos_extraidos: {
                        tipo_equipo: tipoFinal,
                        problema: extracted.problema,
                        codigo_sap: extracted.codigo_sap,
                        numero_empleado: extracted.numero_empleado,
                        datos_encontrados: extracted.datos_encontrados
                    }
                };
            }
        }
        context.log(`⚠️ Extracción no cumple requisitos: confianza=${extracted.confianza}, tipo_equipo=${tipoEquipo}`);
    } catch (error) {
        context.log.error(`❌ Error en extracción completa:`, error);
    }
    return detectedIntent;
}

/**
 * Procesa el mensaje según la intención detectada
 */
async function processIntent(from, text, session, detectedIntent, context) {
    switch (detectedIntent.intencion) {
        case 'SALUDO':
            await sendWelcome(from);
            break;

        case 'CANCELAR':
            // Si llegamos aquí, el usuario está en estado terminal (no hay flujo activo)
            // Mostramos mensaje de cancelado de todas formas para dar feedback
            await whatsapp.sendText(from, MSG.GENERAL.CANCELLED);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.CANCELLED, TIPO_CONTENIDO.TEXTO);
            break;

        case 'REPORTAR_FALLA':
            await handleReportarFalla(from, session, detectedIntent, context);
            break;

        case 'TIPO_REFRIGERADOR':
            await handleTipoEquipo(from, text, detectedIntent, 'REFRIGERADOR', context);
            break;

        case 'TIPO_VEHICULO':
            await handleTipoEquipo(from, text, detectedIntent, 'VEHICULO', context);
            break;

        default:
            await handleDefaultIntent(from, detectedIntent);
    }
}

/**
 * Maneja la intención de reportar falla con datos estructurados
 */
async function handleReportarFalla(from, session, detectedIntent, context) {
    // Verificar si tenemos datos estructurados (de cualquier método de extracción)
    const metodosConExtraccion = ['ai_extract', 'gemini_extract', 'regex+gemini_extract', 'regex+ai_extract_all'];
    const hasStructuredData = metodosConExtraccion.includes(detectedIntent.metodo) &&
        detectedIntent.tipo_equipo && detectedIntent.tipo_equipo !== 'OTRO';

    // Si NO tenemos tipo de equipo pero SÍ tenemos otros datos (problema, SAP, empleado),
    // guardarlos en datosTemp y mostrar los botones
    if (!hasStructuredData) {
        const tieneDatos = detectedIntent.problema ||
                          detectedIntent.codigo_sap ||
                          detectedIntent.numero_empleado ||
                          detectedIntent.datos_extraidos?.problema ||
                          detectedIntent.datos_extraidos?.codigo_sap ||
                          detectedIntent.datos_extraidos?.numero_empleado;

        if (tieneDatos) {
            // Guardar los datos extraídos en datosTemp para usarlos después
            const datosTemp = {
                problema: detectedIntent.problema || detectedIntent.datos_extraidos?.problema,
                codigoSAP: detectedIntent.codigo_sap || detectedIntent.datos_extraidos?.codigo_sap,
                numeroEmpleado: detectedIntent.numero_empleado || detectedIntent.datos_extraidos?.numero_empleado
            };

            await db.updateSession(
                from,
                ESTADO.INICIO,
                datosTemp,
                null,
                ORIGEN_ACCION.BOT,
                'Datos pre-extraídos guardados'
            );

            context.log(`💾 Datos guardados en INICIO: ${JSON.stringify(datosTemp)}`);
        }

        await sendWelcome(from);
        return;
    }

    // Preparar objeto con todos los datos extraídos
    const datosExtraidos = {
        problema: detectedIntent.problema,
        codigo_sap: detectedIntent.codigo_sap || detectedIntent.datos_extraidos?.codigo_sap,
        numero_empleado: detectedIntent.numero_empleado || detectedIntent.datos_extraidos?.numero_empleado
    };

    context.log(`📦 Datos para flujo: tipo=${detectedIntent.tipo_equipo}, datos=${JSON.stringify(datosExtraidos)}`);
    const isFirstMessage = session.Estado === 'INICIO';

    await FlowManager.iniciarFlujoConDatos(from, detectedIntent.tipo_equipo, datosExtraidos, isFirstMessage, context);
}

/**
 * Maneja la selección de tipo de equipo (refrigerador o vehículo)
 */
async function handleTipoEquipo(from, text, detectedIntent, tipo, context) {
    context.log(`Usuario ${from} seleccionó ${tipo} vía texto: "${text}"`);

    if (detectedIntent.confianza < 0.7) {
        // Baja confianza: pedir confirmación
        const confirmTitle = tipo === 'REFRIGERADOR'
            ? MSG.DETECCION.CONFIRM_REFRIGERADOR_TITLE
            : MSG.DETECCION.CONFIRM_VEHICULO_TITLE;
        const confirmBody = tipo === 'REFRIGERADOR'
            ? MSG.DETECCION.confirmRefrigerador(text)
            : MSG.DETECCION.confirmVehiculo(text);
        const buttons = tipo === 'REFRIGERADOR'
            ? [MSG.BUTTONS.SI_REFRIGERADOR, MSG.BUTTONS.NO_ES_VEHICULO]
            : [MSG.BUTTONS.SI_VEHICULO, MSG.BUTTONS.NO_ES_REFRIGERADOR];

        await whatsapp.sendInteractiveMessage(from, confirmTitle, confirmBody, buttons);
    } else {
        // Alta confianza: iniciar flujo directamente
        const buttonId = tipo === 'REFRIGERADOR' ? 'btn_tipo_refrigerador' : 'btn_tipo_vehiculo';
        await handleButton(from, buttonId, null, context);
    }
}

/**
 * Maneja intenciones no reconocidas
 */
async function handleDefaultIntent(from, detectedIntent) {
    if (detectedIntent.metodo === 'gemini_interpret' && detectedIntent.confianza < 0.5) {
        await whatsapp.sendText(from, MSG.VALIDACION.NO_ENTIENDO);
    } else {
        await sendWelcome(from);
    }
}

/**
 * Procesa la presión de un botón interactivo de WhatsApp
 * @param {string} from - Número de teléfono del remitente (formato E.164)
 * @param {string} buttonId - ID del botón presionado (ej: 'btn_tipo_vehiculo')
 * @param {string} messageId - ID único del mensaje de WhatsApp
 * @param {Object} context - Contexto de Azure Functions con logging
 * @returns {Promise<void>}
 */
async function handleButton(from, buttonId, messageId, context) {
    context.log(`Botón presionado por ${from}: ${buttonId}`);

    // Typing indicator fire-and-forget (no crítico)
    if (messageId) {
        whatsapp.sendTypingIndicator(from, messageId).catch(() => {});
    }

    // Guardar la acción del botón como mensaje
    await db.saveMessage(from, TIPO_MENSAJE.USUARIO, buttonId, TIPO_CONTENIDO.BOTON);

    const session = await db.getSession(from);

    // Si la sesión está en estado terminal, manejar según tipo de botón
    if (session.Estado !== ESTADO.INICIO && esEstadoTerminal(session.Estado)) {
        // Si es botón de encuesta, verificar si hay encuesta activa
        if (ENCUESTA_BUTTONS.has(buttonId)) {
            const encuestaActiva = await EncuestaRepository.getActivaByTelefono(from);

            if (!encuestaActiva) {
                // No hay encuesta activa - informar al usuario
                context.log(`⚠️ Botón de encuesta ${buttonId} presionado sin encuesta activa para ${from}`);
                await whatsapp.sendText(from, MSG.ENCUESTA?.EXPIRADA || 'Esta encuesta ya no está activa. Gracias por tu interés.');
                await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.ENCUESTA?.EXPIRADA || 'Esta encuesta ya no está activa.', TIPO_CONTENIDO.TEXTO);
                return;
            }

            // Hay encuesta activa - NO reactivar a INICIO, dejar que FlowManager maneje
            context.log(`📋 Procesando botón de encuesta ${buttonId} con encuesta activa ${encuestaActiva.EncuestaId}`);
        } else {
            // Botón normal - reactivar sesión a INICIO
            context.log(`🔄 Reactivando sesión de ${from} desde estado ${session.Estado} (botón)`);
            await db.updateSession(
                from,
                ESTADO.INICIO,
                null,
                null,
                ORIGEN_ACCION.USUARIO,
                `Sesión reactivada desde ${session.Estado} por botón`
            );
            session.Estado = ESTADO.INICIO;
        }
    }

    await db.updateLastActivity(from);

    const handled = await FlowManager.processButton(from, buttonId, session, context);

    if (!handled) {
        context.log(`Botón no reconocido: ${buttonId}`);
        await sendWelcome(from);
    }
}

/**
 * Envía mensaje de bienvenida con opciones de tipo de reporte
 */
async function sendWelcome(from) {
    await whatsapp.sendInteractiveMessage(
        from,
        MSG.GENERAL.WELCOME_TITLE,
        MSG.GENERAL.WELCOME_BODY,
        [MSG.BUTTONS.TIPO_REFRIGERADOR, MSG.BUTTONS.TIPO_VEHICULO, MSG.BUTTONS.CANCELAR]
    );
}

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
    context.log(`📍 Procesando ubicación de ${from}: lat=${location?.latitude}, lng=${location?.longitude}`);

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

    // Solo procesar ubicación si estamos esperando una
    if (session.Estado === ESTADO.VEHICULO_ESPERA_UBICACION) {
        // Pasar la ubicación al flujo de vehículos
        const handled = await FlowManager.processSessionState(from, location, session, context);
        if (!handled) {
            context.log(`No se pudo procesar la ubicación en estado ${session.Estado}`);
        }
    } else {
        context.log(`Ubicación recibida pero no esperada en estado ${session.Estado}`);
        // Opcional: informar al usuario que no esperábamos ubicación
        await whatsapp.sendText(from, 'Gracias por tu ubicación, pero en este momento no la necesitamos.');
    }
}

module.exports = {
    handleText,
    handleButton,
    handleLocation
};
