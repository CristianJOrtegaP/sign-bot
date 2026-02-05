/**
 * AC FIXBOT - Flexible Flow Manager (FASE 2b)
 *
 * Orquesta el flujo flexible de reporte de problemas.
 * Permite al usuario proporcionar datos en cualquier orden.
 *
 * Estados simplificados:
 * - REFRIGERADOR_ACTIVO: Estado único para todo el flujo de refrigerador
 * - VEHICULO_ACTIVO: Estado único para todo el flujo de vehículo
 *
 * Flujo:
 * 1. Usuario inicia flujo → se crea DatosTemp con camposRequeridos
 * 2. Cada mensaje se procesa con fieldExtractor
 * 3. Campos extraídos se mergean con fieldManager
 * 4. Si faltan campos → preguntar siguiente campo
 * 5. Si está completo → crear reporte
 */

const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const teamsService = require('../../../core/services/external/teamsService');
const MSG = require('../../constants/messages');
const {
  safeParseJSON: _safeParseJSON,
  sanitizeDescription,
} = require('../../../core/utils/helpers');
const { logger } = require('../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../constants/sessionStates');

// Services de FASE 2b
const fieldExtractor = require('../../services/fieldExtractor');
const fieldManager = require('../../services/fieldManager');

// Servicios para cálculo de centro de servicio más cercano
const centroServicioRepo = require('../../repositories/CentroServicioRepository');
const azureMapsService = require('../../../core/services/external/azureMapsService');

// ==============================================================
// MAPEO DE ESTADOS FLEXIBLES
// ==============================================================

const ESTADO_FLEXIBLE = {
  [TIPO_REPORTE.REFRIGERADOR]: 'REFRIGERADOR_ACTIVO',
  [TIPO_REPORTE.VEHICULO]: 'VEHICULO_ACTIVO',
};

// ==============================================================
// INICIALIZACIÓN DE FLUJO
// ==============================================================

/**
 * Inicia un flujo flexible de reporte
 * @param {string} from - Teléfono del usuario
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @param {Object} datosIniciales - Datos ya extraídos (opcional)
 * @param {Object} context - Contexto de Azure Function
 */
async function iniciarFlujo(from, tipoReporte, datosIniciales = {}, context = null) {
  const estadoFlexible = ESTADO_FLEXIBLE[tipoReporte];

  if (!estadoFlexible) {
    logger.error(`[FlexibleFlow] Tipo de reporte desconocido: ${tipoReporte}`);
    throw new Error(`Tipo de reporte no soportado: ${tipoReporte}`);
  }

  // Crear DatosTemp con estructura de campos requeridos
  const datosTemp = fieldManager.crearDatosTemp(tipoReporte);
  let resumenActualizacion = { estaCompleto: false };

  // Si vienen datos iniciales (de detección de intención), mergearlos
  if (datosIniciales && Object.keys(datosIniciales).length > 0) {
    const resultado = fieldManager.actualizarDatosTemp(datosTemp, datosIniciales, { context });
    Object.assign(datosTemp, resultado.datosActualizados);
    resumenActualizacion = resultado.resumenActualizacion;
  }

  // Si es REFRIGERADOR y viene código SAP, validarlo contra la BD
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

      if (context?.log) {
        context.log(`[FlexibleFlow] Equipo encontrado en inicio: ${equipo.EquipoId}`);
      }

      // Cambiar a estado de confirmación para pedir al usuario que confirme
      await db.updateSession(
        from,
        ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
        datosTemp,
        equipo.EquipoId,
        ORIGEN_ACCION.BOT,
        `Código SAP inicial: ${sapValor}, esperando confirmación`
      );

      // Pedir confirmación al usuario
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

      if (context?.log) {
        context.log(
          `[FlexibleFlow] Flujo iniciado: ${tipoReporte}, esperando confirmación de equipo`
        );
      }
      return; // Esperar confirmación del usuario
    }
    // SAP no encontrado, eliminar el valor inválido
    if (context?.log) {
      context.log(`[FlexibleFlow] SAP no encontrado: ${sapValor}`);
    }
    delete datosTemp.camposRequeridos.codigoSAP;
    resumenActualizacion.estaCompleto = false;

    // Notificar al usuario
    await whatsapp.sendText(from, MSG.REFRIGERADOR.equipoNoEncontrado(sapValor));
    await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Equipo no encontrado', TIPO_CONTENIDO.TEXTO);
  }

  // Actualizar sesión al estado flexible
  await db.updateSession(
    from,
    estadoFlexible,
    datosTemp,
    datosTemp.equipoIdTemp || null,
    ORIGEN_ACCION.BOT,
    `Flujo flexible ${tipoReporte} iniciado`
  );

  if (context?.log) {
    context.log(`[FlexibleFlow] Flujo iniciado: ${tipoReporte}, estado: ${estadoFlexible}`);
  }

  // Enviar mensaje inicial pidiendo el primer campo faltante
  await solicitarSiguienteCampo(from, datosTemp, context);
}

/**
 * Inicia flujo con datos pre-extraídos de un mensaje inicial
 * @param {string} from - Teléfono del usuario
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @param {string} mensajeOriginal - Mensaje original del usuario
 * @param {Object} context - Contexto
 */
async function iniciarFlujoConMensaje(from, tipoReporte, mensajeOriginal, context = null) {
  // Extraer todos los campos posibles del mensaje inicial
  const { campos } = await fieldExtractor.extractAllFields(mensajeOriginal, {
    tipoReporte,
    useAI: true,
    context,
  });

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Campos extraídos de mensaje inicial: ${tipoReporte}, campos: ${Object.keys(campos).join(', ')}`
    );
  }

  await iniciarFlujo(from, tipoReporte, campos, context);
}

// ==============================================================
// PROCESAMIENTO DE MENSAJES
// ==============================================================

/**
 * Procesa un mensaje de texto en el flujo flexible
 * @param {string} from - Teléfono del usuario
 * @param {string} texto - Mensaje del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 * @returns {boolean} - true si el mensaje fue procesado
 */
async function procesarMensaje(from, texto, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  // DEBUG: Log campoSolicitado al recibir mensaje
  logger.info('[FlexibleFlow] procesarMensaje - Estado de sesión recibido', {
    telefono: from,
    estado: session.Estado,
    campoSolicitado: datos.campoSolicitado || 'NULL',
    tipoReporte: datos.tipoReporte || 'NULL',
    datosTemp: session.DatosTemp ? session.DatosTemp.substring(0, 300) : 'NULL',
  });

  // Manejar estados de confirmación (equipo OCR o datos AI Vision)
  if (
    session.EstadoCodigo === ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO ||
    session.EstadoCodigo === ESTADO.VEHICULO_CONFIRMAR_DATOS_AI ||
    session.EstadoCodigo === ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI
  ) {
    return procesarRespuestaConfirmacion(from, texto, session, context);
  }

  if (!datos.tipoReporte) {
    logger.warn(`[FlexibleFlow] Sesión sin tipoReporte`, { telefono: from });
    return false;
  }

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Procesando mensaje: ${datos.tipoReporte}, longitud: ${texto.length}, campoSolicitado: ${datos.campoSolicitado || 'NULL'}`
    );
  }

  // 1. Extraer campos del mensaje
  // NOTA: Pasamos campoSolicitado para que el extractor priorice ese campo
  // si el mensaje es ambiguo (ej: un número que podría ser SAP o empleado)
  const { campos: camposNuevos, totalCampos } = await fieldExtractor.extractAllFields(texto, {
    tipoReporte: datos.tipoReporte,
    useAI: true,
    context,
    campoSolicitado: datos.campoSolicitado,
  });

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Campos extraídos: ${totalCampos}, campos: ${Object.keys(camposNuevos).join(', ')}`
    );
  }

  // 2. Verificar si es un comando de cancelación
  if (esCancelacion(texto)) {
    await cancelarFlujo(from, session, context);
    return true;
  }

  // 3. Mergear campos extraídos con existentes
  const { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
    datos,
    camposNuevos,
    { context }
  );

  // 4. Manejar búsqueda de equipo si tenemos código SAP nuevo
  if (
    camposNuevos.codigoSAP &&
    datos.tipoReporte === TIPO_REPORTE.REFRIGERADOR &&
    !datosActualizados.equipoIdTemp
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
      if (context?.log) {
        context.log(`[FlexibleFlow] Equipo encontrado: ${equipo.EquipoId}, pidiendo confirmación`);
      }

      // Cambiar a estado de confirmación
      await db.updateSession(
        from,
        ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
        datosActualizados,
        equipo.EquipoId,
        ORIGEN_ACCION.BOT,
        `Código SAP ingresado: ${camposNuevos.codigoSAP.valor}, esperando confirmación`
      );

      // Pedir confirmación al usuario con botones
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
      return true; // Esperar confirmación del usuario
    }
    // SAP no encontrado, mantener el valor pero notificar
    await whatsapp.sendText(
      from,
      MSG.REFRIGERADOR.equipoNoEncontrado(camposNuevos.codigoSAP.valor)
    );
    await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Equipo no encontrado', TIPO_CONTENIDO.TEXTO);

    // Limpiar el SAP inválido y marcar como incompleto
    delete datosActualizados.camposRequeridos.codigoSAP;

    // IMPORTANTE: Recalcular completitud porque eliminamos el SAP
    resumenActualizacion.estaCompleto = false;
  }

  // 5. Actualizar sesión con datos actualizados
  await db.updateSession(
    from,
    session.EstadoCodigo,
    datosActualizados,
    datosActualizados.equipoIdTemp || session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    `Campos actualizados: ${resumenActualizacion.camposActualizados.join(', ') || 'ninguno'}`
  );

  // 6. Verificar si el formulario está completo Y tenemos equipo válido para refrigerador
  const requiereEquipo = datos.tipoReporte === TIPO_REPORTE.REFRIGERADOR;
  const tieneEquipoValido = !requiereEquipo || datosActualizados.equipoIdTemp;

  if (resumenActualizacion.estaCompleto && tieneEquipoValido) {
    if (context?.log) {
      context.log(`[FlexibleFlow] Formulario completo, creando reporte`);
    }
    await crearReporte(from, datosActualizados, session, context);
    return true;
  }

  // 7. Solicitar siguiente campo faltante
  await solicitarSiguienteCampo(from, datosActualizados, context);

  return true;
}

/**
 * Procesa una imagen en el flujo flexible
 * @param {string} from - Teléfono del usuario
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} caption - Caption de la imagen
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function procesarImagen(from, imageBuffer, caption, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (!datos.tipoReporte) {
    return false;
  }

  // Extraer campos de la imagen
  const { campos: camposImagen } = await fieldExtractor.extractFieldsFromImage(
    imageBuffer,
    caption,
    { context }
  );

  // Mergear y continuar flujo normal
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
    // No se extrajeron campos de la imagen
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
 * @param {string} from - Teléfono del usuario
 * @param {Object} ubicacion - { latitud, longitud, nombre?, direccion? }
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function procesarUbicacion(from, ubicacion, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (!datos.tipoReporte) {
    return false;
  }

  // Obtener dirección en texto usando geocoding inverso de Azure Maps
  let direccionTexto = ubicacion.direccion || ubicacion.nombre;

  if (!direccionTexto && azureMapsService.isConfigured()) {
    try {
      if (context?.log) {
        context.log(
          `[FlexibleFlow] Obteniendo dirección para: ${ubicacion.latitud}, ${ubicacion.longitud}`
        );
      }
      const geoResult = await azureMapsService.reverseGeocode(
        ubicacion.latitud,
        ubicacion.longitud
      );
      if (geoResult) {
        direccionTexto = azureMapsService.formatDireccion(geoResult);
        if (context?.log) {
          context.log(`[FlexibleFlow] Dirección obtenida: ${direccionTexto}`);
        }
      }
    } catch (error) {
      logger.warn('[FlexibleFlow] Error en geocoding inverso', { error: error.message });
    }
  }

  // Usar coordenadas como fallback si no tenemos dirección
  if (!direccionTexto) {
    direccionTexto = `${ubicacion.latitud}, ${ubicacion.longitud}`;
  }

  // Crear campo de ubicación
  const campoUbicacion = {
    ubicacion: {
      valor: direccionTexto,
      confianza: 100,
      fuente: 'ubicacion_compartida',
      coordenadas: {
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
      },
    },
  };

  const { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
    datos,
    campoUbicacion,
    { context }
  );

  // Para reportes de VEHÍCULO, calcular centro de servicio más cercano y tiempo de llegada
  if (datos.tipoReporte === TIPO_REPORTE.VEHICULO) {
    try {
      await calcularCentroServicioYETA(datosActualizados, ubicacion, context);
    } catch (error) {
      // Si falla el cálculo, continuar sin ETA
      logger.warn('[FlexibleFlow] Error calculando centro/ETA, continuando sin esa info', {
        error: error.message,
      });
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

/**
 * Calcula el centro de servicio más cercano y el tiempo estimado de llegada
 * @param {Object} datosActualizados - DatosTemp a actualizar
 * @param {Object} ubicacion - { latitud, longitud }
 * @param {Object} context - Contexto
 */
async function calcularCentroServicioYETA(datosActualizados, ubicacion, context = null) {
  if (context?.log) {
    context.log(
      `[FlexibleFlow] Calculando centro más cercano para ubicación: ${ubicacion.latitud}, ${ubicacion.longitud}`
    );
  }

  // 1. Buscar el centro de servicio más cercano (usa fórmula Haversine)
  const centroMasCercano = await centroServicioRepo.findNearest(
    ubicacion.latitud,
    ubicacion.longitud
  );

  if (!centroMasCercano) {
    logger.warn('[FlexibleFlow] No se encontraron centros de servicio activos');
    return;
  }

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Centro más cercano: ${centroMasCercano.Nombre} (${centroMasCercano.DistanciaKm} km)`
    );
  }

  // 2. Calcular ruta con Azure Maps (incluye buffer de tiempo)
  let rutaInfo = null;
  if (azureMapsService.isConfigured()) {
    rutaInfo = await azureMapsService.getRoute(
      { latitud: centroMasCercano.Latitud, longitud: centroMasCercano.Longitud },
      { latitud: ubicacion.latitud, longitud: ubicacion.longitud }
    );

    if (context?.log && rutaInfo) {
      context.log(
        `[FlexibleFlow] Ruta calculada: ${rutaInfo.tiempoConBufferMin} min (incluye ${rutaInfo.bufferMinutos} min buffer)`
      );
    }
  }

  // 3. Guardar info del centro y ETA en datosActualizados
  datosActualizados.centroServicio = {
    centroServicioId: centroMasCercano.CentroServicioId,
    codigo: centroMasCercano.Codigo,
    nombre: centroMasCercano.Nombre,
    ciudad: centroMasCercano.Ciudad,
    distanciaDirectaKm: centroMasCercano.DistanciaKm,
  };

  // Si tenemos ruta de Azure Maps, usar esos datos
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
    // Sin Azure Maps, estimar con distancia directa (promedio 30 km/h en ciudad + buffer)
    const tiempoEstimadoBase = Math.ceil((centroMasCercano.DistanciaKm / 30) * 60);
    const bufferMinutos = 20; // Buffer por defecto
    datosActualizados.tiempoLlegada = {
      tiempoEstimadoMin: tiempoEstimadoBase + bufferMinutos,
      distanciaKm: centroMasCercano.DistanciaKm,
      centroNombre: centroMasCercano.Nombre,
      estimacionSimple: true, // Flag para indicar que es estimación simple
    };
  }

  if (context?.log) {
    context.log(
      `[FlexibleFlow] ETA calculado: ${datosActualizados.tiempoLlegada.tiempoEstimadoMin} min desde ${centroMasCercano.Nombre}`
    );
  }
}

// ==============================================================
// SOLICITUD DE CAMPOS
// ==============================================================

/**
 * Solicita el siguiente campo faltante al usuario
 * @param {string} from - Teléfono del usuario
 * @param {Object} datosTemp - DatosTemp actual
 * @param {Object} context - Contexto
 */
async function solicitarSiguienteCampo(from, datosTemp, context = null) {
  const siguienteCampo = fieldManager.getSiguienteCampoFaltante(
    datosTemp.camposRequeridos,
    datosTemp.tipoReporte
  );

  if (!siguienteCampo) {
    // No hay campos faltantes, esto no debería pasar
    logger.warn(`[FlexibleFlow] solicitarSiguienteCampo llamado sin campos faltantes`);
    return;
  }

  const completitud = fieldManager.calcularCompletitud(
    datosTemp.camposRequeridos,
    datosTemp.tipoReporte
  );

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Solicitando campo: ${siguienteCampo.nombre}, completitud: ${completitud.porcentaje}%`
    );
  }

  // Construir mensaje según el campo faltante
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
      // Sin botón de ubicación - solo instrucciones en el mensaje
      break;

    default:
      mensaje = `Por favor, proporciona: ${siguienteCampo.descripcion}`;
  }

  // Agregar indicador de progreso
  const progresoMsg = `\n\n📊 Progreso: ${completitud.completados}/${completitud.total} campos`;
  mensaje += progresoMsg;

  // IMPORTANTE: Guardar qué campo se está solicitando para contexto
  // Esto permite que el FieldExtractor priorice este campo en la siguiente respuesta
  datosTemp.campoSolicitado = siguienteCampo.nombre;

  // DEBUG: Log antes de guardar (usar context.log para Azure Functions)
  if (context?.log) {
    context.log(
      `[FlexibleFlow] 📝 Guardando campoSolicitado=${datosTemp.campoSolicitado} en sesión`
    );
    context.log(`[FlexibleFlow] DatosTemp: ${JSON.stringify(datosTemp).substring(0, 300)}`);
  }

  // Actualizar sesión con el campo solicitado
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

  // DEBUG: Confirmar que se guardó
  if (context?.log) {
    context.log(
      `[FlexibleFlow] ✅ Sesión actualizada: estado=${estadoActual}, campoSolicitado=${siguienteCampo.nombre}`
    );
  }

  // Enviar mensaje con botones
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

/**
 * Genera mensaje para solicitar descripción del problema
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
 * Obtiene el título según tipo de flujo
 */
function getTituloFlujo(tipoReporte) {
  return tipoReporte === TIPO_REPORTE.REFRIGERADOR
    ? MSG.REFRIGERADOR.TITLE
    : MSG.VEHICULO?.TITLE || '🚗 Reporte de Vehículo';
}

// ==============================================================
// CREACIÓN DE REPORTE
// ==============================================================

/**
 * Crea el reporte una vez que todos los campos están completos
 * @param {string} from - Teléfono del usuario
 * @param {Object} datosTemp - DatosTemp con todos los campos
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function crearReporte(from, datosTemp, session, context = null) {
  const { tipoReporte, camposRequeridos, equipoIdTemp, datosEquipo } = datosTemp;

  if (context?.log) {
    context.log(`[FlexibleFlow] Creando reporte: ${tipoReporte}, equipoId: ${equipoIdTemp}`);
  }

  try {
    let numeroTicket;

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
      numeroTicket = await crearReporteRefrigerador(from, datosTemp, session, context);
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
      numeroTicket = await crearReporteVehiculo(from, datosTemp, session, context);
    } else {
      throw new Error(`Tipo de reporte no soportado: ${tipoReporte}`);
    }

    // Cambiar a estado FINALIZADO
    await db.updateSession(
      from,
      ESTADO.FINALIZADO,
      null,
      null,
      ORIGEN_ACCION.BOT,
      `Reporte creado: ${numeroTicket}`
    );

    // Enviar confirmación
    let msgConfirmacion;
    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
      msgConfirmacion = MSG.REFRIGERADOR.reporteCreado(
        numeroTicket,
        datosEquipo,
        camposRequeridos.problema.valor
      );
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
      // Extraer parámetros para mensaje de vehículo
      const codigoSAP = camposRequeridos.codigoSAP?.valor;
      const numeroEmpleado = camposRequeridos.numeroEmpleado?.valor;
      const descripcion = camposRequeridos.problema?.valor;
      const ubicacion = camposRequeridos.ubicacion?.valor || null;

      // Obtener info de tiempo de llegada si está disponible
      const tiempoLlegadaInfo = datosTemp.tiempoLlegada || null;

      msgConfirmacion =
        MSG.VEHICULO?.reporteCreado?.(
          numeroTicket,
          codigoSAP,
          numeroEmpleado,
          descripcion,
          ubicacion,
          tiempoLlegadaInfo
        ) ||
        `✅ ¡Reporte creado exitosamente!\n\n📋 Ticket: ${numeroTicket}\n\nTe contactaremos pronto.`;
    } else {
      msgConfirmacion = `✅ ¡Reporte creado exitosamente!\n\n📋 Ticket: ${numeroTicket}\n\nTe contactaremos pronto.`;
    }

    await whatsapp.sendText(from, msgConfirmacion);
    await db.saveMessage(from, TIPO_MENSAJE.BOT, msgConfirmacion, TIPO_CONTENIDO.TEXTO);

    // Notificar a Teams (fire-and-forget, no bloquea el flujo)
    teamsService
      .notifyTicketCreated(from, tipoReporte, numeroTicket, {
        codigoSAP: camposRequeridos.codigoSAP?.valor,
        numeroEmpleado: camposRequeridos.numeroEmpleado?.valor,
        problema: camposRequeridos.problema?.valor,
        ubicacion: camposRequeridos.ubicacion?.valor,
      })
      .catch((err) => logger.warn('[FlexibleFlow] Error notificando a Teams:', err.message));

    if (context?.log) {
      context.log(`[FlexibleFlow] Reporte creado exitosamente: ${numeroTicket}`);
    }

    return numeroTicket;
  } catch (error) {
    logger.error(`[FlexibleFlow] Error creando reporte`, { error: error.message });
    await whatsapp.sendText(
      from,
      MSG.GENERAL.ERROR_INTERNO ||
        'Ocurrió un error al crear el reporte. Por favor, intenta de nuevo.'
    );
    throw error;
  }
}

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

  const numeroTicket = await db.createReporte(
    equipoIdTemp,
    equipo.ClienteId,
    from,
    descripcion,
    null // imagenUrl
  );

  return numeroTicket;
}

/**
 * Crea reporte de vehículo
 */
async function crearReporteVehiculo(from, datosTemp, session, context) {
  const { camposRequeridos, centroServicio, tiempoLlegada } = datosTemp;

  const descripcion = sanitizeDescription(camposRequeridos.problema.valor);
  const numeroEmpleado = camposRequeridos.numeroEmpleado?.valor;
  const codigoSAP = camposRequeridos.codigoSAP?.valor;

  // Construir objeto de ubicación para el repositorio
  const ubicacionObj = camposRequeridos.ubicacion?.coordenadas
    ? {
        latitud: camposRequeridos.ubicacion.coordenadas.latitud,
        longitud: camposRequeridos.ubicacion.coordenadas.longitud,
        direccion: camposRequeridos.ubicacion.valor || null,
      }
    : null;

  // Extraer datos del centro de servicio y ETA si están disponibles
  const centroServicioId = centroServicio?.centroServicioId || null;
  const tiempoEstimadoMinutos = tiempoLlegada?.tiempoEstimadoMin || null;
  const distanciaCentroKm =
    tiempoLlegada?.distanciaKm || centroServicio?.distanciaDirectaKm || null;

  // Usar createReporteVehiculo específico para vehículos
  const numeroTicket = await db.createReporteVehiculo(
    codigoSAP, // codigoSAPVehiculo
    numeroEmpleado, // numeroEmpleado
    from, // telefono
    descripcion, // descripcion del problema
    null, // imagenUrl (opcional)
    ubicacionObj, // ubicacion { latitud, longitud, direccion }
    centroServicioId, // centroServicioId
    tiempoEstimadoMinutos, // tiempoEstimadoMinutos
    distanciaCentroKm // distanciaCentroKm
  );

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Reporte vehículo creado: ${numeroTicket}, SAP: ${codigoSAP}, Empleado: ${numeroEmpleado}, Centro: ${centroServicio?.nombre || 'N/A'}, ETA: ${tiempoEstimadoMinutos || 'N/A'} min`
    );
  }

  return numeroTicket;
}

// ==============================================================
// CANCELACIÓN
// ==============================================================

/**
 * Verifica si el mensaje es una cancelación
 */
function esCancelacion(texto) {
  return /^(cancelar|salir|exit|quit|no\s*quiero|terminar)$/i.test(texto.trim());
}

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

  if (context?.log) {
    context.log(`[FlexibleFlow] Flujo cancelado: ${from}`);
  }
}

// ==============================================================
// HANDLERS PARA BOTONES
// ==============================================================

/**
 * Procesa respuesta de botón en flujo flexible
 * @param {string} from - Teléfono
 * @param {string} buttonId - ID del botón presionado
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function procesarBoton(from, buttonId, session, context = null) {
  switch (buttonId) {
    case 'btn_cancelar':
    case 'cancelar':
      await cancelarFlujo(from, session, context);
      return true;

    case 'btn_confirmar_equipo':
      // Usuario confirmó que el equipo detectado es correcto
      await confirmarEquipoDetectado(from, session, context);
      return true;

    case 'btn_rechazar_equipo':
      // Usuario indicó que el equipo no es correcto
      await rechazarEquipoDetectado(from, session, context);
      return true;

    case 'btn_confirmar':
    case 'confirmar': {
      // Confirmar el campo actual que requiere confirmación
      const datos = fieldManager.parseDatosTemp(session.DatosTemp);
      // Buscar campo con requiereConfirmacion
      for (const [nombre, campo] of Object.entries(datos.camposRequeridos)) {
        if (campo.requiereConfirmacion) {
          datos.camposRequeridos = fieldManager.confirmarCampo(datos.camposRequeridos, nombre);
          break;
        }
      }

      await db.updateSession(
        from,
        session.EstadoCodigo,
        datos,
        session.EquipoIdTemp,
        ORIGEN_ACCION.USUARIO,
        'Campo confirmado'
      );

      // Verificar si está completo
      if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
        await crearReporte(from, datos, session, context);
      } else {
        await solicitarSiguienteCampo(from, datos, context);
      }
      return true;
    }

    case 'btn_ubicacion_info':
      // El usuario presionó el botón de compartir ubicación
      // Mostrar instrucciones de cómo enviar ubicación en WhatsApp
      await whatsapp.sendText(
        from,
        '📍 *Cómo compartir tu ubicación:*\n\n1. Presiona el ícono de 📎 (adjuntar)\n2. Selecciona "Ubicación"\n3. Elige "Enviar ubicación actual"\n\nO también puedes escribir la dirección manualmente.'
      );
      return true;

    case 'btn_confirmar_ai':
      // Usuario confirmó los datos detectados por AI Vision
      await confirmarDatosAI(from, session, context);
      return true;

    case 'btn_rechazar_ai':
      // Usuario rechazó los datos detectados por AI Vision
      await rechazarDatosAI(from, session, context);
      return true;

    default:
      return false;
  }
}

/**
 * Procesa la respuesta del usuario a la confirmación de equipo o datos AI Vision
 * Maneja respuestas de texto como "si", "no", "correcto", etc.
 * @param {string} from - Teléfono del usuario
 * @param {string} texto - Mensaje del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 * @returns {boolean} - true si se procesó la respuesta
 */
async function procesarRespuestaConfirmacion(from, texto, session, context = null) {
  const textoLimpio = texto.trim().toLowerCase();

  // Patrones de confirmación positiva
  const esConfirmacion =
    /^(s[ií]|si|sip|sep|ok|okey|okay|correcto|exacto|afirmativo|confirmo|ese\s*(es|mero)|es\s*ese|es\s*correcto)$/i.test(
      textoLimpio
    );

  // Patrones de negación
  const esNegacion =
    /^(no|nel|nop|nope|negativo|incorrecto|no\s*es|otro|es\s*otro|ese\s*no)$/i.test(textoLimpio);

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Respuesta confirmación: "${texto}" -> confirmación=${esConfirmacion}, negación=${esNegacion}, estado=${session.EstadoCodigo}`
    );
  }

  // Determinar si es confirmación de equipo OCR o de datos AI Vision
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

  // Si no es ni sí ni no, preguntar de nuevo
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

/**
 * Confirma el equipo detectado y continúa el flujo
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function confirmarEquipoDetectado(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (context?.log) {
    context.log(`[FlexibleFlow] Usuario confirmó equipo: ${datos.datosEquipo?.CodigoSAP}`);
  }

  // Marcar el campo codigoSAP como confirmado
  if (datos.camposRequeridos.codigoSAP) {
    datos.camposRequeridos.codigoSAP.completo = true;
    datos.camposRequeridos.codigoSAP.fuente = 'ocr_confirmado';
    datos.camposRequeridos.codigoSAP.confianza = 100;
  }

  // Cambiar estado de vuelta a REFRIGERADOR_ACTIVO
  await db.updateSession(
    from,
    ESTADO.REFRIGERADOR_ACTIVO,
    datos,
    session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    'Equipo confirmado por usuario'
  );

  // Verificar si el formulario está completo
  if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
    if (context?.log) {
      context.log(`[FlexibleFlow] Formulario completo, creando reporte`);
    }
    await crearReporte(from, datos, session, context);
  } else {
    // Solicitar siguiente campo faltante
    if (context?.log) {
      context.log(`[FlexibleFlow] Solicitando siguiente campo faltante`);
    }
    await solicitarSiguienteCampo(from, datos, context);
  }
}

/**
 * Rechaza el equipo detectado y permite al usuario corregir
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function rechazarEquipoDetectado(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (context?.log) {
    context.log(`[FlexibleFlow] Usuario rechazó equipo: ${datos.datosEquipo?.CodigoSAP}`);
  }

  // Limpiar datos del equipo detectado
  delete datos.datosEquipo;
  delete datos.equipoIdTemp;
  if (datos.camposRequeridos.codigoSAP) {
    datos.camposRequeridos.codigoSAP = {
      valor: null,
      completo: false,
      fuente: null,
      confianza: 0,
    };
  }

  // Cambiar estado de vuelta a REFRIGERADOR_ACTIVO
  await db.updateSession(
    from,
    ESTADO.REFRIGERADOR_ACTIVO,
    datos,
    null, // Limpiar equipoIdTemp
    ORIGEN_ACCION.USUARIO,
    'Equipo rechazado por usuario'
  );

  // Pedir al usuario que envíe otra imagen o escriba el código
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
    'Equipo rechazado, solicitando nuevo código',
    TIPO_CONTENIDO.TEXTO
  );
}

/**
 * Confirma los datos detectados por AI Vision y continúa el flujo apropiado
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function confirmarDatosAI(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (context?.log) {
    context.log(`[FlexibleFlow] Usuario confirmó datos AI Vision. Tipo: ${datos.tipoReporte}`);
    // DEBUG: Log todos los campos disponibles en datos
    context.log(`[FlexibleFlow] DatosTemp crudo: ${session.DatosTemp?.substring(0, 500)}`);
    context.log(
      `[FlexibleFlow] Campos AI detectados: problemaTemp=${datos.problemaTemp || 'NULL'}, codigoSAPVehiculo=${datos.codigoSAPVehiculo || 'NULL'}, numeroEmpleado=${datos.numeroEmpleado || 'NULL'}, problema=${datos.problema || 'NULL'}, codigoSAP=${datos.codigoSAP || 'NULL'}`
    );
  }

  // Inicializar camposRequeridos si no existe
  if (!datos.camposRequeridos) {
    datos.camposRequeridos = {};
  }

  // Convertir datos temporales de AI a camposRequeridos según el tipo de reporte
  if (datos.tipoReporte === TIPO_REPORTE.VEHICULO) {
    // Para vehículos: problema, codigoSAP, numeroEmpleado, ubicacion
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
    // Para refrigeradores: codigoSAP, problema
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

  // Determinar el nuevo estado según el tipo de reporte
  const nuevoEstado =
    datos.tipoReporte === TIPO_REPORTE.VEHICULO
      ? ESTADO.VEHICULO_ACTIVO
      : ESTADO.REFRIGERADOR_ACTIVO;

  // Actualizar sesión al estado flexible correspondiente
  await db.updateSession(
    from,
    nuevoEstado,
    datos,
    session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    'Datos AI Vision confirmados por usuario'
  );

  // Verificar si el formulario está completo
  if (fieldManager.estaCompleto(datos.camposRequeridos, datos.tipoReporte)) {
    if (context?.log) {
      context.log(`[FlexibleFlow] Formulario completo con datos AI, creando reporte`);
    }
    await crearReporte(from, datos, session, context);
  } else {
    // Solicitar siguiente campo faltante
    if (context?.log) {
      context.log(`[FlexibleFlow] Solicitando campos faltantes después de confirmación AI`);
    }
    await solicitarSiguienteCampo(from, datos, context);
  }
}

/**
 * Rechaza los datos detectados por AI Vision y permite al usuario corregir
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 */
async function rechazarDatosAI(from, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  if (context?.log) {
    context.log(`[FlexibleFlow] Usuario rechazó datos AI Vision`);
  }

  // Limpiar los datos detectados por AI Vision
  delete datos.problemaTemp;
  delete datos.codigoSAPVehiculo;
  delete datos.codigoSAP;
  delete datos.problema;
  delete datos.numeroEmpleado;
  delete datos.informacionVisual;
  // Mantener tipoReporte para que el usuario no tenga que volver a indicarlo

  // Reinicializar camposRequeridos vacíos
  datos.camposRequeridos = {};

  // Determinar el nuevo estado según el tipo de reporte
  const nuevoEstado =
    datos.tipoReporte === TIPO_REPORTE.VEHICULO
      ? ESTADO.VEHICULO_ACTIVO
      : ESTADO.REFRIGERADOR_ACTIVO;

  // Actualizar sesión al estado flexible correspondiente
  await db.updateSession(
    from,
    nuevoEstado,
    datos,
    null,
    ORIGEN_ACCION.USUARIO,
    'Datos AI Vision rechazados por usuario'
  );

  // Notificar al usuario y pedir datos manualmente
  const tipoTexto = datos.tipoReporte === TIPO_REPORTE.VEHICULO ? 'vehículo' : 'refrigerador';
  await whatsapp.sendText(
    from,
    `📝 *Sin problema.* Vamos a registrar tu reporte de ${tipoTexto} manualmente.\n\n` +
      'Por favor, proporciona la información solicitada.'
  );

  await db.saveMessage(
    from,
    TIPO_MENSAJE.BOT,
    'Datos AI rechazados, iniciando flujo manual',
    TIPO_CONTENIDO.TEXTO
  );

  // Solicitar primer campo
  await solicitarSiguienteCampo(from, datos, context);
}

// ==============================================================
// VERIFICACIÓN DE ESTADO
// ==============================================================

/**
 * Verifica si un estado es un estado flexible
 * @param {string} estado - Código de estado
 * @returns {boolean}
 */
function esEstadoFlexible(estado) {
  return (
    estado === 'REFRIGERADOR_ACTIVO' ||
    estado === 'VEHICULO_ACTIVO' ||
    estado === 'REFRIGERADOR_CONFIRMAR_EQUIPO' ||
    estado === 'VEHICULO_CONFIRMAR_DATOS_AI' ||
    estado === 'REFRIGERADOR_CONFIRMAR_DATOS_AI'
  );
}

/**
 * Obtiene el tipo de reporte desde un estado flexible
 * @param {string} estado - Código de estado
 * @returns {string|null}
 */
function getTipoReportePorEstado(estado) {
  if (estado === 'REFRIGERADOR_ACTIVO') {
    return TIPO_REPORTE.REFRIGERADOR;
  }
  if (estado === 'VEHICULO_ACTIVO') {
    return TIPO_REPORTE.VEHICULO;
  }
  return null;
}

// ==============================================================
// EXPORTS
// ==============================================================

module.exports = {
  // Inicialización
  iniciarFlujo,
  iniciarFlujoConMensaje,

  // Procesamiento
  procesarMensaje,
  procesarImagen,
  procesarUbicacion,
  procesarBoton,

  // Creación de reportes
  crearReporte,

  // Utilidades
  esEstadoFlexible,
  getTipoReportePorEstado,
  solicitarSiguienteCampo,
  cancelarFlujo,

  // Constantes
  ESTADO_FLEXIBLE,
};
