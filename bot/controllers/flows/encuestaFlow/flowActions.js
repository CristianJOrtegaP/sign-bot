/**
 * AC FIXBOT - Acciones del Flujo de Encuesta
 * Funciones principales para iniciar, aceptar, rechazar y finalizar encuestas
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const EncuestaRepository = require('../../../repositories/EncuestaRepository');
const { ENCUESTA: MSG, BUTTONS_ENCUESTA } = require('../../../constants/messages');
const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');

const {
  setEncuestaCache,
  clearEncuestaCache,
  updateCachePregunta,
  getEncuestaCached,
  getEncuestaCacheRaw,
} = require('./cache');

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
    setEncuestaCache(
      telefono,
      encuestaId,
      reporte.ReporteId,
      reporte.NumeroTicket,
      tipoEncuesta,
      preguntas
    );

    const datosTemp = JSON.stringify({
      encuestaId: encuestaId,
      reporteId: reporte.ReporteId,
      numeroTicket: reporte.NumeroTicket,
      tipoEncuestaId: tipoEncuesta?.TipoEncuestaId || null,
      numeroPreguntas: tipoEncuesta?.NumeroPreguntas || 6,
    });

    // Enviar invitación PRIMERO (user feedback rápido)
    const msgInvitacion = MSG.invitacion(reporte.NombreCliente, reporte.NumeroTicket);
    await whatsapp.sendInteractiveMessage(telefono, MSG.INVITACION_TITLE, msgInvitacion, [
      BUTTONS_ENCUESTA.ACEPTAR,
      BUTTONS_ENCUESTA.SALIR,
    ]);

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
      db.saveMessage(telefono, TIPO_MENSAJE.BOT, msgInvitacion, TIPO_CONTENIDO.TEXTO),
    ]);

    // Log de errores sin interrumpir el flujo (mensaje ya enviado)
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        logger.warn('Error en operación paralela iniciarEncuesta', {
          operacion: idx === 0 ? 'updateSession' : 'saveMessage',
          error: result.reason?.message,
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
 * Usuario acepta la encuesta (versión con preguntas dinámicas)
 * @param {string} from - Teléfono del usuario
 * @param {number} encuestaId - ID de la encuesta
 * @param {Object} datosTemp - Datos temporales de la sesión
 * @param {Object} context - Contexto con función log
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
    numeroPreguntas,
  };
  const datosTempStr = JSON.stringify(datosTempActualizado);

  // 1. Actualizar BD primero (estado EN_PROCESO resetea PreguntaActual a 0)
  const resultsAceptar = await Promise.allSettled([
    EncuestaRepository.updateEstado(encuestaId, 'EN_PROCESO'),
    db.updateSession(
      from,
      ESTADO.ENCUESTA_PREGUNTA_1,
      datosTempStr,
      null,
      ORIGEN_ACCION.USUARIO,
      'Encuesta aceptada'
    ),
  ]);

  // Log errores pero continuar (usuario ya vio la respuesta)
  resultsAceptar.forEach((result, idx) => {
    if (result.status === 'rejected') {
      logger.error('Error en aceptarEncuesta', result.reason, {
        operacion: idx === 0 ? 'updateEstado' : 'updateSession',
        encuestaId,
      });
    }
  });

  // 2. Actualizar cache local
  updateCachePregunta(from, 0);

  // 3. Enviar mensajes
  await whatsapp.sendText(from, MSG.INSTRUCCIONES);

  // Obtener primera pregunta (dinámica o fallback)
  const primeraPregunta = preguntas.find((p) => p.NumeroPregunta === 1);
  const textoPregunta = primeraPregunta?.TextoPregunta || MSG.PREGUNTA_1;
  const mensajePregunta = `${textoPregunta}\n\n_Escribe un numero del 1 al 5_`;

  await whatsapp.sendInteractiveMessage(from, MSG.PREGUNTA_TITLE(1), mensajePregunta, [
    BUTTONS_ENCUESTA.RATING_1,
    BUTTONS_ENCUESTA.RATING_3,
    BUTTONS_ENCUESTA.RATING_5,
  ]);

  // Fire-and-forget para logs
  db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.INSTRUCCIONES, TIPO_CONTENIDO.TEXTO).catch(() => {});
  db.saveMessage(from, TIPO_MENSAJE.BOT, textoPregunta, TIPO_CONTENIDO.TEXTO).catch(() => {});
}

/**
 * Usuario rechaza la encuesta
 * @param {string} from - Teléfono del usuario
 * @param {number} encuestaId - ID de la encuesta
 * @param {Object} _context - Contexto (no usado)
 */
async function rechazarEncuesta(from, encuestaId, _context) {
  // 1. Enviar mensaje PRIMERO
  await whatsapp.sendText(from, MSG.ENCUESTA_RECHAZADA);

  // 2. Operaciones de BD en paralelo (Promise.allSettled para capturar todos los errores)
  const resultsRechazar = await Promise.allSettled([
    EncuestaRepository.updateEstado(encuestaId, 'RECHAZADA'),
    db.updateSession(
      from,
      ESTADO.FINALIZADO,
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      'Encuesta rechazada'
    ),
  ]);

  resultsRechazar.forEach((result, idx) => {
    if (result.status === 'rejected') {
      logger.error('Error en rechazarEncuesta', result.reason, {
        operacion: idx === 0 ? 'updateEstado' : 'updateSession',
        encuestaId,
      });
    }
  });

  // Limpiar cache
  clearEncuestaCache(from);

  // Fire-and-forget
  db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.ENCUESTA_RECHAZADA, TIPO_CONTENIDO.TEXTO).catch(
    () => {}
  );
}

/**
 * Finaliza la encuesta (con mensaje dinámico del tipo de encuesta)
 * @param {string} from - Teléfono del usuario
 * @param {number} encuestaId - ID de la encuesta
 * @param {boolean} conComentario - Si incluye comentario
 * @param {string} comentario - Comentario del usuario
 * @param {Object} _context - Contexto (no usado)
 */
async function finalizarEncuesta(from, encuestaId, conComentario, comentario, _context) {
  // Intentar obtener mensaje personalizado del cache
  const encuestaData = getEncuestaCacheRaw(from);
  const mensajePersonalizado = encuestaData?.mensajeAgradecimiento;

  // Usar mensaje personalizado si existe, sino fallback a constantes
  let msgAgradecimiento;
  if (mensajePersonalizado) {
    msgAgradecimiento = mensajePersonalizado;
  } else {
    msgAgradecimiento = conComentario ? MSG.AGRADECIMIENTO_CON_COMENTARIO : MSG.AGRADECIMIENTO;
  }

  // 1. Enviar agradecimiento PRIMERO
  await whatsapp.sendText(from, msgAgradecimiento);

  // 2. BD en paralelo (Promise.allSettled para no perder errores)
  const dbOperations = [
    db.updateSession(from, ESTADO.FINALIZADO, null, null, ORIGEN_ACCION.BOT, 'Encuesta completada'),
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
        operacion:
          idx === 0
            ? 'updateSession'
            : conComentario
              ? 'guardarComentario'
              : 'finalizarSinComentario',
        encuestaId,
      });
    }
  });

  // Limpiar cache
  clearEncuestaCache(from);

  // Fire-and-forget
  db.saveMessage(from, TIPO_MENSAJE.BOT, msgAgradecimiento, TIPO_CONTENIDO.TEXTO).catch(() => {});

  logger.info(`Encuesta ${encuestaId} completada`, { telefono: from, conComentario });
}

module.exports = {
  iniciarEncuesta,
  aceptarEncuesta,
  rechazarEncuesta,
  finalizarEncuesta,
};
