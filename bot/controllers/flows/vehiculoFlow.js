/**
 * AC FIXBOT - Flujo de Reporte de Vehículo V2
 * Maneja todo el proceso de reporte de fallas en vehículos
 * Compatible con nuevos estados normalizados
 * Incluye cálculo de tiempo de llegada desde centro de servicio más cercano
 */

const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const azureMaps = require('../../../core/services/external/azureMapsService');
const CentroServicioRepository = require('../../repositories/CentroServicioRepository');
const MSG = require('../../constants/messages');
const { safeParseJSON, validateSAPCode, validateEmployeeNumber, sanitizeDescription } = require('../../../core/utils/helpers');
const {
    ESTADO,
    TIPO_REPORTE,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO
} = require('../../constants/sessionStates');

/**
 * Inicia el flujo de vehículo (desde botón)
 */
async function iniciarFlujo(from) {
    await db.updateSession(
        from,
        ESTADO.VEHICULO_ESPERA_EMPLEADO,
        { tipoReporte: TIPO_REPORTE.VEHICULO },
        null,
        ORIGEN_ACCION.USUARIO,
        'Flujo vehículo iniciado'
    );

    await whatsapp.sendInteractiveMessage(
        from,
        MSG.VEHICULO.TITLE,
        MSG.VEHICULO.REQUEST_EMPLEADO_BODY,
        [MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.REQUEST_EMPLEADO_BODY, TIPO_CONTENIDO.TEXTO);
}

/**
 * Inicia el flujo de vehículo con datos pre-detectados por IA
 * Puede saltar pasos si ya tiene número de empleado y/o código SAP
 * @param {string} from - Número de teléfono
 * @param {Object} datosExtraidos - Datos extraídos por IA
 * @param {string} datosExtraidos.problema - Descripción del problema
 * @param {string} datosExtraidos.codigo_sap - Código SAP del vehículo (opcional)
 * @param {string} datosExtraidos.numero_empleado - Número de empleado (opcional)
 * @param {boolean} isFirstMessage - Si es el primer mensaje del usuario
 * @param {Object} context - Contexto de la función
 */
async function iniciarFlujoConDatos(from, datosExtraidos, isFirstMessage, context) {
    const problema = datosExtraidos.problema;
    const codigoSap = datosExtraidos.codigo_sap;
    const numeroEmpleado = datosExtraidos.numero_empleado;

    context.log(`[VehiculoFlow] Iniciando con datos extraídos:`, JSON.stringify(datosExtraidos));

    // Validar datos extraídos
    let empleadoValido = null;
    let sapValido = null;

    if (numeroEmpleado) {
        const validationEmpleado = validateEmployeeNumber(numeroEmpleado);
        if (validationEmpleado.valid) {
            empleadoValido = validationEmpleado.cleaned;
            context.log(`[VehiculoFlow] Número de empleado pre-extraído válido: ${empleadoValido}`);
        }
    }

    if (codigoSap) {
        const validationSap = validateSAPCode(codigoSap);
        if (validationSap.valid) {
            sapValido = validationSap.cleaned;
            context.log(`[VehiculoFlow] Código SAP pre-extraído válido: ${sapValido}`);
        }
    }

    // Caso 1: Tenemos empleado Y SAP válidos - pedir ubicación antes de crear reporte
    if (empleadoValido && sapValido && problema) {
        context.log(`[VehiculoFlow] Todos los datos extraídos, pidiendo ubicación`);

        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_UBICACION,
            {
                tipoReporte: TIPO_REPORTE.VEHICULO,
                problemaTemp: problema,
                numeroEmpleado: empleadoValido,
                codigoSAPVehiculo: sapValido
            },
            null,
            ORIGEN_ACCION.BOT,
            `Datos extraídos por IA, esperando ubicación`
        );

        const msgBody = MSG.DETECCION.datosExtraidosVehiculoCompleto(empleadoValido, sapValido, problema, isFirstMessage);
        await whatsapp.sendText(from, msgBody);
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.REQUEST_UBICACION_TITLE,
            MSG.VEHICULO.REQUEST_UBICACION_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgBody, TIPO_CONTENIDO.TEXTO);
        return;
    }

    // Caso 2: Tenemos empleado válido - saltar a pedir SAP
    if (empleadoValido) {
        context.log(`[VehiculoFlow] Empleado extraído, saltando a pedir SAP`);

        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_SAP,
            {
                tipoReporte: TIPO_REPORTE.VEHICULO,
                problemaTemp: problema,
                numeroEmpleado: empleadoValido
            },
            null,
            ORIGEN_ACCION.BOT,
            `Empleado extraído por IA: ${empleadoValido}`
        );

        const msgBody = MSG.DETECCION.vehiculoEmpleadoExtraido(empleadoValido, problema, isFirstMessage);
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.DETECCION.VEHICULO_EMPLEADO_EXTRAIDO_TITLE,
            msgBody,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgBody, TIPO_CONTENIDO.TEXTO);
        return;
    }

    // Caso 3: Flujo normal - pedir número de empleado
    await db.updateSession(
        from,
        ESTADO.VEHICULO_ESPERA_EMPLEADO,
        {
            tipoReporte: TIPO_REPORTE.VEHICULO,
            problemaTemp: problema
        },
        null,
        ORIGEN_ACCION.BOT,
        `Problema detectado por IA: ${problema?.substring(0, 50) || 'sin problema'}`
    );

    const msgBody = MSG.DETECCION.vehiculoDetectadoBody(problema, isFirstMessage);
    await whatsapp.sendInteractiveMessage(
        from,
        MSG.DETECCION.VEHICULO_DETECTADO_TITLE,
        msgBody,
        [MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgBody, TIPO_CONTENIDO.TEXTO);
}

/**
 * Procesa el número de empleado
 * FLEXIBLE: También acepta datos adicionales (SAP, problema) si vienen en el mismo mensaje
 */
async function handleNumeroEmpleado(from, numeroEmpleado, session, context) {
    // Obtener datos actualizados (pueden incluir datos extraídos por IA)
    const datosTemp = safeParseJSON(session.DatosTemp);
    context.log(`[VehiculoFlow] handleNumeroEmpleado - datosTemp:`, JSON.stringify(datosTemp));

    // Si ya tenemos empleado de la extracción de IA, usarlo
    if (datosTemp.numeroEmpleado) {
        context.log(`[VehiculoFlow] Empleado ya extraído por IA: ${datosTemp.numeroEmpleado}`);
    } else {
        // Validar el input del usuario
        const validation = validateEmployeeNumber(numeroEmpleado);
        context.log(`[VehiculoFlow] Número de empleado ingresado: ${validation.cleaned}`);

        if (!validation.valid) {
            await whatsapp.sendText(from, MSG.VALIDACION.EMPLEADO_INVALIDO);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VALIDACION.EMPLEADO_INVALIDO, TIPO_CONTENIDO.TEXTO);
            return;
        }
        datosTemp.numeroEmpleado = validation.cleaned;
    }

    // FLEXIBLE: Verificar si ya tenemos SAP (de extracción IA del mismo mensaje)
    if (datosTemp.codigoSAPVehiculo && datosTemp.problemaTemp) {
        // Tenemos TODO: empleado, SAP y problema - ir directo a ubicación
        context.log(`[VehiculoFlow] Todos los datos extraídos, saltando a ubicación`);
        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_UBICACION,
            datosTemp,
            null,
            ORIGEN_ACCION.BOT,
            `Datos completos extraídos, esperando ubicación`
        );

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.REQUEST_UBICACION_TITLE,
            MSG.VEHICULO.REQUEST_UBICACION_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.REQUEST_UBICACION_BODY, TIPO_CONTENIDO.TEXTO);
    } else if (datosTemp.codigoSAPVehiculo) {
        // Tenemos empleado y SAP, falta problema - ir a descripción
        context.log(`[VehiculoFlow] Empleado y SAP extraídos, saltando a descripción`);
        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_DESCRIPCION,
            datosTemp,
            null,
            ORIGEN_ACCION.BOT,
            `Empleado y SAP extraídos, esperando descripción`
        );

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.VEHICULO_REGISTERED_TITLE,
            MSG.VEHICULO.VEHICULO_REGISTERED_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.VEHICULO_REGISTERED_BODY, TIPO_CONTENIDO.TEXTO);
    } else {
        // Solo tenemos empleado - pedir SAP normalmente
        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_SAP,
            datosTemp,
            null,
            ORIGEN_ACCION.BOT,
            `Empleado registrado: ${datosTemp.numeroEmpleado}`
        );

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.EMPLEADO_REGISTERED_TITLE,
            MSG.VEHICULO.EMPLEADO_REGISTERED_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.EMPLEADO_REGISTERED_BODY, TIPO_CONTENIDO.TEXTO);
    }
}

/**
 * Procesa el código SAP del vehículo
 * FLEXIBLE: También acepta datos adicionales (problema) si vienen en el mismo mensaje
 */
async function handleSAPVehiculo(from, input, session, context) {
    // Obtener datos actualizados (pueden incluir datos extraídos por IA)
    const datosTemp = safeParseJSON(session.DatosTemp);
    context.log(`[VehiculoFlow] handleSAPVehiculo - datosTemp:`, JSON.stringify(datosTemp));
    context.log(`[VehiculoFlow] handleSAPVehiculo - problemaTemp existe: ${!!datosTemp.problemaTemp}`);

    // Si ya tenemos SAP de la extracción de IA, usarlo
    if (datosTemp.codigoSAPVehiculo) {
        context.log(`[VehiculoFlow] SAP ya extraído por IA: ${datosTemp.codigoSAPVehiculo}`);
    } else {
        // Validar el input del usuario
        const validation = validateSAPCode(input);
        context.log(`[VehiculoFlow] Código SAP de vehículo limpio: ${validation.cleaned}`);

        if (!validation.valid) {
            await whatsapp.sendText(from, MSG.VALIDACION.CODIGO_VEHICULO_INVALIDO);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VALIDACION.CODIGO_VEHICULO_INVALIDO, TIPO_CONTENIDO.TEXTO);
            return;
        }
        datosTemp.codigoSAPVehiculo = validation.cleaned;
    }

    if (datosTemp.problemaTemp) {
        // Ya tenemos el problema (extracción IA o anterior), pedir ubicación
        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_UBICACION,
            datosTemp,
            null,
            ORIGEN_ACCION.BOT,
            `SAP vehículo registrado: ${datosTemp.codigoSAPVehiculo}, esperando ubicación`
        );

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.REQUEST_UBICACION_TITLE,
            MSG.VEHICULO.REQUEST_UBICACION_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.REQUEST_UBICACION_BODY, TIPO_CONTENIDO.TEXTO);
    } else {
        // Pedir descripción del problema
        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_DESCRIPCION,
            datosTemp,
            null,
            ORIGEN_ACCION.BOT,
            `SAP vehículo registrado: ${datosTemp.codigoSAPVehiculo}, esperando descripción`
        );

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.VEHICULO_REGISTERED_TITLE,
            MSG.VEHICULO.VEHICULO_REGISTERED_BODY,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.VEHICULO_REGISTERED_BODY, TIPO_CONTENIDO.TEXTO);
    }
}

/**
 * Procesa la descripción del problema y pide ubicación
 * NOTA: Esta función es llamada cuando el estado es VEHICULO_ESPERA_DESCRIPCION
 * y el usuario envía la descripción del problema
 */
async function handleDescripcion(from, descripcion, session, context) {
    context.log(`[VehiculoFlow] Descripción recibida: ${descripcion?.substring(0, 50)}`);

    const datosTemp = safeParseJSON(session.DatosTemp);
    datosTemp.problemaTemp = sanitizeDescription(descripcion);

    // Actualizar sesión y pedir ubicación
    await db.updateSession(
        from,
        ESTADO.VEHICULO_ESPERA_UBICACION,
        datosTemp,
        null,
        ORIGEN_ACCION.BOT,
        `Problema registrado, esperando ubicación`
    );

    await whatsapp.sendInteractiveMessage(
        from,
        MSG.VEHICULO.REQUEST_UBICACION_TITLE,
        MSG.VEHICULO.REQUEST_UBICACION_BODY,
        [MSG.BUTTONS.CANCELAR]
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.REQUEST_UBICACION_BODY, TIPO_CONTENIDO.TEXTO);
}

/**
 * Procesa la ubicación del vehículo
 * Busca el centro de servicio más cercano y calcula tiempo de llegada
 * @param {string} from - Número de teléfono
 * @param {Object} ubicacion - Objeto con lat, lng y direccion
 * @param {number} ubicacion.latitude - Latitud
 * @param {number} ubicacion.longitude - Longitud
 * @param {string} ubicacion.address - Dirección (opcional)
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function handleUbicacion(from, ubicacion, session, context) {
    context.log(`[VehiculoFlow] Ubicación recibida: lat=${ubicacion?.latitude}, lng=${ubicacion?.longitude}`);

    if (!ubicacion || (!ubicacion.latitude && !ubicacion.longitude)) {
        // No se recibió ubicación válida
        await whatsapp.sendText(from, MSG.VEHICULO.UBICACION_INVALIDA);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.UBICACION_INVALIDA, TIPO_CONTENIDO.TEXTO);
        return;
    }

    const datosTemp = safeParseJSON(session.DatosTemp);
    datosTemp.ubicacion = {
        latitud: ubicacion.latitude,
        longitud: ubicacion.longitude,
        direccion: ubicacion.address || null
    };

    // Buscar centro de servicio más cercano y calcular ruta
    let locationInfo = null;
    try {
        // 1. Buscar el centro de servicio más cercano
        const centroMasCercano = await CentroServicioRepository.findNearest(
            ubicacion.latitude,
            ubicacion.longitude
        );

        if (centroMasCercano) {
            context.log(`[VehiculoFlow] Centro más cercano: ${centroMasCercano.Codigo} (${centroMasCercano.DistanciaKm} km)`);

            // 2. Obtener dirección y ruta usando Azure Maps
            locationInfo = await azureMaps.getLocationAndRouteInfo(
                { latitud: ubicacion.latitude, longitud: ubicacion.longitude },
                {
                    latitud: centroMasCercano.Latitud,
                    longitud: centroMasCercano.Longitud,
                    codigo: centroMasCercano.Codigo,
                    nombre: centroMasCercano.Nombre,
                    ciudad: centroMasCercano.Ciudad
                }
            );

            // Actualizar dirección si Azure Maps la obtuvo
            if (locationInfo?.direccion?.direccionCompleta) {
                datosTemp.ubicacion.direccion = locationInfo.direccion.direccionCompleta;
            }

            // Guardar info del centro y ruta en datosTemp
            datosTemp.centroServicio = {
                id: centroMasCercano.CentroServicioId,
                codigo: centroMasCercano.Codigo,
                nombre: centroMasCercano.Nombre,
                ciudad: centroMasCercano.Ciudad,
                distanciaKm: centroMasCercano.DistanciaKm
            };

            if (locationInfo?.ruta) {
                datosTemp.tiempoLlegada = {
                    tiempoEstimadoMin: locationInfo.ruta.tiempoConBufferMin,
                    tiempoSinTraficoMin: locationInfo.ruta.tiempoSinTraficoMin,
                    tiempoConTraficoMin: locationInfo.ruta.tiempoConTraficoMin,
                    distanciaKm: locationInfo.ruta.distanciaKm,
                    bufferMinutos: locationInfo.ruta.bufferMinutos
                };

                context.log(`[VehiculoFlow] Tiempo estimado: ${locationInfo.ruta.tiempoConBufferMin} min`);
            }
        }
    } catch (error) {
        // Si falla el cálculo de ruta, continuar sin esa info
        context.log.warn(`[VehiculoFlow] Error calculando ruta: ${error.message}`);
    }

    // Crear el reporte con ubicación y tiempo estimado
    await crearReporte(from, datosTemp.problemaTemp, { DatosTemp: JSON.stringify(datosTemp) }, context);
}

/**
 * Crea el reporte de vehículo
 * Incluye tiempo estimado de llegada si está disponible
 */
async function crearReporte(from, descripcion, session, _context) {
    const datosTemp = safeParseJSON(session.DatosTemp);
    // Sanitizar descripción antes de guardar en BD
    const descripcionFinal = sanitizeDescription(datosTemp.problemaTemp || descripcion);
    const numeroEmpleado = datosTemp.numeroEmpleado;
    const codigoSAPVehiculo = datosTemp.codigoSAPVehiculo;
    const ubicacion = datosTemp.ubicacion || null;
    const centroServicio = datosTemp.centroServicio || null;
    const tiempoLlegada = datosTemp.tiempoLlegada || null;

    if (!numeroEmpleado || !codigoSAPVehiculo) {
        throw new Error('Faltan datos del vehículo en la sesión');
    }

    // Crear el reporte con info extendida
    const numeroTicket = await db.createReporteVehiculo(
        codigoSAPVehiculo,
        numeroEmpleado,
        from,
        descripcionFinal,
        null, // imagenUrl
        ubicacion, // Ubicación del vehículo
        centroServicio?.id || null, // ID del centro de servicio más cercano
        tiempoLlegada?.tiempoEstimadoMin || null, // Tiempo estimado en minutos
        tiempoLlegada?.distanciaKm || null // Distancia al centro
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
        `Reporte vehículo creado: ${numeroTicket}`,
        reporteId
    );

    // Formatear ubicación para el mensaje
    const ubicacionStr = ubicacion?.direccion || (ubicacion ? `${ubicacion.latitud}, ${ubicacion.longitud}` : null);

    // Preparar info de tiempo de llegada para el mensaje
    const tiempoLlegadaInfo = (tiempoLlegada && centroServicio) ? {
        tiempoEstimadoMin: tiempoLlegada.tiempoEstimadoMin,
        distanciaKm: tiempoLlegada.distanciaKm,
        centroNombre: centroServicio.nombre
    } : null;

    const msgReporteCreado = MSG.VEHICULO.reporteCreado(
        numeroTicket,
        codigoSAPVehiculo,
        numeroEmpleado,
        descripcionFinal,
        ubicacionStr,
        tiempoLlegadaInfo
    );
    await whatsapp.sendText(from, msgReporteCreado);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgReporteCreado, TIPO_CONTENIDO.TEXTO);

    return numeroTicket;
}

/**
 * Maneja la confirmación de datos extraídos por AI Vision
 * @param {string} from - Número de teléfono del usuario
 * @param {string} userInput - Texto del usuario (Si/No)
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto de Azure Functions
 */
async function handleConfirmacionDatosAI(from, userInput, session, context) {
    const datosTemp = safeParseJSON(session.DatosTemp);
    const cleanText = userInput.trim().toLowerCase();

    context.log(`[VehiculoFlow] Confirmación AI Vision - Input: ${cleanText}`);
    context.log(`[VehiculoFlow] Datos temp:`, JSON.stringify(datosTemp));

    // Detectar confirmación positiva
    const esConfirmacion = /^(s[ií]|yes|ok|correcto|exacto|afirmativo|confirmo|1)$/i.test(cleanText);
    // Detectar rechazo
    const esRechazo = /^(no|incorrecto|negativo|nop|nope|2)$/i.test(cleanText);

    if (esConfirmacion) {
        context.log(`[VehiculoFlow] Usuario confirmó los datos extraídos por AI`);

        // Determinar qué datos tenemos y continuar el flujo
        const tieneEmpleado = !!datosTemp.numeroEmpleado;
        const tieneSAP = !!datosTemp.codigoSAPVehiculo;
        const tieneProblema = !!datosTemp.problemaTemp;

        context.log(`[VehiculoFlow] Datos disponibles - Empleado: ${tieneEmpleado}, SAP: ${tieneSAP}, Problema: ${tieneProblema}`);

        // Caso 1: Tenemos empleado Y SAP - pedir ubicación
        if (tieneEmpleado && tieneSAP) {
            context.log(`[VehiculoFlow] Tenemos empleado y SAP, pidiendo ubicación`);

            await db.updateSession(
                from,
                ESTADO.VEHICULO_ESPERA_UBICACION,
                datosTemp,
                null,
                ORIGEN_ACCION.BOT,
                'Datos confirmados por usuario, esperando ubicación'
            );

            // Invalidar caché para evitar race conditions
            db.clearSessionCache(from);
            context.log(`[VehiculoFlow] Caché invalidado después de cambiar a VEHICULO_ESPERA_UBICACION`);

            await whatsapp.sendInteractiveMessage(
                from,
                MSG.VEHICULO.REQUEST_UBICACION_TITLE,
                MSG.VEHICULO.REQUEST_UBICACION_BODY,
                [MSG.BUTTONS.CANCELAR]
            );
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.VEHICULO.REQUEST_UBICACION_BODY, TIPO_CONTENIDO.TEXTO);
            return;
        }

        // Caso 2: Tenemos empleado pero NO SAP - pedir SAP
        if (tieneEmpleado && !tieneSAP) {
            context.log(`[VehiculoFlow] Tenemos empleado, pidiendo SAP`);

            await db.updateSession(
                from,
                ESTADO.VEHICULO_ESPERA_SAP,
                datosTemp,
                null,
                ORIGEN_ACCION.BOT,
                'Empleado confirmado, esperando SAP'
            );

            // Invalidar caché para evitar race conditions
            db.clearSessionCache(from);
            context.log(`[VehiculoFlow] Caché invalidado después de cambiar a VEHICULO_ESPERA_SAP`);

            const msgBody = MSG.DETECCION.vehiculoEmpleadoExtraido(datosTemp.numeroEmpleado, datosTemp.problemaTemp, false);
            await whatsapp.sendInteractiveMessage(
                from,
                MSG.DETECCION.VEHICULO_EMPLEADO_EXTRAIDO_TITLE,
                msgBody,
                [MSG.BUTTONS.CANCELAR]
            );
            await db.saveMessage(from, TIPO_MENSAJE.BOT, msgBody, TIPO_CONTENIDO.TEXTO);
            return;
        }

        // Caso 3: No tenemos empleado - pedir empleado (flujo normal)
        context.log(`[VehiculoFlow] No tenemos empleado, pidiendo número de empleado`);
        context.log(`[VehiculoFlow] problemaTemp a preservar: ${datosTemp.problemaTemp}`);

        // Preservar TODOS los datos existentes de AI Vision
        const nuevosDatosTemp = {
            tipoReporte: TIPO_REPORTE.VEHICULO,
            problemaTemp: datosTemp.problemaTemp,
            imagenUrl: datosTemp.imagenUrl,
            informacionVisual: datosTemp.informacionVisual
        };

        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_EMPLEADO,
            nuevosDatosTemp,
            null,
            ORIGEN_ACCION.BOT,
            'Problema confirmado, esperando número de empleado'
        );

        // Invalidar caché para evitar race conditions
        db.clearSessionCache(from);
        context.log(`[VehiculoFlow] Caché invalidado después de cambiar a VEHICULO_ESPERA_EMPLEADO`);

        const msgBody = MSG.DETECCION.vehiculoDetectadoBody(datosTemp.problemaTemp, false);
        await whatsapp.sendInteractiveMessage(
            from,
            MSG.DETECCION.VEHICULO_DETECTADO_TITLE,
            msgBody,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgBody, TIPO_CONTENIDO.TEXTO);
        return;

    } else if (esRechazo) {
        context.log(`[VehiculoFlow] Usuario rechazó los datos extraídos por AI`);

        // Reiniciar el flujo desde cero
        await db.updateSession(
            from,
            ESTADO.VEHICULO_ESPERA_EMPLEADO,
            { tipoReporte: TIPO_REPORTE.VEHICULO },
            null,
            ORIGEN_ACCION.BOT,
            'Usuario rechazó datos de AI, reiniciando flujo'
        );

        const msgReinicio = '👌 Entendido. Vamos a empezar de nuevo.\n\n' +
            MSG.VEHICULO.REQUEST_EMPLEADO_BODY;

        await whatsapp.sendInteractiveMessage(
            from,
            MSG.VEHICULO.TITLE,
            msgReinicio,
            [MSG.BUTTONS.CANCELAR]
        );
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgReinicio, TIPO_CONTENIDO.TEXTO);
        return;

    } else {
        // Respuesta ambigua - pedir clarificación
        context.log(`[VehiculoFlow] Respuesta ambigua del usuario: ${cleanText}`);

        const msgClarificacion = '¿La información detectada en la imagen es correcta?\n\n' +
            'Por favor responde *Sí* o *No*';

        await whatsapp.sendText(from, msgClarificacion);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgClarificacion, TIPO_CONTENIDO.TEXTO);
    }
}

module.exports = {
    iniciarFlujo,
    iniciarFlujoConDatos,
    handleNumeroEmpleado,
    handleSAPVehiculo,
    handleDescripcion,
    handleUbicacion,
    crearReporte,
    handleConfirmacionDatosAI
};
