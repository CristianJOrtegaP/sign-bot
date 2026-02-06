/**
 * AC FIXBOT - Procesadores del Flujo Flexible
 * Funciones para procesar mensajes, imágenes y ubicaciones
 * @module flows/modules/processors
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');
const fieldExtractor = require('../../../services/fieldExtractor');
const fieldManager = require('../../../services/fieldManager');
const azureMapsService = require('../../../../core/services/external/azureMapsService');

// Importar funciones de otros módulos
const { esCancelacion, cancelarFlujo } = require('./cancellation');
const { solicitarSiguienteCampo } = require('./fieldHandlers');
const { crearReporte } = require('./reportBuilder');
const { procesarRespuestaConfirmacion } = require('./confirmations');
const { calcularCentroServicioYETA } = require('./serviceCalculation');

/**
 * Maneja la búsqueda y confirmación de equipo por código SAP
 * @param {string} from - Teléfono del usuario
 * @param {Object} camposNuevos - Campos extraídos del mensaje
 * @param {Object} datosActualizados - Datos actualizados de la sesión
 * @param {Object} resumenActualizacion - Resumen de la actualización
 * @param {Object} context - Contexto de Azure Function
 * @returns {Promise<{handled: boolean, datosActualizados: Object, resumenActualizacion: Object}>}
 */
async function manejarBusquedaEquipoSAP(
  from,
  camposNuevos,
  datosActualizados,
  resumenActualizacion,
  context
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
    return { handled: true, datosActualizados, resumenActualizacion };
  }

  // SAP no encontrado, mantener el valor pero notificar
  await whatsapp.sendText(from, MSG.REFRIGERADOR.equipoNoEncontrado(camposNuevos.codigoSAP.valor));
  await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Equipo no encontrado', TIPO_CONTENIDO.TEXTO);

  delete datosActualizados.camposRequeridos.codigoSAP;
  resumenActualizacion.estaCompleto = false;

  return { handled: false, datosActualizados, resumenActualizacion };
}

/**
 * Finaliza el procesamiento del mensaje (actualiza sesión y verifica completitud)
 * @param {string} from - Teléfono del usuario
 * @param {Object} datos - Datos originales de la sesión
 * @param {Object} datosActualizados - Datos actualizados
 * @param {Object} resumenActualizacion - Resumen de la actualización
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 * @returns {Promise<boolean>}
 */
async function finalizarProcesamientoMensaje(
  from,
  datos,
  datosActualizados,
  resumenActualizacion,
  session,
  context
) {
  // Actualizar sesión con datos actualizados
  await db.updateSession(
    from,
    session.EstadoCodigo,
    datosActualizados,
    datosActualizados.equipoIdTemp || session.EquipoIdTemp,
    ORIGEN_ACCION.USUARIO,
    `Campos actualizados: ${resumenActualizacion.camposActualizados.join(', ') || 'ninguno'}`
  );

  // Verificar si el formulario está completo Y tenemos equipo válido para refrigerador
  const requiereEquipo = datos.tipoReporte === TIPO_REPORTE.REFRIGERADOR;
  const tieneEquipoValido = !requiereEquipo || datosActualizados.equipoIdTemp;

  if (resumenActualizacion.estaCompleto && tieneEquipoValido) {
    if (context?.log) {
      context.log(`[FlexibleFlow] Formulario completo, creando reporte`);
    }
    await crearReporte(from, datosActualizados, session, context);
    return true;
  }

  // Solicitar siguiente campo faltante
  await solicitarSiguienteCampo(from, datosActualizados, context);
  return true;
}

/**
 * Procesa un mensaje de texto en el flujo flexible
 * @param {string} from - Teléfono del usuario
 * @param {string} texto - Mensaje del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 * @returns {Promise<boolean>} - true si el mensaje fue procesado
 */
async function procesarMensaje(from, texto, session, context = null) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

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
  let { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
    datos,
    camposNuevos,
    { context }
  );

  // 4. Manejar búsqueda de equipo si tenemos código SAP nuevo (solo refrigeradores)
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
      return true; // Equipo encontrado, esperando confirmación del usuario
    }

    // Actualizar referencias con los datos modificados
    datosActualizados = resultado.datosActualizados;
    resumenActualizacion = resultado.resumenActualizacion;
  }

  // 5. Finalizar procesamiento (actualizar sesión y verificar completitud)
  return finalizarProcesamientoMensaje(
    from,
    datos,
    datosActualizados,
    resumenActualizacion,
    session,
    context
  );
}

/**
 * Procesa una imagen en el flujo flexible
 * @param {string} from - Teléfono del usuario
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} caption - Caption de la imagen
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 * @returns {Promise<boolean>}
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
 * @returns {Promise<boolean>}
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

module.exports = {
  procesarMensaje,
  procesarImagen,
  procesarUbicacion,
};
