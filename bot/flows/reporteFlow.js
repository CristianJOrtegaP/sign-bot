/**
 * AC FIXBOT - Flujo de Reporte (FlowEngine)
 * Flujo auto-contenido con FlexibleFlowContext
 *
 * Este archivo contiene toda la lógica del flujo de reportes:
 * - Constantes y utilidades
 * - Inicialización de flujo
 * - Procesamiento de mensajes, imágenes y ubicaciones
 * - Manejo de campos
 * - Confirmaciones
 * - Creación de reportes
 * - Cancelación
 *
 * @module bot/flows/reporteFlow
 */

const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const MSG = require('../constants/messages');
const { sanitizeDescription } = require('../../core/utils/helpers');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const teamsService = require('../../core/services/external/teamsService');
const azureMapsService = require('../../core/services/external/azureMapsService');
const centroServicioRepo = require('../repositories/CentroServicioRepository');
const fieldExtractor = require('../services/fieldExtractor');
const fieldManager = require('../services/fieldManager');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../constants/sessionStates');
const appInsights = require('../../core/services/infrastructure/appInsightsService');

// ============================================================
// CONSTANTES
// ============================================================

/** Mapeo de tipo de reporte a estado flexible */
const ESTADO_FLEXIBLE = {
  [TIPO_REPORTE.REFRIGERADOR]: 'REFRIGERADOR_ACTIVO',
  [TIPO_REPORTE.VEHICULO]: 'VEHICULO_ACTIVO',
};

// ============================================================
// UTILIDADES
// ============================================================

/**
 * Verifica si un estado pertenece al flujo flexible
 * @param {string} estado - Estado a verificar
 * @returns {boolean}
 */
function esEstadoFlexible(estado) {
  const estadosFlexibles = Object.values(ESTADO_FLEXIBLE);
  const estadosConfirmacion = [
    'REFRIGERADOR_CONFIRMAR_EQUIPO',
    'REFRIGERADOR_CONFIRMAR_DATOS_AI',
    'VEHICULO_CONFIRMAR_DATOS_AI',
  ];
  return estadosFlexibles.includes(estado) || estadosConfirmacion.includes(estado);
}

/**
 * Verifica si el mensaje es una cancelación
 * @param {string} texto - Mensaje del usuario
 * @returns {boolean}
 */
function esCancelacion(texto) {
  return /^(cancelar|salir|exit|quit|no\s*quiero|terminar)$/i.test(texto.trim());
}

/**
 * Obtiene el mensaje de descripción del problema según el tipo de reporte
 * @param {Object} datosTemp - DatosTemp con tipoReporte
 * @returns {string}
 */
function getMensajeProblema(datosTemp) {
  const tipoEquipo =
    datosTemp.tipoReporte === TIPO_REPORTE.REFRIGERADOR ? 'refrigerador' : 'vehículo';
  if (datosTemp.datosEquipo) {
    const equipo = datosTemp.datosEquipo;
    return `✅ Equipo encontrado: ${equipo.Modelo || equipo.TipoEquipo || 'Equipo'}\n\nAhora, describe el problema que presenta el ${tipoEquipo}:`;
  }
  return `Por favor, describe el problema que presenta el ${tipoEquipo}:`;
}

/**
 * Obtiene el título del flujo según el tipo de reporte
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @returns {string}
 */
function getTituloFlujo(tipoReporte) {
  return tipoReporte === TIPO_REPORTE.REFRIGERADOR
    ? MSG.REFRIGERADOR.TITLE
    : MSG.VEHICULO?.TITLE || '🚗 Reporte de Vehículo';
}

// ============================================================
// CÁLCULO DE CENTRO DE SERVICIO Y ETA
// ============================================================

/**
 * Calcula el centro de servicio más cercano y el tiempo estimado de llegada
 * @param {Object} datosActualizados - DatosTemp a actualizar
 * @param {Object} ubicacion - Objeto con latitud y longitud
 * @param {Object} context - Contexto
 */
async function calcularCentroServicioYETA(datosActualizados, ubicacion, context = null) {
  context?.log?.(
    `Calculando centro más cercano para ubicación: ${ubicacion.latitud}, ${ubicacion.longitud}`
  );

  const centroMasCercano = await centroServicioRepo.findNearest(
    ubicacion.latitud,
    ubicacion.longitud
  );

  if (!centroMasCercano) {
    logger.warn('[ReporteFlow] No se encontraron centros de servicio activos');
    return;
  }

  context?.log?.(
    `Centro más cercano: ${centroMasCercano.Nombre} (${centroMasCercano.DistanciaKm} km)`
  );

  let rutaInfo = null;
  if (azureMapsService.isConfigured()) {
    rutaInfo = await azureMapsService.getRoute(
      { latitud: centroMasCercano.Latitud, longitud: centroMasCercano.Longitud },
      { latitud: ubicacion.latitud, longitud: ubicacion.longitud }
    );
  }

  datosActualizados.centroServicio = {
    centroServicioId: centroMasCercano.CentroServicioId,
    codigo: centroMasCercano.Codigo,
    nombre: centroMasCercano.Nombre,
    ciudad: centroMasCercano.Ciudad,
    distanciaDirectaKm: centroMasCercano.DistanciaKm,
  };

  if (rutaInfo) {
    datosActualizados.tiempoLlegada = {
      tiempoEstimadoMin: rutaInfo.tiempoConBufferMin,
      tiempoSinTraficoMin: rutaInfo.tiempoSinTraficoMin,
      tiempoConTraficoMin: rutaInfo.tiempoConTraficoMin,
      bufferMinutos: rutaInfo.bufferMinutos,
      distanciaKm: rutaInfo.distanciaKm,
      centroNombre: centroMasCercano.Nombre,
      fechaCalculo: rutaInfo.fechaCalculo,
    };
  } else {
    const tiempoEstimadoBase = Math.ceil((centroMasCercano.DistanciaKm / 30) * 60);
    const bufferMinutos = 20;
    datosActualizados.tiempoLlegada = {
      tiempoEstimadoMin: tiempoEstimadoBase + bufferMinutos,
      distanciaKm: centroMasCercano.DistanciaKm,
      centroNombre: centroMasCercano.Nombre,
      estimacionSimple: true,
    };
  }
}

// ============================================================
// CREACIÓN DE REPORTES
// ============================================================

/**
 * Crea reporte de refrigerador
 */
async function crearReporteRefrigerador(from, datosTemp, _session, _context) {
  const { camposRequeridos, equipoIdTemp, datosEquipo } = datosTemp;

  if (!equipoIdTemp) {
    throw new Error('No se encontró el ID del equipo en la sesión');
  }

  const equipo = datosEquipo || (await db.getEquipoById(equipoIdTemp));
  if (!equipo) {
    throw new Error(`No se encontró el equipo con ID ${equipoIdTemp}`);
  }

  const descripcion = sanitizeDescription(camposRequeridos.problema.valor);
  const imagenUrl = datosTemp.imagenes?.[0]?.url || datosTemp.imagenUrl || null;
  return db.createReporte(equipoIdTemp, equipo.ClienteId, from, descripcion, imagenUrl);
}

/**
 * Crea reporte de vehículo
 */
async function crearReporteVehiculo(from, datosTemp, session, context) {
  const { camposRequeridos, centroServicio, tiempoLlegada } = datosTemp;

  const descripcion = sanitizeDescription(camposRequeridos.problema.valor);
  const numeroEmpleado = camposRequeridos.numeroEmpleado?.valor;
  const codigoSAP = camposRequeridos.codigoSAP?.valor;

  const ubicacionObj = camposRequeridos.ubicacion?.coordenadas
    ? {
        latitud: camposRequeridos.ubicacion.coordenadas.latitud,
        longitud: camposRequeridos.ubicacion.coordenadas.longitud,
        direccion: camposRequeridos.ubicacion.valor || null,
      }
    : null;

  const centroServicioId = centroServicio?.centroServicioId || null;
  const tiempoEstimadoMinutos = tiempoLlegada?.tiempoEstimadoMin || null;
  const distanciaCentroKm =
    tiempoLlegada?.distanciaKm || centroServicio?.distanciaDirectaKm || null;
  const imagenUrl = datosTemp.imagenes?.[0]?.url || datosTemp.imagenUrl || null;

  const numeroTicket = await db.createReporteVehiculo(
    codigoSAP,
    numeroEmpleado,
    from,
    descripcion,
    imagenUrl,
    ubicacionObj,
    centroServicioId,
    tiempoEstimadoMinutos,
    distanciaCentroKm
  );

  context?.log?.(
    `Reporte vehículo creado: ${numeroTicket}, SAP: ${codigoSAP}, Empleado: ${numeroEmpleado}`
  );
  return numeroTicket;
}

/**
 * Crea el reporte una vez que todos los campos están completos
 */
async function crearReporte(from, datosTemp, session, context = null) {
  const { tipoReporte, camposRequeridos, datosEquipo } = datosTemp;
  const startTime = Date.now();

  context?.log?.(`Creando reporte: ${tipoReporte}`);

  try {
    let numeroTicket;

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
      numeroTicket = await crearReporteRefrigerador(from, datosTemp, session, context);
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
      numeroTicket = await crearReporteVehiculo(from, datosTemp, session, context);
    } else {
      throw new Error(`Tipo de reporte no soportado: ${tipoReporte}`);
    }

    await db.updateSession(
      from,
      ESTADO.FINALIZADO,
      null,
      null,
      ORIGEN_ACCION.BOT,
      `Reporte creado: ${numeroTicket}`
    );

    // App Insights: evento de negocio para auditoría de reportes
    appInsights.trackEvent(
      'report_submitted',
      {
        tipoReporte,
        numeroTicket,
        codigoSAP: camposRequeridos?.codigoSAP?.valor || null,
        numeroEmpleado: camposRequeridos?.numeroEmpleado?.valor || null,
        tieneImagen: Boolean(datosTemp.imagenUrl),
        fuenteImagen: datosTemp.fuenteImagen || 'manual',
      },
      {
        duracionFlujoMs: session?.FechaCreacion
          ? Date.now() - new Date(session.FechaCreacion).getTime()
          : 0,
        camposCompletos: camposRequeridos ? Object.keys(camposRequeridos).length : 0,
        processingMs: Date.now() - startTime,
      }
    );

    let msgConfirmacion;
    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
      msgConfirmacion = MSG.REFRIGERADOR.reporteCreado(
        numeroTicket,
        datosEquipo,
        camposRequeridos.problema.valor
      );
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
      const tiempoLlegadaInfo = datosTemp.tiempoLlegada || null;
      msgConfirmacion =
        MSG.VEHICULO?.reporteCreado?.(
          numeroTicket,
          camposRequeridos.codigoSAP?.valor,
          camposRequeridos.numeroEmpleado?.valor,
          camposRequeridos.problema?.valor,
          camposRequeridos.ubicacion?.valor,
          tiempoLlegadaInfo
        ) ||
        `✅ ¡Reporte creado exitosamente!\n\n📋 Ticket: ${numeroTicket}\n\nTe contactaremos pronto.`;
    } else {
      msgConfirmacion = `✅ ¡Reporte creado exitosamente!\n\n📋 Ticket: ${numeroTicket}\n\nTe contactaremos pronto.`;
    }

    await whatsapp.sendText(from, msgConfirmacion);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgConfirmacion, TIPO_CONTENIDO.TEXTO);

    teamsService
      .notifyTicketCreated(from, tipoReporte, numeroTicket, {
        codigoSAP: camposRequeridos.codigoSAP?.valor,
        numeroEmpleado: camposRequeridos.numeroEmpleado?.valor,
        problema: camposRequeridos.problema?.valor,
        ubicacion: camposRequeridos.ubicacion?.valor,
      })
      .catch((err) => logger.warn('[ReporteFlow] Error notificando a Teams:', err.message));

    return numeroTicket;
  } catch (error) {
    // App Insights: rastrear fallos en creación de reportes
    appInsights.trackEvent('report_failed', {
      tipoReporte,
      errorMessage: error.message,
    });
    logger.error('[ReporteFlow] Error creando reporte', { error: error.message });
    await whatsapp.sendText(
      from,
      MSG.GENERAL.ERROR_INTERNO ||
        'Ocurrió un error al crear el reporte. Por favor, intenta de nuevo.'
    );
    throw error;
  }
}

// ============================================================
// MANEJO DE CAMPOS
// ============================================================

/**
 * Solicita el siguiente campo faltante al usuario
 */
async function solicitarSiguienteCampo(from, datosTemp, context = null) {
  const siguienteCampo = fieldManager.getSiguienteCampoFaltante(
    datosTemp.camposRequeridos,
    datosTemp.tipoReporte
  );

  if (!siguienteCampo) {
    logger.warn('[ReporteFlow] solicitarSiguienteCampo llamado sin campos faltantes');
    return;
  }

  const completitud = fieldManager.calcularCompletitud(
    datosTemp.camposRequeridos,
    datosTemp.tipoReporte
  );
  context?.log?.(
    `Solicitando campo: ${siguienteCampo.nombre}, completitud: ${completitud.porcentaje}%`
  );

  let mensaje;
  const botones = [MSG.BUTTONS.CANCELAR];

  switch (siguienteCampo.nombre) {
    case 'codigoSAP':
      mensaje =
        datosTemp.tipoReporte === TIPO_REPORTE.REFRIGERADOR
          ? MSG.REFRIGERADOR.REQUEST_SAP_BODY
          : MSG.VEHICULO?.REQUEST_SAP_BODY || 'Por favor, proporciona el código SAP del vehículo:';
      break;
    case 'numeroEmpleado':
      mensaje =
        MSG.VEHICULO?.REQUEST_EMPLEADO_BODY || 'Por favor, proporciona tu número de empleado:';
      break;
    case 'problema':
      mensaje = getMensajeProblema(datosTemp);
      break;
    case 'ubicacion':
      mensaje =
        MSG.VEHICULO?.REQUEST_UBICACION_BODY ||
        '📍 Por favor, comparte tu ubicación o escribe la dirección donde se encuentra el vehículo:\n\n*Cómo compartir ubicación:*\n1. Presiona 📎 (adjuntar)\n2. Selecciona "Ubicación"\n3. Elige "Enviar ubicación actual"';
      break;
    default:
      mensaje = `Por favor, proporciona: ${siguienteCampo.descripcion}`;
  }

  mensaje += `\n\n📊 Progreso: ${completitud.completados}/${completitud.total} campos`;
  datosTemp.campoSolicitado = siguienteCampo.nombre;

  const estadoActual =
    datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO
      ? ESTADO.VEHICULO_ACTIVO
      : ESTADO.REFRIGERADOR_ACTIVO;
  await db.updateSession(
    from,
    estadoActual,
    datosTemp,
    null,
    ORIGEN_ACCION.BOT,
    `Solicitando campo: ${siguienteCampo.nombre}`
  );

  if (botones.length > 1 || siguienteCampo.nombre === 'ubicacion') {
    await whatsapp.sendInteractiveMessage(
      from,
      getTituloFlujo(datosTemp.tipoReporte),
      mensaje,
      botones
    );
  } else {
    await whatsapp.sendText(from, mensaje);
  }

  await db.saveMessage(from, TIPO_MENSAJE.BOT, mensaje, TIPO_CONTENIDO.TEXTO);
}

// ============================================================
// CANCELACIÓN
// ============================================================

/**
 * Cancela el flujo actual
 */
async function cancelarFlujo(from, session, context = null) {
  await db.updateSession(
    from,
    ESTADO.CANCELADO,
    null,
    null,
    ORIGEN_ACCION.USUARIO,
    'Flujo cancelado por usuario'
  );
  await whatsapp.sendText(from, MSG.GENERAL.CANCELLED);
  await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.GENERAL.CANCELLED, TIPO_CONTENIDO.TEXTO);
  context?.log?.(`Flujo cancelado: ${from}`);
}

// ============================================================
// CONFIRMACIONES
// ============================================================

/**
 * Confirma el equipo detectado y continúa el flujo
 */
async function confirmarEquipoDetectado(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);
  context?.log?.(`Usuario confirmó equipo: ${datos.datosEquipo?.CodigoSAP}`);

  if (datos.camposRequeridos.codigoSAP) {
    datos.camposRequeridos.codigoSAP.completo = true;
    datos.camposRequeridos.codigoSAP.fuente = 'ocr_confirmado';
    datos.camposRequeridos.codigoSAP.confianza = 100;
  }

  await db.updateSession(
    from,
    ESTADO.REFRIGERADOR_ACTIVO,
    datos,
    session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    'Equipo confirmado por usuario'
  );

  if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
    await crearReporte(from, datos, session, context);
  } else {
    await solicitarSiguienteCampo(from, datos, context);
  }
}

/**
 * Rechaza el equipo detectado y permite al usuario corregir
 */
async function rechazarEquipoDetectado(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);
  context?.log?.(`Usuario rechazó equipo: ${datos.datosEquipo?.CodigoSAP}`);

  delete datos.datosEquipo;
  delete datos.equipoIdTemp;
  if (datos.camposRequeridos.codigoSAP) {
    datos.camposRequeridos.codigoSAP = { valor: null, completo: false, fuente: null, confianza: 0 };
  }

  await db.updateSession(
    from,
    ESTADO.REFRIGERADOR_ACTIVO,
    datos,
    null,
    ORIGEN_ACCION.USUARIO,
    'Equipo rechazado por usuario'
  );

  await whatsapp.sendText(
    from,
    '📷 *Sin problema.* Por favor:\n\n' +
      '• Envía otra foto del código de barras, o\n' +
      '• Escribe el código SAP manualmente (7 dígitos)\n\n' +
      '_Ejemplo: 1234567_'
  );
  await db.saveMessage(
    from,
    TIPO_MENSAJE.BOT,
    'Equipo rechazado, solicitando código SAP',
    TIPO_CONTENIDO.TEXTO
  );
}

/**
 * Confirma los datos detectados por AI Vision
 */
async function confirmarDatosAI(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);
  context?.log?.(`Usuario confirmó datos AI Vision. Tipo: ${datos.tipoReporte}`);

  if (!datos.camposRequeridos) {
    datos.camposRequeridos = {};
  }

  if (datos.tipoReporte === TIPO_REPORTE.VEHICULO) {
    if (datos.problemaTemp) {
      datos.camposRequeridos.problema = {
        valor: datos.problemaTemp,
        completo: true,
        confianza: 85,
        fuente: 'ai_vision_confirmado',
      };
      delete datos.problemaTemp;
    }
    if (datos.codigoSAPVehiculo) {
      datos.camposRequeridos.codigoSAP = {
        valor: datos.codigoSAPVehiculo,
        completo: true,
        confianza: 85,
        fuente: 'ai_vision_confirmado',
      };
      delete datos.codigoSAPVehiculo;
    }
    if (datos.numeroEmpleado) {
      datos.camposRequeridos.numeroEmpleado = {
        valor: datos.numeroEmpleado,
        completo: true,
        confianza: 85,
        fuente: 'ai_vision_confirmado',
      };
    }
  } else if (datos.tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
    if (datos.codigoSAP) {
      datos.camposRequeridos.codigoSAP = {
        valor: datos.codigoSAP,
        completo: true,
        confianza: 85,
        fuente: 'ai_vision_confirmado',
      };
    }
    if (datos.problema) {
      datos.camposRequeridos.problema = {
        valor: datos.problema,
        completo: true,
        confianza: 85,
        fuente: 'ai_vision_confirmado',
      };
    }
  }

  const nuevoEstado =
    datos.tipoReporte === TIPO_REPORTE.VEHICULO
      ? ESTADO.VEHICULO_ACTIVO
      : ESTADO.REFRIGERADOR_ACTIVO;
  await db.updateSession(
    from,
    nuevoEstado,
    datos,
    session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    'Datos AI Vision confirmados por usuario'
  );

  if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
    await crearReporte(from, datos, session, context);
  } else {
    await solicitarSiguienteCampo(from, datos, context);
  }
}

/**
 * Rechaza los datos detectados por AI Vision
 */
async function rechazarDatosAI(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);
  context?.log?.(`Usuario rechazó datos AI Vision`);

  delete datos.problemaTemp;
  delete datos.codigoSAPVehiculo;
  delete datos.codigoSAP;
  delete datos.problema;
  delete datos.numeroEmpleado;
  delete datos.informacionVisual;
  datos.camposRequeridos = {};

  const nuevoEstado =
    datos.tipoReporte === TIPO_REPORTE.VEHICULO
      ? ESTADO.VEHICULO_ACTIVO
      : ESTADO.REFRIGERADOR_ACTIVO;
  await db.updateSession(
    from,
    nuevoEstado,
    datos,
    null,
    ORIGEN_ACCION.USUARIO,
    'Datos AI Vision rechazados por usuario'
  );

  const tipoTexto = datos.tipoReporte === TIPO_REPORTE.VEHICULO ? 'vehículo' : 'refrigerador';
  await whatsapp.sendText(
    from,
    `📝 *Sin problema.* Vamos a registrar tu reporte de ${tipoTexto} manualmente.\n\nPor favor, proporciona la información solicitada.`
  );
  await db.saveMessage(
    from,
    TIPO_MENSAJE.BOT,
    'Datos AI rechazados, iniciando flujo manual',
    TIPO_CONTENIDO.TEXTO
  );
  await solicitarSiguienteCampo(from, datos, context);
}

/**
 * Procesa la respuesta del usuario a la confirmación
 */
async function procesarRespuestaConfirmacion(from, texto, session, context = null) {
  const textoLimpio = texto.trim().toLowerCase();
  const esConfirmacion =
    /^(s[ií]|si|sip|sep|ok|okey|okay|correcto|exacto|afirmativo|confirmo|ese\s*(es|mero)|es\s*ese|es\s*correcto)$/i.test(
      textoLimpio
    );
  const esNegacion =
    /^(no|nel|nop|nope|negativo|incorrecto|no\s*es|otro|es\s*otro|ese\s*no)$/i.test(textoLimpio);

  const esConfirmacionAI =
    session.EstadoCodigo === ESTADO.VEHICULO_CONFIRMAR_DATOS_AI ||
    session.EstadoCodigo === ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI;

  if (esConfirmacion) {
    if (esConfirmacionAI) {
      await confirmarDatosAI(from, session, context);
    } else {
      await confirmarEquipoDetectado(from, session, context);
    }
    return true;
  }

  if (esNegacion) {
    if (esConfirmacionAI) {
      await rechazarDatosAI(from, session, context);
    } else {
      await rechazarEquipoDetectado(from, session, context);
    }
    return true;
  }

  const mensajeAyuda = esConfirmacionAI
    ? '🤔 No entendí tu respuesta.\n\nPor favor responde *Sí* si la información es correcta, o *No* para corregirla.'
    : '🤔 No entendí tu respuesta.\n\nPor favor responde *Sí* si el equipo es correcto, o *No* si es otro equipo.';

  await whatsapp.sendText(from, mensajeAyuda);
  await db.saveMessage(
    from,
    TIPO_MENSAJE.BOT,
    'Respuesta no reconocida en confirmación',
    TIPO_CONTENIDO.TEXTO
  );
  return true;
}

// ============================================================
// INICIALIZACIÓN DE FLUJO
// ============================================================

/**
 * Inicia un flujo flexible de reporte
 */
async function iniciarFlujo(from, tipoReporte, datosIniciales = {}, context = null) {
  const estadoFlexible = ESTADO_FLEXIBLE[tipoReporte];

  if (!estadoFlexible) {
    logger.error(`[ReporteFlow] Tipo de reporte desconocido: ${tipoReporte}`);
    throw new Error(`Tipo de reporte no soportado: ${tipoReporte}`);
  }

  const datosTemp = fieldManager.crearDatosTemp(tipoReporte);
  let resumenActualizacion = { estaCompleto: false };

  if (datosIniciales && Object.keys(datosIniciales).length > 0) {
    const resultado = fieldManager.actualizarDatosTemp(datosTemp, datosIniciales, { context });
    Object.assign(datosTemp, resultado.datosActualizados);
    resumenActualizacion = resultado.resumenActualizacion;
  }

  if (
    tipoReporte === TIPO_REPORTE.REFRIGERADOR &&
    datosIniciales.codigoSAP?.valor &&
    !datosTemp.equipoIdTemp
  ) {
    const sapValor = datosIniciales.codigoSAP.valor;
    const equipo = await db.getEquipoBySAP(sapValor);

    if (equipo) {
      datosTemp.equipoIdTemp = equipo.EquipoId;
      datosTemp.datosEquipo = {
        EquipoId: equipo.EquipoId,
        CodigoSAP: equipo.CodigoSAP,
        Modelo: equipo.Modelo,
        Marca: equipo.Marca,
        NombreCliente: equipo.NombreCliente,
        Ubicacion: equipo.Ubicacion,
      };

      await db.updateSession(
        from,
        ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
        datosTemp,
        equipo.EquipoId,
        ORIGEN_ACCION.BOT,
        `Código SAP inicial: ${sapValor}, esperando confirmación`
      );

      const mensajeConfirmacion =
        `✅ *Equipo encontrado:*\n\n` +
        `• *SAP:* ${equipo.CodigoSAP}\n` +
        `• *Modelo:* ${equipo.Modelo}\n` +
        `• *Marca:* ${equipo.Marca || 'N/A'}\n` +
        `• *Cliente:* ${equipo.NombreCliente}\n` +
        `• *Ubicación:* ${equipo.Ubicacion || 'N/A'}\n\n` +
        `¿Es correcto este equipo?`;

      await whatsapp.sendInteractiveMessage(from, '🔍 Confirmar Equipo', mensajeConfirmacion, [
        { id: 'btn_confirmar_equipo', title: '✅ Sí, es correcto' },
        { id: 'btn_rechazar_equipo', title: '❌ No, es otro' },
      ]);
      await db.saveMessage(from, TIPO_MENSAJE.BOT, mensajeConfirmacion, TIPO_CONTENIDO.TEXTO);
      return;
    }

    delete datosTemp.camposRequeridos.codigoSAP;
    resumenActualizacion.estaCompleto = false;
    await whatsapp.sendText(from, MSG.REFRIGERADOR.equipoNoEncontrado(sapValor));
    await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Equipo no encontrado', TIPO_CONTENIDO.TEXTO);
  }

  await db.updateSession(
    from,
    estadoFlexible,
    datosTemp,
    datosTemp.equipoIdTemp || null,
    ORIGEN_ACCION.BOT,
    `Flujo flexible ${tipoReporte} iniciado`
  );
  context?.log?.(`Flujo iniciado: ${tipoReporte}, estado: ${estadoFlexible}`);
  await solicitarSiguienteCampo(from, datosTemp, context);
}

// ============================================================
// PROCESAMIENTO DE MENSAJES
// ============================================================

/**
 * Maneja la búsqueda y confirmación de equipo por código SAP
 */
async function manejarBusquedaEquipoSAP(
  from,
  camposNuevos,
  datosActualizados,
  resumenActualizacion,
  _context
) {
  const equipo = await db.getEquipoBySAP(camposNuevos.codigoSAP.valor);

  if (equipo) {
    datosActualizados.equipoIdTemp = equipo.EquipoId;
    datosActualizados.datosEquipo = {
      EquipoId: equipo.EquipoId,
      CodigoSAP: equipo.CodigoSAP,
      Modelo: equipo.Modelo,
      Marca: equipo.Marca,
      NombreCliente: equipo.NombreCliente,
      Ubicacion: equipo.Ubicacion,
    };

    await db.updateSession(
      from,
      ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
      datosActualizados,
      equipo.EquipoId,
      ORIGEN_ACCION.BOT,
      `Código SAP ingresado: ${camposNuevos.codigoSAP.valor}, esperando confirmación`
    );

    const mensajeConfirmacion =
      `✅ *Equipo encontrado:*\n\n` +
      `• *SAP:* ${equipo.CodigoSAP}\n` +
      `• *Modelo:* ${equipo.Modelo}\n` +
      `• *Marca:* ${equipo.Marca || 'N/A'}\n` +
      `• *Cliente:* ${equipo.NombreCliente}\n` +
      `• *Ubicación:* ${equipo.Ubicacion || 'N/A'}\n\n` +
      `¿Es correcto este equipo?`;

    await whatsapp.sendInteractiveMessage(from, '🔍 Confirmar Equipo', mensajeConfirmacion, [
      { id: 'btn_confirmar_equipo', title: '✅ Sí, es correcto' },
      { id: 'btn_rechazar_equipo', title: '❌ No, es otro' },
    ]);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, mensajeConfirmacion, TIPO_CONTENIDO.TEXTO);
    return { handled: true, datosActualizados, resumenActualizacion };
  }

  await whatsapp.sendText(from, MSG.REFRIGERADOR.equipoNoEncontrado(camposNuevos.codigoSAP.valor));
  await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Equipo no encontrado', TIPO_CONTENIDO.TEXTO);
  delete datosActualizados.camposRequeridos.codigoSAP;
  resumenActualizacion.estaCompleto = false;

  return { handled: false, datosActualizados, resumenActualizacion };
}

/**
 * Procesa un mensaje de texto en el flujo flexible
 */
async function procesarMensaje(from, texto, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (
    session.EstadoCodigo === ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO ||
    session.EstadoCodigo === ESTADO.VEHICULO_CONFIRMAR_DATOS_AI ||
    session.EstadoCodigo === ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI
  ) {
    return procesarRespuestaConfirmacion(from, texto, session, context);
  }

  if (!datos.tipoReporte) {
    logger.warn('[ReporteFlow] Sesión sin tipoReporte', { telefono: from });
    return false;
  }

  if (esCancelacion(texto)) {
    await cancelarFlujo(from, session, context);
    return true;
  }

  const { campos: camposNuevos, totalCampos } = await fieldExtractor.extractAllFields(texto, {
    tipoReporte: datos.tipoReporte,
    useAI: true,
    context,
    campoSolicitado: datos.campoSolicitado,
  });

  context?.log?.(
    `Campos extraídos: ${totalCampos}, campos: ${Object.keys(camposNuevos).join(', ')}`
  );

  let { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
    datos,
    camposNuevos,
    { context }
  );

  const debeBuscarEquipo =
    camposNuevos.codigoSAP &&
    datos.tipoReporte === TIPO_REPORTE.REFRIGERADOR &&
    !datosActualizados.equipoIdTemp;

  if (debeBuscarEquipo) {
    const resultado = await manejarBusquedaEquipoSAP(
      from,
      camposNuevos,
      datosActualizados,
      resumenActualizacion,
      context
    );
    if (resultado.handled) {
      return true;
    }
    datosActualizados = resultado.datosActualizados;
    resumenActualizacion = resultado.resumenActualizacion;
  }

  await db.updateSession(
    from,
    session.EstadoCodigo,
    datosActualizados,
    datosActualizados.equipoIdTemp || session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    `Campos actualizados: ${resumenActualizacion.camposActualizados.join(', ') || 'ninguno'}`
  );

  const requiereEquipo = datos.tipoReporte === TIPO_REPORTE.REFRIGERADOR;
  const tieneEquipoValido = !requiereEquipo || datosActualizados.equipoIdTemp;

  if (resumenActualizacion.estaCompleto && tieneEquipoValido) {
    await crearReporte(from, datosActualizados, session, context);
    return true;
  }

  await solicitarSiguienteCampo(from, datosActualizados, context);
  return true;
}

/**
 * Procesa una imagen en el flujo flexible
 */
async function procesarImagen(from, imageBuffer, caption, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);
  if (!datos.tipoReporte) {
    return false;
  }

  const { campos: camposImagen } = await fieldExtractor.extractFieldsFromImage(
    imageBuffer,
    caption,
    { context }
  );

  if (Object.keys(camposImagen).length > 0) {
    const { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
      datos,
      camposImagen,
      { context }
    );

    await db.updateSession(
      from,
      session.EstadoCodigo,
      datosActualizados,
      datosActualizados.equipoIdTemp || session.EquipoIdTemp,
      ORIGEN_ACCION.USUARIO,
      `Campos de imagen: ${resumenActualizacion.camposActualizados.join(', ')}`
    );

    if (resumenActualizacion.estaCompleto) {
      await crearReporte(from, datosActualizados, session, context);
      return true;
    }
    await solicitarSiguienteCampo(from, datosActualizados, context);
  } else {
    await whatsapp.sendText(
      from,
      MSG.VALIDACION.IMAGEN_SIN_DATOS ||
        'No pude extraer información de la imagen. Por favor, intenta de nuevo o escribe los datos.'
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Imagen sin datos', TIPO_CONTENIDO.TEXTO);
  }

  return true;
}

/**
 * Procesa ubicación compartida
 */
async function procesarUbicacion(from, ubicacion, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);
  if (!datos.tipoReporte) {
    return false;
  }

  let direccionTexto = ubicacion.direccion || ubicacion.nombre;

  if (!direccionTexto && azureMapsService.isConfigured()) {
    try {
      const geoResult = await azureMapsService.reverseGeocode(
        ubicacion.latitud,
        ubicacion.longitud
      );
      if (geoResult) {
        direccionTexto = azureMapsService.formatDireccion(geoResult);
      }
    } catch (error) {
      logger.warn('[ReporteFlow] Error en geocoding inverso', { error: error.message });
    }
  }

  if (!direccionTexto) {
    direccionTexto = `${ubicacion.latitud}, ${ubicacion.longitud}`;
  }

  const campoUbicacion = {
    ubicacion: {
      valor: direccionTexto,
      confianza: 100,
      fuente: 'ubicacion_compartida',
      coordenadas: { latitud: ubicacion.latitud, longitud: ubicacion.longitud },
    },
  };

  const { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
    datos,
    campoUbicacion,
    { context }
  );

  if (datos.tipoReporte === TIPO_REPORTE.VEHICULO) {
    try {
      await calcularCentroServicioYETA(datosActualizados, ubicacion, context);
    } catch (error) {
      logger.warn('[ReporteFlow] Error calculando centro/ETA', { error: error.message });
    }
  }

  await db.updateSession(
    from,
    session.EstadoCodigo,
    datosActualizados,
    session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    'Ubicación recibida'
  );

  if (resumenActualizacion.estaCompleto) {
    await crearReporte(from, datosActualizados, session, context);
    return true;
  }

  await solicitarSiguienteCampo(from, datosActualizados, context);
  return true;
}

// ============================================================
// DEFINICIÓN DEL FLUJO
// ============================================================

const reporteFlow = {
  nombre: 'REPORTE',

  estados: [
    ESTADO.REFRIGERADOR_ACTIVO,
    ESTADO.VEHICULO_ACTIVO,
    ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
    ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI,
    ESTADO.VEHICULO_CONFIRMAR_DATOS_AI,
  ],

  handlers: {
    [ESTADO.REFRIGERADOR_ACTIVO]: 'handleMensajeFlexible',
    [ESTADO.VEHICULO_ACTIVO]: 'handleMensajeFlexible',
    [ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO]: 'handleConfirmacion',
    [ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI]: 'handleConfirmacion',
    [ESTADO.VEHICULO_CONFIRMAR_DATOS_AI]: 'handleConfirmacion',
  },

  botones: {
    btn_tipo_refrigerador: { handler: 'handleBotonIniciarRefrigerador' },
    btn_tipo_vehiculo: { handler: 'handleBotonIniciarVehiculo' },
    btn_confirmar_equipo: 'handleBotonConfirmarEquipo',
    btn_rechazar_equipo: 'handleBotonRechazarEquipo',
    btn_confirmar_ai: 'handleBotonConfirmarAI',
    btn_rechazar_ai: 'handleBotonRechazarAI',
    btn_confirmar_datos: 'handleBotonConfirmarDatos',
    btn_modificar_datos: 'handleBotonModificarDatos',
    btn_cancelar: 'handleBotonCancelar',
  },

  // ==============================================================
  // HANDLERS DE ESTADO
  // ==============================================================

  async handleMensajeFlexible(ctx, mensaje) {
    ctx.log(`Procesando mensaje en flujo flexible: "${mensaje.substring(0, 50)}..."`);
    await procesarMensaje(ctx.from, mensaje, ctx.session, ctx.context);
  },

  async handleConfirmacion(ctx, mensaje) {
    ctx.log(`Procesando confirmación: "${mensaje}"`);
    await procesarRespuestaConfirmacion(ctx.from, mensaje, ctx.session, ctx.context);
  },

  // ==============================================================
  // HANDLERS DE BOTONES
  // ==============================================================

  async handleBotonIniciarRefrigerador(ctx) {
    ctx.log('Iniciando flujo de refrigerador via botón');
    await iniciarFlujo(ctx.from, 'REFRIGERADOR', {}, ctx.context);
  },

  async handleBotonIniciarVehiculo(ctx) {
    ctx.log('Iniciando flujo de vehículo via botón');
    await iniciarFlujo(ctx.from, 'VEHICULO', {}, ctx.context);
  },

  async handleBotonConfirmarEquipo(ctx) {
    ctx.log('Usuario confirmó equipo via botón');
    await confirmarEquipoDetectado(ctx.from, ctx.session, ctx.context);
  },

  async handleBotonRechazarEquipo(ctx) {
    ctx.log('Usuario rechazó equipo via botón');
    await rechazarEquipoDetectado(ctx.from, ctx.session, ctx.context);
  },

  async handleBotonConfirmarAI(ctx) {
    ctx.log('Usuario confirmó datos AI via botón');
    await confirmarDatosAI(ctx.from, ctx.session, ctx.context);
  },

  async handleBotonRechazarAI(ctx) {
    ctx.log('Usuario rechazó datos AI via botón');
    await rechazarDatosAI(ctx.from, ctx.session, ctx.context);
  },

  async handleBotonConfirmarDatos(ctx) {
    ctx.log('Usuario confirmó datos via botón');
    const datos = fieldManager.parseDatosTemp(ctx.session.DatosTemp);
    for (const [nombre, campo] of Object.entries(datos.camposRequeridos)) {
      if (campo.requiereConfirmacion) {
        datos.camposRequeridos = fieldManager.confirmarCampo(datos.camposRequeridos, nombre);
        break;
      }
    }
    await db.updateSession(
      ctx.from,
      ctx.session.EstadoCodigo,
      datos,
      ctx.session.EquipoIdTemp,
      ORIGEN_ACCION.USUARIO,
      'Campo confirmado'
    );
    if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
      await crearReporte(ctx.from, datos, ctx.session, ctx.context);
    } else {
      await solicitarSiguienteCampo(ctx.from, datos, ctx.context);
    }
  },

  async handleBotonModificarDatos(ctx) {
    ctx.log('Usuario quiere modificar datos via botón');
    const datos = fieldManager.parseDatosTemp(ctx.session.DatosTemp);
    await solicitarSiguienteCampo(ctx.from, datos, ctx.context);
  },

  async handleBotonCancelar(ctx) {
    ctx.log('Usuario canceló flujo via botón');
    await cancelarFlujo(ctx.from, ctx.session, ctx.context);
  },
};

/**
 * Procesa un botón presionado delegando al handler correspondiente
 * @param {string} from - Teléfono del usuario
 * @param {string} botonId - ID del botón presionado
 * @param {Object} session - Sesión actual
 * @param {Object} azureContext - Contexto de Azure Functions
 * @returns {Promise<boolean>} - true si se procesó
 */
async function procesarBoton(from, botonId, session, azureContext) {
  const botonConfig = reporteFlow.botones[botonId];
  if (!botonConfig) {
    return false;
  }

  const handlerName = typeof botonConfig === 'string' ? botonConfig : botonConfig.handler;
  const handler = reporteFlow[handlerName];
  if (typeof handler !== 'function') {
    return false;
  }

  const ctx = {
    from,
    session,
    context: azureContext,
    EstadoCodigo: session.Estado,
    log: (msg) => azureContext.log(`[ReporteFlow] ${msg}`),
  };

  await handler.call(reporteFlow, ctx);
  return true;
}

// Exportar funciones públicas para uso externo
module.exports = reporteFlow;
module.exports.iniciarFlujo = iniciarFlujo;
module.exports.procesarMensaje = procesarMensaje;
module.exports.procesarImagen = procesarImagen;
module.exports.procesarUbicacion = procesarUbicacion;
module.exports.procesarBoton = procesarBoton;
module.exports.esEstadoFlexible = esEstadoFlexible;
