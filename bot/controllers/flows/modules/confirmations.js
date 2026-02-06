/**
 * AC FIXBOT - Handlers de Confirmación del Flujo Flexible
 * Maneja confirmaciones y rechazos de equipos detectados y datos de AI Vision
 * @module flows/modules/confirmations
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');
const fieldManager = require('../../../services/fieldManager');
const { solicitarSiguienteCampo } = require('./fieldHandlers');
const { crearReporte } = require('./reportBuilder');

/**
 * Procesa la respuesta del usuario a la confirmación de equipo o datos AI Vision
 * Maneja respuestas de texto como "si", "no", "correcto", etc.
 * @param {string} from - Teléfono del usuario
 * @param {string} texto - Mensaje del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto
 * @returns {Promise<boolean>} - true si se procesó la respuesta
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
    null,
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
    'Equipo rechazado, solicitando código SAP',
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
  }

  // Inicializar camposRequeridos si no existe
  if (!datos.camposRequeridos) {
    datos.camposRequeridos = {};
  }

  // Convertir datos temporales de AI a camposRequeridos según el tipo de reporte
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

module.exports = {
  procesarRespuestaConfirmacion,
  confirmarEquipoDetectado,
  rechazarEquipoDetectado,
  confirmarDatosAI,
  rechazarDatosAI,
};
