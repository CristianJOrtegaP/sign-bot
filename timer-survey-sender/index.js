/**
 * AC FIXBOT - Azure Function Timer Trigger para Encuestas
 * Envia encuestas de satisfaccion a clientes con tickets resueltos
 *
 * Schedule: Configurable via SURVEY_TIMER_SCHEDULE (default: 9:00 AM diario)
 */

const EncuestaRepository = require('../bot/repositories/EncuestaRepository');
const SesionRepository = require('../bot/repositories/SesionRepository');
const encuestaFlow = require('../bot/flows/encuestaFlow');
const { logger } = require('../core/services/infrastructure/errorHandler');
const { sleep } = require('../core/utils/promises');
const appInsights = require('../core/services/infrastructure/appInsightsService');

const ESTADOS_TERMINALES = ['INICIO', 'CANCELADO', 'FINALIZADO', 'TIMEOUT'];

// Configuracion por defecto
const DEFAULT_MINUTOS_ESPERA = 1440; // Esperar 1440 minutos (24 horas) desde resolucion
const MAX_ENCUESTAS_POR_EJECUCION = 50; // Limitar para no saturar
const PAUSA_ENTRE_ENVIOS_MS = 1000; // 1 segundo entre envios
const DEFAULT_HORA_INICIO_ENVIO = 8; // No enviar antes de las 8 AM
const DEFAULT_HORA_FIN_ENVIO = 20; // No enviar despues de las 8 PM
const DEFAULT_TIMEZONE_OFFSET = -6; // UTC-6 (Mexico Centro)

module.exports = async function (context, myTimer) {
  const timestamp = new Date().toISOString();

  if (myTimer.isPastDue) {
    context.log('Survey trigger ejecutado con retraso');
  }

  context.log('============================================================');
  context.log('SURVEY TRIGGER - Envio de encuestas de satisfaccion');
  context.log('============================================================');
  context.log('Inicio:', timestamp);

  // Validar ventana horaria para no enviar en horarios inadecuados
  const tzOffset = parseInt(process.env.TIMEZONE_OFFSET_HOURS || DEFAULT_TIMEZONE_OFFSET, 10);
  const horaLocal = (((new Date().getUTCHours() + tzOffset) % 24) + 24) % 24;
  const horaInicio = parseInt(process.env.SURVEY_HORA_INICIO || DEFAULT_HORA_INICIO_ENVIO, 10);
  const horaFin = parseInt(process.env.SURVEY_HORA_FIN || DEFAULT_HORA_FIN_ENVIO, 10);

  if (horaLocal < horaInicio || horaLocal >= horaFin) {
    context.log(
      `Fuera de ventana de envio (${horaInicio}:00 - ${horaFin}:00). Hora local: ${horaLocal}:00. Saltando.`
    );
    return;
  }

  const stats = {
    reportesPendientes: 0,
    encuestasEnviadas: 0,
    omitidas: 0,
    errores: 0,
    duracionMs: 0,
  };

  const startTime = Date.now();

  try {
    // Obtener configuracion
    const minutosEspera = parseInt(process.env.SURVEY_MINUTOS_ESPERA || DEFAULT_MINUTOS_ESPERA, 10);
    context.log(`Buscando reportes resueltos hace mas de ${minutosEspera} minutos...`);

    // Obtener reportes pendientes de encuesta
    const reportesPendientes =
      await EncuestaRepository.getReportesPendientesEncuesta(minutosEspera);

    stats.reportesPendientes = reportesPendientes.length;
    context.log(`Encontrados ${stats.reportesPendientes} reportes pendientes de encuesta`);

    if (reportesPendientes.length === 0) {
      context.log('No hay encuestas pendientes de enviar');
      stats.duracionMs = Date.now() - startTime;
      logResumen(context, timestamp, stats);
      return;
    }

    // Limitar cantidad de encuestas por ejecucion
    const reportesAProcesar = reportesPendientes.slice(0, MAX_ENCUESTAS_POR_EJECUCION);
    context.log(
      `Procesando ${reportesAProcesar.length} encuestas (max: ${MAX_ENCUESTAS_POR_EJECUCION})`
    );

    // Procesar cada reporte
    for (const reporte of reportesAProcesar) {
      try {
        // Segunda capa de defensa: verificar que el usuario no tenga sesion activa
        try {
          const sesion = await SesionRepository.getSession(reporte.TelefonoReportante, true);
          if (sesion && !ESTADOS_TERMINALES.includes(sesion.Estado)) {
            stats.omitidas++;
            context.log(
              `   Sesion activa (${sesion.Estado}) para ${reporte.TelefonoReportante}, posponiendo encuesta`
            );
            continue;
          }
        } catch (_sesionError) {
          // Si falla la verificacion de sesion, continuar con el envio (el SP ya filtro)
          logger.warn('Error verificando sesion activa, continuando', {
            telefono: reporte.TelefonoReportante,
          });
        }

        context.log(
          `Enviando encuesta para ticket: ${reporte.NumeroTicket} -> ${reporte.TelefonoReportante}`
        );

        // Crear registro de encuesta en BD (retorna objeto con encuestaId, tipoEncuesta, preguntas)
        // Retorna null si ya existe encuesta para este reporte
        const resultado = await EncuestaRepository.create(
          reporte.ReporteId,
          reporte.TelefonoReportante
        );

        // Si ya existe encuesta para este reporte, saltar
        if (!resultado) {
          context.log(`   Encuesta ya existe para ticket: ${reporte.NumeroTicket}, saltando...`);
          continue;
        }

        const { encuestaId, tipoEncuesta, preguntas } = resultado;

        // Iniciar flujo de encuesta (enviar WhatsApp) con datos del tipo de encuesta
        const enviado = await encuestaFlow.iniciarEncuesta(
          reporte.TelefonoReportante,
          reporte,
          encuestaId,
          tipoEncuesta,
          preguntas
        );

        if (enviado) {
          stats.encuestasEnviadas++;
          context.log(
            `   Encuesta ${encuestaId} enviada: ${reporte.NumeroTicket} (tipo: ${tipoEncuesta?.Codigo || 'default'})`
          );
        } else {
          stats.errores++;
          context.log(`   No se pudo enviar encuesta: ${reporte.NumeroTicket}`);
          // Marcar como fallida para no reintentar indefinidamente
          await EncuestaRepository.updateEstado(encuestaId, 'EXPIRADA');
        }

        // Pausa entre envios para no saturar WhatsApp
        await sleep(PAUSA_ENTRE_ENVIOS_MS);
      } catch (error) {
        stats.errores++;
        context.log(`   Error procesando encuesta para ${reporte.NumeroTicket}:`, error.message);
        logger.error('Error en surveyTrigger procesando reporte', error, {
          numeroTicket: reporte.NumeroTicket,
        });
      }
    }

    // Expirar encuestas antiguas sin respuesta
    try {
      const horasExpiracion = parseInt(process.env.SURVEY_HORAS_EXPIRACION || '72', 10);
      const expiradas = await EncuestaRepository.expirarSinRespuesta(horasExpiracion);
      if (expiradas > 0) {
        context.log(`${expiradas} encuestas expiradas por inactividad`);
      }
    } catch (error) {
      context.log('Error expirando encuestas antiguas:', error.message);
    }

    stats.duracionMs = Date.now() - startTime;
    logResumen(context, timestamp, stats);
  } catch (error) {
    context.log('Error critico en surveyTrigger:', error);
    logger.error('Error critico en surveyTrigger', error);

    stats.duracionMs = Date.now() - startTime;
    stats.errores++;
    logResumen(context, timestamp, stats);
  }

  // Flush AppInsights antes de que termine la function
  await appInsights.flush();
  context.log('Survey trigger completado:', new Date().toISOString());
};

/**
 * Muestra resumen de la ejecucion
 */
function logResumen(context, timestamp, stats) {
  context.log('');
  context.log('============================================================');
  context.log('RESUMEN DE EJECUCION');
  context.log('============================================================');
  context.log('Timestamp:            ', timestamp);
  context.log('Reportes pendientes:  ', stats.reportesPendientes);
  context.log('Encuestas enviadas:   ', stats.encuestasEnviadas);
  context.log('Omitidas (sesion):    ', stats.omitidas);
  context.log('Errores:              ', stats.errores);
  context.log('Duracion:             ', stats.duracionMs, 'ms');
  context.log('============================================================');
}
