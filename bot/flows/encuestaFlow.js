/**
 * AC FIXBOT - Flujo de Encuesta (FlowEngine)
 * Flujo auto-contenido con StaticFlowContext
 *
 * Este archivo contiene toda la lógica del flujo de encuesta:
 * - Sistema de cache en memoria
 * - Helpers y mapeos de estados
 * - Acciones del flujo (aceptar, rechazar, finalizar)
 * - Handlers de estado y botones
 *
 * @module bot/flows/encuestaFlow
 */

const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const EncuestaRepository = require('../repositories/EncuestaRepository');
const { ENCUESTA: MSG, BUTTONS_ENCUESTA } = require('../constants/messages');
const { safeParseJSON } = require('../../core/utils/helpers');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../constants/sessionStates');

// ============================================================
// CONSTANTES
// ============================================================

/** TTL del cache de encuestas activas (30 minutos) */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** TTL del cache de preguntas por tipo (1 hora) */
const PREGUNTAS_CACHE_TTL_MS = 60 * 60 * 1000;

// ============================================================
// CACHE EN MEMORIA
// ============================================================

/** Cache de encuestas activas por teléfono */
const encuestaCache = new Map();

/** Cache de preguntas por tipo de encuesta (estático) */
const preguntasCache = new Map();

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
 * Obtiene datos de encuesta del cache o BD
 * @param {string} telefono - Teléfono del usuario
 * @param {Object} context - Contexto con función log
 * @returns {Promise<Object|null>}
 */
async function getEncuestaCached(telefono, context) {
  const cached = encuestaCache.get(telefono);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    context?.log?.(
      `[Cache] encuesta hit: ${cached.encuestaId}, preguntaActual: ${cached.preguntaActual}`
    );
    return cached;
  }

  const encuesta = await EncuestaRepository.getEncuestaCompletaByTelefono(telefono, false);
  if (encuesta) {
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
      timestamp: Date.now(),
    };
    encuestaCache.set(telefono, data);
    context?.log?.(
      `[Cache] encuesta set: ${data.encuestaId}, preguntaActual: ${data.preguntaActual}`
    );
    return data;
  }

  return null;
}

/**
 * Actualiza el cache local con nueva preguntaActual
 * @param {string} telefono - Teléfono del usuario
 * @param {number} nuevaPreguntaActual - Nueva pregunta actual
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
 */
function setEncuestaCache(
  telefono,
  encuestaId,
  reporteId,
  numeroTicket,
  tipoEncuesta = null,
  preguntas = []
) {
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
    timestamp: Date.now(),
  });
}

/**
 * Limpia cache para un teléfono
 * @param {string} telefono - Teléfono del usuario
 */
function clearEncuestaCache(telefono) {
  encuestaCache.delete(telefono);
}

/**
 * Obtiene el cache raw de encuesta (acceso directo sin async)
 * @param {string} telefono - Teléfono del usuario
 * @returns {Object|undefined}
 */
function getEncuestaCacheRaw(telefono) {
  return encuestaCache.get(telefono);
}

// Limpieza periódica del cache (cada 10 minutos)
setInterval(
  () => {
    const now = Date.now();
    for (const [telefono, data] of encuestaCache.entries()) {
      if (now - data.timestamp > CACHE_TTL_MS) {
        encuestaCache.delete(telefono);
      }
    }
  },
  10 * 60 * 1000
).unref();

// ============================================================
// HELPERS
// ============================================================

/** Mapeo de número de pregunta a estado de sesión */
const PREGUNTA_A_ESTADO = {
  1: ESTADO.ENCUESTA_PREGUNTA_1,
  2: ESTADO.ENCUESTA_PREGUNTA_2,
  3: ESTADO.ENCUESTA_PREGUNTA_3,
  4: ESTADO.ENCUESTA_PREGUNTA_4,
  5: ESTADO.ENCUESTA_PREGUNTA_5,
  6: ESTADO.ENCUESTA_PREGUNTA_6,
};

/** Mensajes de preguntas de fallback */
const PREGUNTA_MENSAJES = {
  1: MSG.PREGUNTA_1,
  2: MSG.PREGUNTA_2,
  3: MSG.PREGUNTA_3,
  4: MSG.PREGUNTA_4,
  5: MSG.PREGUNTA_5,
  6: MSG.PREGUNTA_6,
};

/**
 * Extrae calificación numérica del input
 * @param {string} input - Input del usuario
 * @returns {number|null} - Calificación del 1 al 5 o null
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
    pesimo: 1,
    'muy malo': 1,
    terrible: 1,
    malo: 2,
    mal: 2,
    regular: 3,
    normal: 3,
    ok: 3,
    bueno: 4,
    bien: 4,
    excelente: 5,
    'muy bueno': 5,
    perfecto: 5,
  };

  return palabras[input.toLowerCase().trim()] || null;
}

// ============================================================
// ACCIONES DEL FLUJO
// ============================================================

/**
 * Inicia el flujo de encuesta (llamado desde el timer)
 * @param {string} telefono - Teléfono del usuario
 * @param {Object} reporte - Datos del reporte
 * @param {number} encuestaId - ID de la encuesta
 * @param {Object} tipoEncuesta - Datos del tipo de encuesta
 * @param {Array} preguntas - Preguntas de la encuesta
 */
async function iniciarEncuesta(telefono, reporte, encuestaId, tipoEncuesta = null, preguntas = []) {
  try {
    logger.info(`Iniciando encuesta para ${telefono}, ticket: ${reporte.NumeroTicket}`);

    setEncuestaCache(
      telefono,
      encuestaId,
      reporte.ReporteId,
      reporte.NumeroTicket,
      tipoEncuesta,
      preguntas
    );

    const datosTemp = JSON.stringify({
      encuestaId,
      reporteId: reporte.ReporteId,
      numeroTicket: reporte.NumeroTicket,
      tipoEncuestaId: tipoEncuesta?.TipoEncuestaId || null,
      numeroPreguntas: tipoEncuesta?.NumeroPreguntas || 6,
    });

    const msgInvitacion = MSG.invitacion(reporte.NombreCliente, reporte.NumeroTicket);
    await whatsapp.sendInteractiveMessage(telefono, MSG.INVITACION_TITLE, msgInvitacion, [
      BUTTONS_ENCUESTA.ACEPTAR,
      BUTTONS_ENCUESTA.SALIR,
    ]);

    await Promise.allSettled([
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

    return true;
  } catch (error) {
    logger.error('Error iniciando encuesta', error, { telefono });
    return false;
  }
}

/**
 * Usuario acepta la encuesta
 */
async function aceptarEncuesta(from, encuestaId, datosTemp, context) {
  context?.log?.(`aceptarEncuesta - encuestaId: ${encuestaId}`);

  const encuestaData = await getEncuestaCached(from, context);
  const preguntas = encuestaData?.preguntas || [];
  const numeroPreguntas = encuestaData?.numeroPreguntas || 6;

  const datosTempActualizado = {
    ...datosTemp,
    encuestaId,
    tipoEncuestaId: encuestaData?.tipoEncuestaId,
    numeroPreguntas,
  };

  await Promise.allSettled([
    EncuestaRepository.updateEstado(encuestaId, 'EN_PROCESO'),
    db.updateSession(
      from,
      ESTADO.ENCUESTA_PREGUNTA_1,
      JSON.stringify(datosTempActualizado),
      null,
      ORIGEN_ACCION.USUARIO,
      'Encuesta aceptada'
    ),
  ]);

  updateCachePregunta(from, 0);

  await whatsapp.sendText(from, MSG.INSTRUCCIONES);

  const primeraPregunta = preguntas.find((p) => p.NumeroPregunta === 1);
  const textoPregunta = primeraPregunta?.TextoPregunta || MSG.PREGUNTA_1;
  const mensajePregunta = `${textoPregunta}\n\n_Escribe un numero del 1 al 5_`;

  await whatsapp.sendInteractiveMessage(from, MSG.PREGUNTA_TITLE(1), mensajePregunta, [
    BUTTONS_ENCUESTA.RATING_1,
    BUTTONS_ENCUESTA.RATING_3,
    BUTTONS_ENCUESTA.RATING_5,
  ]);

  db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.INSTRUCCIONES, TIPO_CONTENIDO.TEXTO).catch(() => {});
  db.saveMessage(from, TIPO_MENSAJE.BOT, textoPregunta, TIPO_CONTENIDO.TEXTO).catch(() => {});
}

/**
 * Usuario rechaza la encuesta
 */
async function rechazarEncuesta(from, encuestaId, _context) {
  await whatsapp.sendText(from, MSG.ENCUESTA_RECHAZADA);

  await Promise.allSettled([
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

  clearEncuestaCache(from);
  db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.ENCUESTA_RECHAZADA, TIPO_CONTENIDO.TEXTO).catch(
    () => {}
  );
}

/**
 * Finaliza la encuesta
 */
async function finalizarEncuesta(from, encuestaId, conComentario, comentario, _context) {
  const encuestaData = getEncuestaCacheRaw(from);
  const mensajePersonalizado = encuestaData?.mensajeAgradecimiento;

  let msgAgradecimiento;
  if (mensajePersonalizado) {
    msgAgradecimiento = mensajePersonalizado;
  } else {
    msgAgradecimiento = conComentario ? MSG.AGRADECIMIENTO_CON_COMENTARIO : MSG.AGRADECIMIENTO;
  }

  await whatsapp.sendText(from, msgAgradecimiento);

  const updateSessionPromise = db.updateSession(
    from,
    ESTADO.FINALIZADO,
    null,
    null,
    ORIGEN_ACCION.BOT,
    'Encuesta completada'
  );
  const encuestaPromise = conComentario
    ? EncuestaRepository.guardarComentario(encuestaId, comentario)
    : EncuestaRepository.finalizarSinComentario(encuestaId);

  await Promise.allSettled([updateSessionPromise, encuestaPromise]);
  clearEncuestaCache(from);
  db.saveMessage(from, TIPO_MENSAJE.BOT, msgAgradecimiento, TIPO_CONTENIDO.TEXTO).catch(() => {});

  logger.info(`Encuesta ${encuestaId} completada`, { telefono: from, conComentario });
}

// ============================================================
// DEFINICIÓN DEL FLUJO
// ============================================================

const encuestaFlow = {
  nombre: 'ENCUESTA',

  estados: [
    ESTADO.ENCUESTA_INVITACION,
    ESTADO.ENCUESTA_PREGUNTA_1,
    ESTADO.ENCUESTA_PREGUNTA_2,
    ESTADO.ENCUESTA_PREGUNTA_3,
    ESTADO.ENCUESTA_PREGUNTA_4,
    ESTADO.ENCUESTA_PREGUNTA_5,
    ESTADO.ENCUESTA_COMENTARIO,
    ESTADO.ENCUESTA_ESPERA_COMENTARIO,
  ],

  handlers: {
    [ESTADO.ENCUESTA_INVITACION]: 'handleInvitacion',
    [ESTADO.ENCUESTA_PREGUNTA_1]: 'handleRespuestaPregunta',
    [ESTADO.ENCUESTA_PREGUNTA_2]: 'handleRespuestaPregunta',
    [ESTADO.ENCUESTA_PREGUNTA_3]: 'handleRespuestaPregunta',
    [ESTADO.ENCUESTA_PREGUNTA_4]: 'handleRespuestaPregunta',
    [ESTADO.ENCUESTA_PREGUNTA_5]: 'handleRespuestaPregunta',
    [ESTADO.ENCUESTA_COMENTARIO]: 'handleComentarioDecision',
    [ESTADO.ENCUESTA_ESPERA_COMENTARIO]: 'handleComentario',
  },

  botones: {
    btn_encuesta_aceptar: 'handleBotonAceptar',
    btn_encuesta_salir: 'handleBotonSalir',
    btn_rating_1: { handler: 'handleBotonRating', params: 1 },
    btn_rating_2: { handler: 'handleBotonRating', params: 2 },
    btn_rating_3: { handler: 'handleBotonRating', params: 3 },
    btn_rating_4: { handler: 'handleBotonRating', params: 4 },
    btn_rating_5: { handler: 'handleBotonRating', params: 5 },
    btn_si_comentario: 'handleBotonSiComentario',
    btn_no_comentario: 'handleBotonNoComentario',
  },

  // ==============================================================
  // HANDLERS DE ESTADO
  // ==============================================================

  /**
   * Maneja respuesta a invitación
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} mensaje
   */
  async handleInvitacion(ctx, mensaje) {
    ctx.log(`Procesando respuesta a invitación: "${mensaje}"`);

    let datosTemp = safeParseJSON(ctx.session.DatosTemp) || {};
    let encuestaId = datosTemp?.encuestaId;

    if (!encuestaId) {
      const cached = await getEncuestaCached(ctx.from, ctx.context);
      if (cached) {
        encuestaId = cached.encuestaId;
        datosTemp = { ...datosTemp, ...cached };
      }
    }

    if (!encuestaId) {
      ctx.log('Error: encuestaId no encontrada');
      await ctx.responder('Hubo un error. Intenta de nuevo mas tarde.');
      return;
    }

    const inputLower = mensaje.toLowerCase().trim();
    const esAceptar = inputLower === 'aceptar' || inputLower === 'si' || inputLower === 'sí';
    const esRechazar = inputLower === 'salir' || inputLower === 'no';

    if (esAceptar) {
      await aceptarEncuesta(ctx.from, encuestaId, datosTemp, ctx.context);
    } else if (esRechazar) {
      await rechazarEncuesta(ctx.from, encuestaId, ctx.context);
    } else {
      await whatsapp.sendInteractiveMessage(ctx.from, MSG.INVITACION_TITLE, MSG.SELECCIONA_OPCION, [
        BUTTONS_ENCUESTA.ACEPTAR,
        BUTTONS_ENCUESTA.SALIR,
      ]);
    }
  },

  /**
   * Procesa respuesta a pregunta de calificación
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} mensaje
   */
  async handleRespuestaPregunta(ctx, mensaje) {
    const startTime = Date.now();
    ctx.log(`Procesando respuesta a pregunta: "${mensaje}"`);

    const encuestaData = await getEncuestaCached(ctx.from, ctx.context);

    if (!encuestaData) {
      ctx.log(`No se encontro encuesta activa para ${ctx.from}`);
      await ctx.responder(
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

    ctx.log(
      `encuestaId: ${encuestaId}, preguntaActualCache: ${preguntaActualCache}, numPreguntas: ${numeroPreguntas}`
    );

    const respuesta = extraerCalificacion(mensaje);
    if (!respuesta) {
      ctx.log(`Respuesta invalida detectada: "${mensaje}"`);
      await ctx.responder(MSG.RESPUESTA_INVALIDA);
      return;
    }

    const numeroPreguntaAResponder = preguntaActualCache + 1;
    ctx.log(`Procesando pregunta: ${numeroPreguntaAResponder}`);

    if (numeroPreguntaAResponder < 1 || numeroPreguntaAResponder > numeroPreguntas) {
      ctx.log(`Encuesta ya completada (pregunta ${numeroPreguntaAResponder})`);
      await ctx.responder('Esta encuesta ya fue completada. ¡Gracias!');
      return;
    }

    const estadoActual = await EncuestaRepository.verificarEstadoEncuesta(
      encuestaId,
      numeroPreguntaAResponder
    );

    if (!estadoActual.valido) {
      ctx.log(`Race condition detectada: preguntaActual en BD = ${estadoActual.preguntaActual}`);
      return;
    }

    const resultado = await EncuestaRepository.guardarRespuestaAtomica(
      encuestaId,
      numeroPreguntaAResponder,
      respuesta,
      tipoEncuestaId
    );

    if (resultado.alreadyAnswered || !resultado.success) {
      ctx.log(`Respuesta no guardada: alreadyAnswered=${resultado.alreadyAnswered}`);
      return;
    }

    updateCachePregunta(ctx.from, resultado.nuevaPreguntaActual);

    const esUltimaPregunta = numeroPreguntaAResponder >= numeroPreguntas;
    const siguienteEstado = esUltimaPregunta
      ? tienePasoComentario
        ? ESTADO.ENCUESTA_COMENTARIO
        : ESTADO.FINALIZADO
      : PREGUNTA_A_ESTADO[numeroPreguntaAResponder + 1] || ESTADO.ENCUESTA_PREGUNTA_1;

    const msgConfirm = MSG.RESPUESTA_REGISTRADA(numeroPreguntaAResponder, numeroPreguntas);

    ctx.log(
      `Respuesta ${respuesta} guardada para P${numeroPreguntaAResponder}, siguiente: ${siguienteEstado}`
    );

    if (esUltimaPregunta && tienePasoComentario) {
      await whatsapp.sendText(ctx.from, msgConfirm);
      await whatsapp.sendInteractiveMessage(
        ctx.from,
        MSG.COMENTARIO_TITLE,
        MSG.PREGUNTA_COMENTARIO,
        [BUTTONS_ENCUESTA.SI_COMENTARIO, BUTTONS_ENCUESTA.NO_COMENTARIO]
      );

      db.updateSession(
        ctx.from,
        siguienteEstado,
        JSON.stringify(encuestaData),
        null,
        ORIGEN_ACCION.USUARIO,
        `P${numeroPreguntaAResponder}: ${respuesta}`
      ).catch(() => {});
      db.saveMessage(
        ctx.from,
        TIPO_MENSAJE.BOT,
        MSG.PREGUNTA_COMENTARIO,
        TIPO_CONTENIDO.TEXTO
      ).catch(() => {});
    } else if (esUltimaPregunta && !tienePasoComentario) {
      await finalizarEncuesta(ctx.from, encuestaId, false, null, ctx.context);
    } else {
      const siguientePreguntaNum = numeroPreguntaAResponder + 1;
      const siguientePregunta = preguntas?.find((p) => p.NumeroPregunta === siguientePreguntaNum);
      const siguientePreguntaMsg =
        siguientePregunta?.TextoPregunta ||
        PREGUNTA_MENSAJES[siguientePreguntaNum] ||
        `Pregunta ${siguientePreguntaNum}`;
      const mensajePregunta = `${siguientePreguntaMsg}\n\n_Escribe un numero del 1 al 5_`;

      await whatsapp.sendText(ctx.from, msgConfirm);
      await whatsapp.sendInteractiveMessage(
        ctx.from,
        MSG.PREGUNTA_TITLE(siguientePreguntaNum),
        mensajePregunta,
        [BUTTONS_ENCUESTA.RATING_1, BUTTONS_ENCUESTA.RATING_3, BUTTONS_ENCUESTA.RATING_5]
      );

      db.updateSession(
        ctx.from,
        siguienteEstado,
        JSON.stringify(encuestaData),
        null,
        ORIGEN_ACCION.USUARIO,
        `P${numeroPreguntaAResponder}: ${respuesta}`
      ).catch(() => {});
      db.saveMessage(ctx.from, TIPO_MENSAJE.BOT, siguientePreguntaMsg, TIPO_CONTENIDO.TEXTO).catch(
        () => {}
      );
    }

    ctx.log(`handleRespuestaPregunta completado en ${Date.now() - startTime}ms`);
  },

  /**
   * Maneja decisión sobre comentario
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} mensaje
   */
  async handleComentarioDecision(ctx, mensaje) {
    ctx.log(`Procesando decisión de comentario: "${mensaje}"`);

    let encuestaId = safeParseJSON(ctx.session.DatosTemp)?.encuestaId;

    if (!encuestaId) {
      const cached = await getEncuestaCached(ctx.from, ctx.context);
      if (cached) {
        encuestaId = cached.encuestaId;
      }
    }

    const inputLower = mensaje.toLowerCase().trim();
    const quiereComentario = inputLower === 'si' || inputLower === 'sí';
    const noQuiereComentario = inputLower === 'no';

    if (quiereComentario) {
      ctx.log('Usuario quiere dejar comentario');
      await ctx.responder(MSG.ESPERA_COMENTARIO);
      await ctx.cambiarEstado(ESTADO.ENCUESTA_ESPERA_COMENTARIO, 'Quiere comentar');
    } else if (noQuiereComentario) {
      ctx.log('Usuario NO quiere comentario, finalizando');
      await finalizarEncuesta(ctx.from, encuestaId, false, null, ctx.context);
    } else {
      ctx.log(`Respuesta no reconocida: "${mensaje}", reenviando botones`);
      await ctx.responder('Por favor selecciona una opción usando los botones:');
      await whatsapp.sendInteractiveMessage(ctx.from, MSG.COMENTARIO_TITLE, MSG.SELECCIONA_OPCION, [
        BUTTONS_ENCUESTA.SI_COMENTARIO,
        BUTTONS_ENCUESTA.NO_COMENTARIO,
      ]);
    }
  },

  /**
   * Recibe y guarda comentario
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} mensaje
   */
  async handleComentario(ctx, mensaje) {
    ctx.log('Guardando comentario del usuario');

    let encuestaId = safeParseJSON(ctx.session.DatosTemp)?.encuestaId;

    if (!encuestaId) {
      const cached = await getEncuestaCached(ctx.from, ctx.context);
      if (cached) {
        encuestaId = cached.encuestaId;
      } else {
        ctx.log('Error: encuestaId no encontrada para comentario');
        await ctx.responder('Hubo un error guardando tu comentario.');
        return;
      }
    }

    await finalizarEncuesta(ctx.from, encuestaId, true, mensaje, ctx.context);
  },

  // ==============================================================
  // HANDLERS DE BOTONES
  // ==============================================================

  /**
   * Botón aceptar encuesta
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   */
  async handleBotonAceptar(ctx) {
    ctx.log('Usuario aceptó encuesta via botón');

    const datosTemp = safeParseJSON(ctx.session.DatosTemp);
    let encuestaId = datosTemp?.encuestaId;

    if (!encuestaId) {
      const cached = await getEncuestaCached(ctx.from, ctx.context);
      if (cached) {
        encuestaId = cached.encuestaId;
      }
    }

    await aceptarEncuesta(ctx.from, encuestaId, datosTemp || {}, ctx.context);
  },

  /**
   * Botón salir de encuesta
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   */
  async handleBotonSalir(ctx) {
    ctx.log('Usuario rechazó encuesta via botón');

    const datosTemp = safeParseJSON(ctx.session.DatosTemp);
    let encuestaId = datosTemp?.encuestaId;

    if (!encuestaId) {
      const cached = await getEncuestaCached(ctx.from, ctx.context);
      if (cached) {
        encuestaId = cached.encuestaId;
      }
    }

    await rechazarEncuesta(ctx.from, encuestaId, ctx.context);
  },

  /**
   * Botón de rating (1-5)
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {number} rating - Valor del rating (1-5)
   */
  async handleBotonRating(ctx, rating) {
    ctx.log(`Usuario seleccionó rating ${rating} via botón`);
    await this.handleRespuestaPregunta(ctx, `btn_rating_${rating}`);
  },

  /**
   * Botón sí quiero comentar
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   */
  async handleBotonSiComentario(ctx) {
    ctx.log('Usuario quiere dejar comentario via botón');
    await this.handleComentarioDecision(ctx, 'si');
  },

  /**
   * Botón no quiero comentar
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   */
  async handleBotonNoComentario(ctx) {
    ctx.log('Usuario no quiere comentar via botón');
    await this.handleComentarioDecision(ctx, 'no');
  },
};

// Exportar también las funciones públicas para uso externo (timer de encuestas)
module.exports = encuestaFlow;
module.exports.iniciarEncuesta = iniciarEncuesta;
module.exports.setEncuestaCache = setEncuestaCache;
module.exports.clearEncuestaCache = clearEncuestaCache;
