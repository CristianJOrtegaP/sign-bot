/**
 * Sign Bot - Servicio de Gestión de Timeout de Sesiones
 * Detecta y cierra sesiones inactivas, notificando al usuario
 *
 * Flujo con advertencia previa:
 * 1. Sesión inactiva >= WARNING_MINUTES → Enviar "¿Sigues ahí?" → AdvertenciaEnviada = 1
 * 2. Usuario responde → Se resetea AdvertenciaEnviada = 0 automáticamente
 * 3. Sesión inactiva >= TIMEOUT_MINUTES Y AdvertenciaEnviada = 1 → Cerrar sesión
 */

const sql = require('mssql');
const whatsappService = require('../external/whatsappService');
const config = require('../../config');
const { getPool } = require('../storage/connectionPool');
const { logger } = require('../infrastructure/errorHandler');

/**
 * Obtiene el timeout configurado en minutos (desde config centralizado)
 * @returns {number} - Timeout en minutos
 */
function getTimeoutMinutes() {
  return config.sessionTimeoutMinutes || 30;
}

/**
 * Obtiene el tiempo de advertencia configurado en minutos
 * @returns {number} - Tiempo en minutos antes del timeout para enviar advertencia
 */
function getWarningMinutes() {
  return config.session?.warningMinutes || 25;
}

/**
 * Busca sesiones que necesitan advertencia (inactivas pero sin advertencia enviada)
 * @returns {Array} - Lista de sesiones que necesitan advertencia
 */
async function findSessionsNeedingWarning() {
  try {
    const p = await getPool();
    const warningMinutes = getWarningMinutes();

    const result = await p.request().input('warningMinutes', sql.Int, warningMinutes).query(`
                SELECT
                    s.SesionId,
                    s.Telefono,
                    e.Codigo AS Estado,
                    s.DatosTemp,
                    s.UltimaActividad,
                    DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
                FROM SesionesChat s
                INNER JOIN CatEstadoSesion e ON s.EstadoId = e.EstadoId
                WHERE
                    e.EsTerminal = 0
                    AND (s.AdvertenciaEnviada = 0 OR s.AdvertenciaEnviada IS NULL)
                    AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @warningMinutes
            `);

    return result.recordset;
  } catch (error) {
    logger.error('Error buscando sesiones para advertencia', error, {
      operation: 'findSessionsNeedingWarning',
    });
    return [];
  }
}

/**
 * Busca sesiones que han expirado por inactividad (ya con advertencia enviada)
 * @returns {Array} - Lista de sesiones expiradas
 */
async function findExpiredSessions() {
  try {
    const p = await getPool();
    const timeoutMinutes = getTimeoutMinutes();

    const result = await p.request().input('timeoutMinutes', sql.Int, timeoutMinutes).query(`
                SELECT
                    s.SesionId,
                    s.Telefono,
                    e.Codigo AS Estado,
                    s.DatosTemp,
                    s.UltimaActividad,
                    DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
                FROM SesionesChat s
                INNER JOIN CatEstadoSesion e ON s.EstadoId = e.EstadoId
                WHERE
                    e.EsTerminal = 0
                    AND s.AdvertenciaEnviada = 1
                    AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @timeoutMinutes
            `);

    return result.recordset;
  } catch (error) {
    logger.error('Error buscando sesiones expiradas', error, { operation: 'findExpiredSessions' });
    return [];
  }
}

/**
 * Marca que se envió advertencia a una sesión
 * @param {string} telefono - Teléfono de la sesión
 * @returns {boolean} - true si se actualizó correctamente
 */
async function markWarningSent(telefono) {
  try {
    const p = await getPool();

    await p.request().input('telefono', sql.NVarChar, telefono).query(`
                UPDATE SesionesChat
                SET
                    AdvertenciaEnviada = 1,
                    FechaAdvertencia = GETDATE()
                WHERE Telefono = @telefono
            `);

    logger.info(`Advertencia marcada como enviada`, { telefono });
    return true;
  } catch (error) {
    logger.error('Error marcando advertencia enviada', error, {
      telefono,
      operation: 'markWarningSent',
    });
    return false;
  }
}

/**
 * Resetea la advertencia de una sesión (cuando el usuario responde)
 * @param {string} telefono - Teléfono de la sesión
 * @returns {boolean} - true si se actualizó correctamente
 */
async function resetWarning(telefono) {
  try {
    const p = await getPool();

    await p.request().input('telefono', sql.NVarChar, telefono).query(`
                UPDATE SesionesChat
                SET
                    AdvertenciaEnviada = 0,
                    FechaAdvertencia = NULL
                WHERE Telefono = @telefono
            `);

    logger.debug(`Advertencia reseteada`, { telefono });
    return true;
  } catch (error) {
    logger.error('Error reseteando advertencia', error, { telefono, operation: 'resetWarning' });
    return false;
  }
}

/**
 * Cierra una sesión por timeout y resetea su estado
 * @param {string} telefono - Teléfono de la sesión
 * @returns {boolean} - true si se cerró correctamente
 */
async function closeSessionByTimeout(telefono) {
  try {
    const p = await getPool();

    await p.request().input('telefono', sql.NVarChar, telefono).query(`
                UPDATE SesionesChat
                SET
                    EstadoId = (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = 'INICIO'),
                    TipoReporteId = NULL,
                    DatosTemp = NULL,
                    EquipoIdTemp = NULL,
                    AdvertenciaEnviada = 0,
                    FechaAdvertencia = NULL,
                    UltimaActividad = GETDATE()
                WHERE Telefono = @telefono
            `);

    logger.info(`Sesión cerrada por timeout`, { telefono });
    return true;
  } catch (error) {
    logger.error('Error cerrando sesión por timeout', error, {
      telefono,
      operation: 'closeSessionByTimeout',
    });
    return false;
  }
}

/**
 * Envía advertencia de inactividad al usuario
 * @param {string} telefono - Teléfono del usuario
 * @param {number} minutosInactivo - Minutos de inactividad
 */
async function sendWarningMessage(telefono, minutosInactivo) {
  try {
    const timeoutMinutes = getTimeoutMinutes();
    const minutosRestantes = timeoutMinutes - minutosInactivo;

    logger.info(`Enviando advertencia de inactividad`, {
      telefono,
      minutosInactivo,
      minutosRestantes,
    });

    const mensaje = `⚠️ *¿Sigues ahí?*

Detectamos que llevas *${minutosInactivo} minutos* sin actividad.

Tu sesión se cerrará automáticamente en *${minutosRestantes > 0 ? minutosRestantes : 5} minutos* si no respondes.

_Envía cualquier mensaje para continuar._`;

    const result = await whatsappService.sendText(telefono, mensaje);
    logger.whatsapp('Advertencia de inactividad enviada', true, {
      telefono,
      messageId: result?.messages?.[0]?.id,
    });

    return true;
  } catch (error) {
    logger.error('Error enviando advertencia de inactividad', error, {
      telefono,
      operation: 'sendWarningMessage',
      errorMessage: error.message,
    });
    throw error;
  }
}

/**
 * Notifica al usuario que su sesión expiró por inactividad
 * @param {string} telefono - Teléfono del usuario
 * @param {number} minutosInactivo - Minutos de inactividad
 */
async function notifySessionTimeout(telefono, minutosInactivo) {
  try {
    const timeoutMinutes = getTimeoutMinutes();

    logger.info(`Intentando enviar notificación de timeout`, { telefono, minutosInactivo });

    const mensaje = `⏱️ *Sesión Cerrada por Inactividad*

Tu sesión fue cerrada automáticamente después de *${timeoutMinutes} minutos* de inactividad.

Si necesitas reportar una falla, envía un mensaje para iniciar de nuevo.`;

    const result = await whatsappService.sendText(telefono, mensaje);
    logger.whatsapp('Notificación de timeout enviada', true, {
      telefono,
      messageId: result?.messages?.[0]?.id,
    });
  } catch (error) {
    logger.error('Error enviando notificación de timeout', error, {
      telefono,
      operation: 'notifySessionTimeout',
      errorMessage: error.message,
      errorStack: error.stack,
    });
    throw error;
  }
}

/**
 * Procesa todas las sesiones: envía advertencias y cierra las expiradas
 * @returns {Object} - Estadísticas del procesamiento
 */
async function processExpiredSessions() {
  const startTime = Date.now();
  const stats = {
    advertenciasEnviadas: 0,
    sesionesCerradas: 0,
    notificacionesEnviadas: 0,
    errores: 0,
    duracionMs: 0,
  };

  try {
    logger.info('Iniciando procesamiento de sesiones inactivas...');

    // PASO 1: Enviar advertencias a sesiones que están por expirar
    const sessionsNeedingWarning = await findSessionsNeedingWarning();

    if (sessionsNeedingWarning.length > 0) {
      logger.info(
        `Encontradas ${sessionsNeedingWarning.length} sesiones que necesitan advertencia`
      );

      const warningPromises = sessionsNeedingWarning.map(async (session) => {
        const { Telefono, MinutosInactivo } = session;

        try {
          await sendWarningMessage(Telefono, MinutosInactivo);
          await markWarningSent(Telefono);
          return { status: 'warning_sent' };
        } catch (error) {
          logger.error('Error procesando advertencia', error, { telefono: Telefono });
          return { status: 'warning_error' };
        }
      });

      const warningResults = await Promise.all(warningPromises);
      warningResults.forEach((result) => {
        if (result.status === 'warning_sent') {
          stats.advertenciasEnviadas++;
        } else {
          stats.errores++;
        }
      });
    }

    // PASO 2: Cerrar sesiones que ya tienen advertencia y siguen inactivas
    const expiredSessions = await findExpiredSessions();

    if (expiredSessions.length > 0) {
      logger.warn(`Encontradas ${expiredSessions.length} sesiones expiradas para cerrar`);

      const closePromises = expiredSessions.map(async (session) => {
        const { Telefono, MinutosInactivo } = session;

        const cerradaOk = await closeSessionByTimeout(Telefono);
        if (cerradaOk) {
          try {
            await notifySessionTimeout(Telefono, MinutosInactivo);
            return { status: 'closed_notified' };
          } catch (_notifyError) {
            return { status: 'closed_no_notify' };
          }
        } else {
          return { status: 'close_error' };
        }
      });

      const closeResults = await Promise.all(closePromises);
      closeResults.forEach((result) => {
        if (result.status === 'closed_notified') {
          stats.sesionesCerradas++;
          stats.notificacionesEnviadas++;
        } else if (result.status === 'closed_no_notify') {
          stats.sesionesCerradas++;
          stats.errores++;
        } else {
          stats.errores++;
        }
      });
    }

    if (sessionsNeedingWarning.length === 0 && expiredSessions.length === 0) {
      logger.debug('No hay sesiones que procesar');
    }

    stats.duracionMs = Date.now() - startTime;
    logger.info('Procesamiento de sesiones completado', stats);

    return stats;
  } catch (error) {
    logger.error('Error procesando sesiones', error, { operation: 'processExpiredSessions' });
    stats.errores++;
    stats.duracionMs = Date.now() - startTime;
    return stats;
  }
}

module.exports = {
  getTimeoutMinutes,
  getWarningMinutes,
  findSessionsNeedingWarning,
  findExpiredSessions,
  markWarningSent,
  resetWarning,
  closeSessionByTimeout,
  sendWarningMessage,
  notifySessionTimeout,
  processExpiredSessions,
};
