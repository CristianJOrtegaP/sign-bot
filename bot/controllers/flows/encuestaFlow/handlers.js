/**
 * AC FIXBOT - Handlers de Estados del Flujo de Encuesta
 * Maneja las respuestas del usuario en cada estado de la encuesta
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const EncuestaRepository = require('../../../repositories/EncuestaRepository');
const { ENCUESTA: MSG, BUTTONS_ENCUESTA } = require('../../../constants/messages');
const { safeParseJSON } = require('../../../../core/utils/helpers');
const { logger: _logger } = require('../../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');

const { getEncuestaCached, updateCachePregunta } = require('./cache');
const { aceptarEncuesta, rechazarEncuesta, finalizarEncuesta } = require('./flowActions');
const { PREGUNTA_A_ESTADO, PREGUNTA_MENSAJES, extraerCalificacion } = require('./helpers');

/**
 * Maneja la respuesta a la invitación
 * @param {string} from - Teléfono del usuario
 * @param {string} input - Input del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
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
    await whatsapp.sendInteractiveMessage(from, MSG.INVITACION_TITLE, MSG.SELECCIONA_OPCION, [
      BUTTONS_ENCUESTA.ACEPTAR,
      BUTTONS_ENCUESTA.SALIR,
    ]);
  }
}

/**
 * Procesa la respuesta a una pregunta de calificación (OPTIMIZADO + DINÁMICO)
 *
 * Flujo optimizado:
 * 1. Obtener encuesta del cache (incluye preguntaActual y preguntas dinámicas)
 * 2. Verificar estado en BD ANTES de enviar WhatsApp (evita race conditions)
 * 3. Si es inválido, no enviar nada (otro webhook ya procesó)
 * 4. Guardar respuesta de forma atómica
 * 5. Solo si tuvo éxito, enviar WhatsApp y actualizar sesión
 *
 * @param {string} from - Teléfono del usuario
 * @param {string} input - Input del usuario
 * @param {Object} _session - Sesión del usuario (no usado directamente)
 * @param {Object} context - Contexto con función log
 */
async function handleRespuestaPregunta(from, input, _session, context) {
  const startTime = Date.now();

  // 1. Obtener encuesta del cache (query optimizada si no está en cache)
  const encuestaData = await getEncuestaCached(from, context);

  if (!encuestaData) {
    context.log(`No se encontro encuesta activa para ${from}`);
    await whatsapp.sendText(
      from,
      'Hubo un error con la encuesta. Por favor, espera a que te enviemos una nueva invitacion.'
    );
    return;
  }

  const {
    encuestaId,
    preguntaActual: preguntaActualCache,
    numeroPreguntas,
    tienePasoComentario,
    preguntas,
    tipoEncuestaId,
  } = encuestaData;

  context.log(
    `encuestaId: ${encuestaId}, preguntaActualCache: ${preguntaActualCache}, numPreguntas: ${numeroPreguntas}`
  );

  // 2. Extraer calificación
  const respuesta = extraerCalificacion(input);
  if (!respuesta) {
    context.log(`Respuesta invalida detectada: "${input}", enviando mensaje de error`);
    await whatsapp.sendText(from, MSG.RESPUESTA_INVALIDA);
    db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.RESPUESTA_INVALIDA, TIPO_CONTENIDO.TEXTO).catch(
      () => {}
    );
    context.log(`Mensaje de respuesta invalida enviado`);
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
  const estadoActual = await EncuestaRepository.verificarEstadoEncuesta(
    encuestaId,
    numeroPreguntaAResponder
  );

  if (!estadoActual.valido) {
    context.log(
      `Race condition detectada: preguntaActual en BD = ${estadoActual.preguntaActual}, esperada = ${numeroPreguntaAResponder - 1}`
    );
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
    context.log(
      `Respuesta no guardada: alreadyAnswered=${resultado.alreadyAnswered}, success=${resultado.success}`
    );
    return;
  }

  // 6. Actualizar cache local
  updateCachePregunta(from, resultado.nuevaPreguntaActual);

  // 7. Determinar siguiente estado (dinámico)
  const esUltimaPregunta = numeroPreguntaAResponder >= numeroPreguntas;
  const siguienteEstado = esUltimaPregunta
    ? tienePasoComentario
      ? ESTADO.ENCUESTA_COMENTARIO
      : ESTADO.FINALIZADO
    : PREGUNTA_A_ESTADO[numeroPreguntaAResponder + 1] || ESTADO.ENCUESTA_PREGUNTA_1;

  const msgConfirm = MSG.RESPUESTA_REGISTRADA(numeroPreguntaAResponder, numeroPreguntas);

  context.log(
    `Respuesta ${respuesta} guardada para P${numeroPreguntaAResponder}, siguiente: ${siguienteEstado}`
  );

  // 8. Enviar respuesta y actualizar sesión
  if (esUltimaPregunta && tienePasoComentario) {
    // Última pregunta - preguntar por comentario
    await whatsapp.sendText(from, msgConfirm);
    await whatsapp.sendInteractiveMessage(from, MSG.COMENTARIO_TITLE, MSG.PREGUNTA_COMENTARIO, [
      BUTTONS_ENCUESTA.SI_COMENTARIO,
      BUTTONS_ENCUESTA.NO_COMENTARIO,
    ]);

    db.updateSession(
      from,
      siguienteEstado,
      JSON.stringify(encuestaData),
      null,
      ORIGEN_ACCION.USUARIO,
      `P${numeroPreguntaAResponder}: ${respuesta}`
    ).catch(() => {});
    db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.PREGUNTA_COMENTARIO, TIPO_CONTENIDO.TEXTO).catch(
      () => {}
    );
  } else if (esUltimaPregunta && !tienePasoComentario) {
    // Última pregunta sin paso de comentario - finalizar directamente
    await finalizarEncuesta(from, encuestaId, false, null, context);
  } else {
    // Siguiente pregunta (dinámica)
    const siguientePreguntaNum = numeroPreguntaAResponder + 1;
    const siguientePregunta = preguntas?.find((p) => p.NumeroPregunta === siguientePreguntaNum);
    const siguientePreguntaMsg =
      siguientePregunta?.TextoPregunta ||
      PREGUNTA_MENSAJES[siguientePreguntaNum] ||
      `Pregunta ${siguientePreguntaNum}`;
    const mensajePregunta = `${siguientePreguntaMsg}\n\n_Escribe un numero del 1 al 5_`;

    await whatsapp.sendText(from, msgConfirm);
    await whatsapp.sendInteractiveMessage(
      from,
      MSG.PREGUNTA_TITLE(siguientePreguntaNum),
      mensajePregunta,
      [BUTTONS_ENCUESTA.RATING_1, BUTTONS_ENCUESTA.RATING_3, BUTTONS_ENCUESTA.RATING_5]
    );

    db.updateSession(
      from,
      siguienteEstado,
      JSON.stringify(encuestaData),
      null,
      ORIGEN_ACCION.USUARIO,
      `P${numeroPreguntaAResponder}: ${respuesta}`
    ).catch(() => {});
    db.saveMessage(from, TIPO_MENSAJE.BOT, siguientePreguntaMsg, TIPO_CONTENIDO.TEXTO).catch(
      () => {}
    );
  }

  context.log(`handleRespuestaPregunta completado en ${Date.now() - startTime}ms`);
}

/**
 * Maneja la respuesta sobre si quiere dejar comentario
 * @param {string} from - Teléfono del usuario
 * @param {string} input - Input del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
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

  context?.log(
    `[handleComentarioDecision] inputLower: "${inputLower}", quiereComentario: ${quiereComentario}, noQuiereComentario: ${noQuiereComentario}`
  );

  if (quiereComentario) {
    context?.log(`[handleComentarioDecision] Usuario quiere dejar comentario`);
    context?.log(`[handleComentarioDecision] Estado ANTES de updateSession: ${session?.Estado}`);
    await whatsapp.sendText(from, MSG.ESPERA_COMENTARIO);
    context?.log(`[handleComentarioDecision] Actualizando estado a ENCUESTA_ESPERA_COMENTARIO...`);
    await db.updateSession(
      from,
      ESTADO.ENCUESTA_ESPERA_COMENTARIO,
      session.DatosTemp,
      null,
      ORIGEN_ACCION.USUARIO,
      'Quiere comentar'
    );
    context?.log(
      `[handleComentarioDecision] Estado actualizado a ENCUESTA_ESPERA_COMENTARIO exitosamente`
    );
    db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.ESPERA_COMENTARIO, TIPO_CONTENIDO.TEXTO).catch(
      () => {}
    );
  } else if (noQuiereComentario) {
    context?.log(`[handleComentarioDecision] Usuario NO quiere comentario, finalizando`);
    await finalizarEncuesta(from, encuestaId, false, null, context);
  } else {
    // Respuesta no reconocida - reenviar botones con mensaje de ayuda
    context?.log(
      `[handleComentarioDecision] Respuesta no reconocida: "${input}", reenviando botones`
    );
    await whatsapp.sendText(from, 'Por favor selecciona una opción usando los botones:');
    await whatsapp.sendInteractiveMessage(from, MSG.COMENTARIO_TITLE, MSG.SELECCIONA_OPCION, [
      BUTTONS_ENCUESTA.SI_COMENTARIO,
      BUTTONS_ENCUESTA.NO_COMENTARIO,
    ]);
    context?.log(`[handleComentarioDecision] Botones reenviados`);
  }
}

/**
 * Recibe y guarda el comentario del usuario
 * @param {string} from - Teléfono del usuario
 * @param {string} input - Comentario del usuario
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto con función log
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

module.exports = {
  handleInvitacion,
  handleRespuestaPregunta,
  handleComentarioDecision,
  handleComentario,
};
