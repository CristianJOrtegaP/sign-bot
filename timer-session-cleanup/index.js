/**
 * AC FIXBOT - Azure Function Timer Trigger
 * Revisa periodicamente sesiones inactivas:
 * 1. Envia advertencia "Sigues ahi?" a sesiones proximas a expirar
 * 2. Cierra sesiones que ya tienen advertencia y siguen inactivas
 *
 * Schedule: Configurable via TIMER_SCHEDULE (default: cada 5 minutos)
 * Formato CRON: segundo minuto hora dia mes dia-semana
 */

const sessionTimeoutService = require('../core/services/processing/sessionTimeoutService');
const db = require('../core/services/storage/databaseService');

module.exports = async function (context, myTimer) {
    const timestamp = new Date().toISOString();

    // Verificar si la ejecucion esta retrasada
    if (myTimer.isPastDue) {
        context.log('Timer trigger ejecutado con retraso');
    }

    context.log('Timer trigger iniciado:', timestamp);

    try {
        // Obtener configuracion actual
        const timeoutMinutes = sessionTimeoutService.getTimeoutMinutes();
        const warningMinutes = sessionTimeoutService.getWarningMinutes();

        context.log(`Configuracion: Warning=${warningMinutes}min, Timeout=${timeoutMinutes}min`);

        // Procesar sesiones (advertencias + cierres)
        const stats = await sessionTimeoutService.processExpiredSessions();

        // Log de resultados
        context.log('============================================================');
        context.log('GESTION DE SESIONES - Resultado del procesamiento');
        context.log('============================================================');
        context.log('Timestamp:               ', timestamp);
        context.log('Advertencias enviadas:   ', stats.advertenciasEnviadas);
        context.log('Sesiones cerradas:       ', stats.sesionesCerradas);
        context.log('Notificaciones enviadas: ', stats.notificacionesEnviadas);
        context.log('Errores:                 ', stats.errores);
        context.log('Duracion:                ', stats.duracionMs, 'ms');
        context.log('============================================================');

        // Si hubo errores, registrarlos como warning
        if (stats.errores > 0) {
            context.log.warn(`Se encontraron ${stats.errores} errores durante el procesamiento`);
        }

        // Limpiar mensajes procesados antiguos (deduplicacion)
        try {
            await db.cleanOldProcessedMessages();
            context.log('Limpieza de mensajes procesados completada');
        } catch (cleanupError) {
            context.log.warn('Error limpiando mensajes procesados:', cleanupError.message);
        }

        // Retornar estadisticas para posible monitoreo
        context.res = {
            status: 200,
            body: {
                success: true,
                timestamp: timestamp,
                config: {
                    warningMinutes,
                    timeoutMinutes
                },
                stats: stats
            }
        };

    } catch (error) {
        context.log.error('Error critico en sessionTimeoutChecker:', error);

        context.res = {
            status: 500,
            body: {
                success: false,
                error: error.message,
                timestamp: timestamp
            }
        };
    }

    context.log('Timer trigger completado:', new Date().toISOString());
};
