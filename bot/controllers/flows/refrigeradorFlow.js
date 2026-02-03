/**
 * AC FIXBOT - Flujo de Reporte de Refrigerador V2
 * Maneja todo el proceso de reporte de fallas en refrigeradores
 * Compatible con nuevos estados normalizados
 */

const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const MSG = require('../../constants/messages');
const { safeParseJSON, validateSAPCode, sanitizeDescription } = require('../../../core/utils/helpers');
const { logger } = require('../../../core/services/infrastructure/errorHandler');
const {
    ESTADO,
    TIPO_REPORTE,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO
} = require('../../constants/sessionStates');

/**
 * Procesa el código SAP ingresado para refrigerador
 * FLEXIBLE: También acepta datos adicionales (problema) si vienen en el mismo mensaje
 */
async function handleSAPInput(from, input, session, context) {
    // Obtener datos actualizados (pueden incluir datos extraídos por IA)
    const datosTemp = safeParseJSON(session.DatosTemp);
    let codigoSAP;

    // Si ya tenemos SAP de la extracción de IA, usarlo
    if (datosTemp.codigoSapExtraido) {
        codigoSAP = datosTemp.codigoSapExtraido;
        context.log(`[RefrigeradorFlow] SAP ya extraído por IA: ${codigoSAP}`);
    } else {
        // Validar el input del usuario
        const validation = validateSAPCode(input);
        context.log(`[RefrigeradorFlow] Código SAP limpio: ${validation.cleaned}`);

        if (!validation.valid) {
            await whatsapp.sendText(from, MSG.VALIDACION.CODIGO_INVALIDO);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VALIDACION.CODIGO_INVALIDO, TIPO_CONTENIDO.TEXTO);
            return;
        }
        codigoSAP = validation.cleaned;
    }

    const equipo = await db.getEquipoBySAP(codigoSAP);

    if (!equipo) {
        const msgNoEncontrado = MSG.REFRIGERADOR.equipoNoEncontrado(codigoSAP);
        await whatsapp.sendText(from, msgNoEncontrado);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgNoEncontrado, TIPO_CONTENIDO.TEXTO);
        return;
    }

    await db.updateSession(
        from,
        ESTADO.REFRI_CONFIRMAR_EQUIPO,
        datosTemp,
        equipo.EquipoId,
        ORIGEN_ACCION.BOT,
        `Equipo encontrado: ${codigoSAP}`
    );

    const msgInfo = MSG.REFRIGERADOR.equipoInfo(equipo);
    await whatsapp.sendInteractiveMessage(
        from,
        MSG.REFRIGERADOR.CONFIRM_TITLE,
        msgInfo,
        [MSG.BUTTONS.CONFIRMAR_EQUIPO, MSG.BUTTONS.CORREGIR_EQUIPO, MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgInfo, TIPO_CONTENIDO.TEXTO);
}

/**
 * Inicia el flujo de refrigerador (desde botón)
 */
async function iniciarFlujo(from) {
    await db.updateSession(
        from,
        ESTADO.REFRI_ESPERA_SAP,
        { tipoReporte: TIPO_REPORTE.REFRIGERADOR },
        null,
        ORIGEN_ACCION.USUARIO,
        'Flujo refrigerador iniciado'
    );

    await whatsapp.sendInteractiveMessage(
        from,
        MSG.REFRIGERADOR.TITLE,
        MSG.REFRIGERADOR.REQUEST_SAP_BODY,
        [MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.REFRIGERADOR.REQUEST_SAP_BODY, TIPO_CONTENIDO.TEXTO);
}

/**
 * Inicia el flujo de refrigerador con datos pre-detectados por IA
 * Puede saltar pasos si ya tiene código SAP válido
 * @param {string} from - Número de teléfono
 * @param {Object} datosExtraidos - Datos extraídos por IA
 * @param {string} datosExtraidos.problema - Descripción del problema
 * @param {string} datosExtraidos.codigo_sap - Código SAP del equipo (opcional)
 * @param {boolean} isFirstMessage - Si es el primer mensaje del usuario
 * @param {Object} context - Contexto de la función
 */
async function iniciarFlujoConDatos(from, datosExtraidos, isFirstMessage, context) {
    const problema = datosExtraidos.problema;
    const codigoSap = datosExtraidos.codigo_sap;

    context.log(`[RefrigeradorFlow] Iniciando con datos extraídos:`, JSON.stringify(datosExtraidos));

    // Si tenemos código SAP, intentar validarlo y buscar equipo
    if (codigoSap) {
        const validation = validateSAPCode(codigoSap);

        if (validation.valid) {
            context.log(`[RefrigeradorFlow] Código SAP pre-extraído válido: ${validation.cleaned}`);
            const equipo = await db.getEquipoBySAP(validation.cleaned);

            if (equipo) {
                // Equipo encontrado, saltar directo a confirmación
                context.log(`[RefrigeradorFlow] Equipo encontrado, saltando a confirmación`);

                await db.updateSession(
                    from,
                    ESTADO.REFRI_CONFIRMAR_EQUIPO,
                    {
                        tipoReporte: TIPO_REPORTE.REFRIGERADOR,
                        problemaTemp: problema,
                        codigoSapExtraido: validation.cleaned
                    },
                    equipo.EquipoId,
                    ORIGEN_ACCION.BOT,
                    `Datos extraídos por IA: SAP=${validation.cleaned}, problema="${problema?.substring(0, 30)}..."`
                );

                // Mostrar resumen de datos extraídos y pedir confirmación
                const msgResumen = MSG.DETECCION.datosExtraidosRefrigerador(equipo, problema, isFirstMessage);
                await whatsapp.sendInteractiveMessage(
                    from,
                    MSG.DETECCION.DATOS_EXTRAIDOS_TITLE,
                    msgResumen,
                    [MSG.BUTTONS.CONFIRMAR_EQUIPO, MSG.BUTTONS.CORREGIR_EQUIPO, MSG.BUTTONS.CANCELAR]
                );
                await db.saveMessage(from, TIPO_MENSAJE.BOT, msgResumen, TIPO_CONTENIDO.TEXTO);
                return;
            } 
                // SAP no encontrado en BD, informar al usuario y pedir SAP correcto
                context.log(`[RefrigeradorFlow] SAP ${validation.cleaned} no encontrado en BD, informando al usuario`);

                await db.updateSession(
                    from,
                    ESTADO.REFRI_ESPERA_SAP,
                    {
                        tipoReporte: TIPO_REPORTE.REFRIGERADOR,
                        problemaTemp: problema,
                        sapNoEncontrado: validation.cleaned
                    },
                    null,
                    ORIGEN_ACCION.BOT,
                    `SAP extraído ${validation.cleaned} no encontrado en BD`
                );

                const msgNoEncontrado = MSG.DETECCION.sapExtraidoNoEncontrado(validation.cleaned, problema, isFirstMessage);
                await whatsapp.sendInteractiveMessage(
                    from,
                    MSG.DETECCION.REFRIGERADOR_DETECTADO_TITLE,
                    msgNoEncontrado,
                    [MSG.BUTTONS.CANCELAR]
                );
                await db.saveMessage(from, TIPO_MENSAJE.BOT, msgNoEncontrado, TIPO_CONTENIDO.TEXTO);
                return;
            
        }
    }

    // Flujo normal: pedir código SAP (sin SAP extraído)
    await db.updateSession(
        from,
        ESTADO.REFRI_ESPERA_SAP,
        {
            tipoReporte: TIPO_REPORTE.REFRIGERADOR,
            problemaTemp: problema
        },
        null,
        ORIGEN_ACCION.BOT,
        `Problema detectado por IA: ${problema?.substring(0, 50) || 'sin problema'}`
    );

    const msgBody = MSG.DETECCION.refrigeradorDetectadoBody(problema, isFirstMessage);
    await whatsapp.sendInteractiveMessage(
        from,
        MSG.DETECCION.REFRIGERADOR_DETECTADO_TITLE,
        msgBody,
        [MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgBody, TIPO_CONTENIDO.TEXTO);
}

/**
 * Confirma el equipo y procede según si ya tiene problema detectado
 */
async function confirmarEquipo(from, session) {
    const datosTemp = safeParseJSON(session.DatosTemp);

    // DEBUG: Verificar qué datos tiene la sesión al confirmar
    logger.info(`[RefrigeradorFlow] confirmarEquipo - DatosTemp raw: ${session.DatosTemp}`);
    logger.info(`[RefrigeradorFlow] confirmarEquipo - DatosTemp parsed: ${JSON.stringify(datosTemp)}`);
    logger.info(`[RefrigeradorFlow] confirmarEquipo - imagenUrl: ${datosTemp.imagenUrl || 'NO PRESENTE'}`);

    if (datosTemp.problemaTemp) {
        // Ya tenemos el problema, crear reporte directamente
        await crearReporte(from, datosTemp.problemaTemp, session);
    } else {
        // Pedir descripción del problema
        await db.updateSession(
            from,
            ESTADO.REFRI_ESPERA_DESCRIPCION,
            datosTemp,
            session.EquipoIdTemp,
            ORIGEN_ACCION.USUARIO,
            'Equipo confirmado, esperando descripción'
        );

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.REFRIGERADOR.CONFIRMED_TITLE,
            MSG.REFRIGERADOR.CONFIRMED_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.REFRIGERADOR.CONFIRMED_BODY, TIPO_CONTENIDO.TEXTO);
    }
}

/**
 * Maneja confirmación desde teclado (si el usuario escribe en vez de presionar botón)
 * FLEXIBLE: También acepta descripciones del problema en este punto
 */
async function handleConfirmacion(from, input, session, context) {
    const inputLower = input.toLowerCase().trim();
    const datosTemp = safeParseJSON(session.DatosTemp);

    // Palabras clave de confirmación
    const esConfirmacion = /^(s[ií]|ok|dale|va|confirma(r)?|correcto|claro)$/i.test(inputLower);
    const esCorreccion = /^(no|corregir|cambiar|otro|mal|incorrecto)$/i.test(inputLower);

    if (esConfirmacion) {
        await confirmarEquipo(from, session);
    } else if (esCorreccion) {
        await corregirEquipo(from, session);
    } else if (input.trim().length > 10) {
        // FLEXIBLE: Si el mensaje es largo, probablemente es descripción del problema
        // La extracción ya fue hecha por enrichSessionWithExtractedData en messageHandler
        // Solo necesitamos verificar si ahora tenemos el problema
        const datosActualizados = safeParseJSON(session.DatosTemp);
        if (datosActualizados.problemaTemp) {
            context.log(`[RefrigeradorFlow] Problema capturado mid-confirmación: "${datosActualizados.problemaTemp}"`);
            // Ya tenemos el problema, confirmar y crear reporte
            await confirmarEquipo(from, session);
        } else {
            // No se pudo extraer un problema claro, pedir confirmación
            await whatsapp.sendText(from, MSG.VALIDACION.CONFIRMAR_O_CORREGIR);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VALIDACION.CONFIRMAR_O_CORREGIR, TIPO_CONTENIDO.TEXTO);
        }
    } else {
        // Mensaje corto que no es confirmación/corrección
        await whatsapp.sendText(from, MSG.VALIDACION.CONFIRMAR_O_CORREGIR);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VALIDACION.CONFIRMAR_O_CORREGIR, TIPO_CONTENIDO.TEXTO);
    }
}

/**
 * Solicita corrección del código SAP
 */
async function corregirEquipo(from, session) {
    const datosTemp = safeParseJSON(session.DatosTemp);

    await db.updateSession(
        from,
        ESTADO.REFRI_ESPERA_SAP,
        datosTemp,
        null,
        ORIGEN_ACCION.USUARIO,
        'Usuario solicitó corrección de SAP'
    );

    await whatsapp.sendInteractiveMessage(
        from,
        MSG.REFRIGERADOR.REQUEST_CORRECTION_TITLE,
        MSG.REFRIGERADOR.REQUEST_CORRECTION_BODY,
        [MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.REFRIGERADOR.REQUEST_CORRECTION_BODY, TIPO_CONTENIDO.TEXTO);
}

/**
 * Crea el reporte de refrigerador
 */
async function crearReporte(from, descripcion, session) {
    const datosTemp = safeParseJSON(session.DatosTemp);

    // DEBUG: Verificar datos antes de crear reporte
    logger.info(`[RefrigeradorFlow] crearReporte - DatosTemp raw: ${session.DatosTemp}`);
    logger.info(`[RefrigeradorFlow] crearReporte - DatosTemp parsed: ${JSON.stringify(datosTemp)}`);

    // Sanitizar descripción antes de guardar en BD
    const descripcionFinal = sanitizeDescription(datosTemp.problemaTemp || descripcion);
    const equipoId = session.EquipoIdTemp;

    if (!equipoId) {
        throw new Error('No se encontró el ID del equipo en la sesión');
    }

    const equipo = await db.getEquipoById(equipoId);

    if (!equipo) {
        throw new Error(`No se encontró el equipo con ID ${equipoId}`);
    }

    // Obtener URL de imagen si existe (viene de OCR de código de barras)
    const imagenUrl = datosTemp.imagenUrl || null;

    // DEBUG: Verificar imagenUrl antes de crear reporte
    logger.info(`[RefrigeradorFlow] crearReporte - imagenUrl: ${imagenUrl || 'NULL'}`);

    const numeroTicket = await db.createReporte(
        equipoId,
        equipo.ClienteId,
        from,
        descripcionFinal,
        imagenUrl
    );

    // Obtener el reporteId para el historial
    const reporte = await db.getReporteByTicket(numeroTicket);
    const reporteId = reporte?.ReporteId || null;

    // Cambiar a estado FINALIZADO (no INICIO)
    await db.updateSession(
        from,
        ESTADO.FINALIZADO,
        null,
        null,
        ORIGEN_ACCION.BOT,
        `Reporte creado: ${numeroTicket}`,
        reporteId
    );

    const msgReporteCreado = MSG.REFRIGERADOR.reporteCreado(numeroTicket, equipo, descripcionFinal);
    await whatsapp.sendText(from, msgReporteCreado);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgReporteCreado, TIPO_CONTENIDO.TEXTO);

    return numeroTicket;
}

module.exports = {
    handleSAPInput,
    handleConfirmacion,
    iniciarFlujo,
    iniciarFlujoConDatos,
    confirmarEquipo,
    corregirEquipo,
    crearReporte
};
