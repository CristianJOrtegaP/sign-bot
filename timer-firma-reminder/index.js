/**
 * SIGN BOT - Timer: Firma Reminders, SAP Reports, and Housekeeping
 * Runs on FIRMA_TIMER_SCHEDULE (default: every hour)
 *
 * Three responsibilities:
 *
 * 1. CLIENT REMINDERS (every 48h, max 5)
 *    - Query documents where:
 *      - Estado in (ENVIADO, ENTREGADO, VISTO, RECHAZADO)
 *      - IntentosRecordatorio < maxRecordatoriosCliente
 *      - UltimoRecordatorio is NULL or > reminderHoursCliente hours ago
 *    - For each: send WhatsApp template (firma_recordatorio)
 *    - Increment IntentosRecordatorio and set UltimoRecordatorio
 *    - Log results
 *
 * 2. SAP/TEAMS REPORTS (every 7 days)
 *    - Query documents where:
 *      - Estado in (ENVIADO, ENTREGADO, VISTO, RECHAZADO)
 *      - UltimoReporteTeams is NULL or > reminderDaysSap days ago
 *    - For each: send Teams notification via teamsService
 *    - Update UltimoReporteTeams timestamp
 *    - No max limit on SAP/Teams reports
 *
 * 3. HOUSEKEEPING (after 30 days)
 *    - Query documents where:
 *      - Estado in (ENVIADO, ENTREGADO, VISTO, RECHAZADO, ERROR)
 *      - No activity for housekeepingDays
 *    - For each: void envelope via docusignService.voidEnvelope()
 *    - Update document estado to ANULADO
 *    - Send WhatsApp anulacion template
 *    - Send Teams notification
 *
 * Error handling:
 * - Continue processing remaining documents if one fails
 * - Log all errors with document details
 * - Add delays between operations to avoid rate limits (1-2 seconds)
 */

const sql = require('mssql');
const config = require('../core/config');
const { logger } = require('../core/services/infrastructure/errorHandler');
const { getPool } = require('../core/services/storage/connectionPool');
const whatsappService = require('../core/services/external/whatsappService');
const docusignService = require('../core/services/external/docusignService');
const teamsService = require('../core/services/external/teamsService');
const appInsights = require('../core/services/infrastructure/appInsightsService');

// ==============================================================
// CONSTANTS
// ==============================================================

// Delay between WhatsApp API calls to avoid rate limits (ms)
const API_CALL_DELAY_MS = 1500;

/**
 * Utility: sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ==============================================================
// 1. CLIENT REMINDERS
// ==============================================================

/**
 * Query documents that need a client reminder via WhatsApp
 * @returns {Promise<Array>} - Documents needing reminders
 */
async function getDocumentsForReminder() {
  try {
    const pool = await getPool();
    const { reminderHoursCliente, maxRecordatoriosCliente } = config.firma;

    const result = await pool
      .request()
      .input('maxRecordatorios', sql.Int, maxRecordatoriosCliente)
      .input('reminderHours', sql.Int, reminderHoursCliente).query(`
        SELECT
          d.DocumentoId,
          d.EnvelopeId,
          d.Telefono,
          d.NombreCliente,
          d.NombreDocumento,
          d.Estado,
          d.IntentosRecordatorio,
          d.UltimoRecordatorio,
          d.FechaCreacion
        FROM DocumentosFirma d
        WHERE d.Estado IN ('ENVIADO', 'ENTREGADO', 'VISTO', 'RECHAZADO')
          AND (d.IntentosRecordatorio IS NULL OR d.IntentosRecordatorio < @maxRecordatorios)
          AND (
            d.UltimoRecordatorio IS NULL
            OR DATEDIFF(HOUR, d.UltimoRecordatorio, GETDATE()) >= @reminderHours
          )
      `);

    return result.recordset;
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error consultando documentos para recordatorio', error, {
      operation: 'getDocumentsForReminder',
    });
    return [];
  }
}

/**
 * Send a reminder to a client and update the document record
 * @param {Object} doc - Document record from database
 * @returns {Promise<boolean>} - true if reminder was sent successfully
 */
async function sendClientReminder(doc) {
  try {
    // Send WhatsApp template reminder
    await whatsappService.sendTemplate(doc.Telefono, {
      name: 'firma_recordatorio',
      language: { code: 'es_MX' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: doc.NombreCliente || 'Cliente' },
            { type: 'text', text: doc.NombreDocumento || 'documento pendiente' },
          ],
        },
      ],
    });

    // Update reminder count and timestamp in database
    const pool = await getPool();
    await pool.request().input('documentoId', sql.Int, doc.DocumentoId).query(`
        UPDATE DocumentosFirma
        SET
          IntentosRecordatorio = ISNULL(IntentosRecordatorio, 0) + 1,
          UltimoRecordatorio = GETDATE()
        WHERE DocumentoId = @documentoId
      `);

    logger.info('[FIRMA-REMINDER] Recordatorio enviado a cliente', {
      documentoId: doc.DocumentoId,
      telefono: doc.Telefono,
      intento: (doc.IntentosRecordatorio || 0) + 1,
    });

    return true;
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error enviando recordatorio a cliente', error, {
      documentoId: doc.DocumentoId,
      telefono: doc.Telefono,
      operation: 'sendClientReminder',
    });
    return false;
  }
}

/**
 * Process all pending client reminders
 * @param {Object} results - Results accumulator
 */
async function processClientReminders(results) {
  try {
    const documents = await getDocumentsForReminder();

    if (documents.length === 0) {
      logger.debug('[FIRMA-REMINDER] No hay documentos pendientes de recordatorio');
      return;
    }

    logger.info('[FIRMA-REMINDER] Procesando recordatorios de cliente', {
      total: documents.length,
    });

    for (const doc of documents) {
      const sent = await sendClientReminder(doc);
      if (sent) {
        results.recordatoriosEnviados++;
      } else {
        results.errores++;
      }

      // Delay between API calls to avoid rate limits
      if (documents.indexOf(doc) < documents.length - 1) {
        await sleep(API_CALL_DELAY_MS);
      }
    }
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error general procesando recordatorios de cliente', error);
    results.errores++;
  }
}

// ==============================================================
// 2. SAP/TEAMS REPORTS
// ==============================================================

/**
 * Query documents that need a Teams/SAP pending report
 * @returns {Promise<Array>} - Documents needing Teams reports
 */
async function getDocumentsForTeamsReport() {
  try {
    const pool = await getPool();
    const { reminderDaysSap } = config.firma;

    const result = await pool.request().input('reminderDays', sql.Int, reminderDaysSap).query(`
        SELECT
          d.DocumentoId,
          d.EnvelopeId,
          d.Telefono,
          d.NombreCliente,
          d.NombreDocumento,
          d.Estado,
          d.UltimoReporteTeams,
          d.FechaCreacion,
          DATEDIFF(DAY, d.FechaCreacion, GETDATE()) AS DiasDesdeCreacion
        FROM DocumentosFirma d
        WHERE d.Estado IN ('ENVIADO', 'ENTREGADO', 'VISTO', 'RECHAZADO')
          AND (
            d.UltimoReporteTeams IS NULL
            OR DATEDIFF(DAY, d.UltimoReporteTeams, GETDATE()) >= @reminderDays
          )
      `);

    return result.recordset;
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error consultando documentos para reporte Teams', error, {
      operation: 'getDocumentsForTeamsReport',
    });
    return [];
  }
}

/**
 * Send a Teams notification for a pending document and update timestamp
 * @param {Object} doc - Document record from database
 * @returns {Promise<boolean>} - true if notification was sent successfully
 */
async function sendTeamsReport(doc) {
  try {
    const card = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: 'FFA500',
      summary: `Documento pendiente de firma: ${doc.NombreDocumento || doc.EnvelopeId}`,
      sections: [
        {
          activityTitle: 'Documento Pendiente de Firma',
          activitySubtitle: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
          facts: [
            { name: 'Documento', value: doc.NombreDocumento || 'N/A' },
            { name: 'Cliente', value: doc.NombreCliente || 'N/A' },
            { name: 'Estado', value: doc.Estado },
            { name: 'Envelope ID', value: doc.EnvelopeId || 'N/A' },
            { name: 'Dias pendiente', value: String(doc.DiasDesdeCreacion || 0) },
          ],
          markdown: true,
        },
      ],
    };

    await teamsService.sendToTeams(card);

    // Update last Teams report timestamp
    const pool = await getPool();
    await pool.request().input('documentoId', sql.Int, doc.DocumentoId).query(`
        UPDATE DocumentosFirma
        SET UltimoReporteTeams = GETDATE()
        WHERE DocumentoId = @documentoId
      `);

    logger.info('[FIRMA-REMINDER] Reporte Teams enviado', {
      documentoId: doc.DocumentoId,
      envelopeId: doc.EnvelopeId,
      diasPendiente: doc.DiasDesdeCreacion,
    });

    return true;
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error enviando reporte Teams', error, {
      documentoId: doc.DocumentoId,
      operation: 'sendTeamsReport',
    });
    return false;
  }
}

/**
 * Process all pending SAP/Teams reports
 * @param {Object} results - Results accumulator
 */
async function processSapReports(results) {
  try {
    const documents = await getDocumentsForTeamsReport();

    if (documents.length === 0) {
      logger.debug('[FIRMA-REMINDER] No hay documentos pendientes de reporte Teams');
      return;
    }

    logger.info('[FIRMA-REMINDER] Procesando reportes SAP/Teams', {
      total: documents.length,
    });

    for (const doc of documents) {
      const sent = await sendTeamsReport(doc);
      if (sent) {
        results.reportesTeamsEnviados++;
      } else {
        results.errores++;
      }

      // Small delay between Teams API calls
      if (documents.indexOf(doc) < documents.length - 1) {
        await sleep(500);
      }
    }
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error general procesando reportes SAP/Teams', error);
    results.errores++;
  }
}

// ==============================================================
// 3. HOUSEKEEPING
// ==============================================================

/**
 * Query documents that have been inactive for housekeepingDays
 * @returns {Promise<Array>} - Stale documents to void
 */
async function getDocumentsForHousekeeping() {
  try {
    const pool = await getPool();
    const { housekeepingDays } = config.firma;

    const result = await pool.request().input('housekeepingDays', sql.Int, housekeepingDays).query(`
        SELECT
          d.DocumentoId,
          d.EnvelopeId,
          d.Telefono,
          d.NombreCliente,
          d.NombreDocumento,
          d.Estado,
          d.FechaCreacion,
          d.FechaActualizacion,
          DATEDIFF(DAY, ISNULL(d.FechaActualizacion, d.FechaCreacion), GETDATE()) AS DiasInactivo
        FROM DocumentosFirma d
        WHERE d.Estado IN ('ENVIADO', 'ENTREGADO', 'VISTO', 'RECHAZADO', 'ERROR')
          AND DATEDIFF(DAY, ISNULL(d.FechaActualizacion, d.FechaCreacion), GETDATE()) >= @housekeepingDays
      `);

    return result.recordset;
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error consultando documentos para housekeeping', error, {
      operation: 'getDocumentsForHousekeeping',
    });
    return [];
  }
}

/**
 * Void a stale envelope and update document status
 * @param {Object} doc - Document record from database
 * @returns {Promise<boolean>} - true if voided successfully
 */
async function voidStaleDocument(doc) {
  try {
    // 1. Void envelope in DocuSign
    if (doc.EnvelopeId) {
      await docusignService.voidEnvelope(
        doc.EnvelopeId,
        `Anulado por inactividad (${doc.DiasInactivo} dias sin actividad)`
      );
    }

    // 2. Update document estado to ANULADO in database
    const pool = await getPool();
    await pool.request().input('documentoId', sql.Int, doc.DocumentoId).query(`
        UPDATE DocumentosFirma
        SET
          Estado = 'ANULADO',
          FechaActualizacion = GETDATE(),
          MotivoAnulacion = 'Housekeeping: inactividad por ${doc.DiasInactivo} dias'
        WHERE DocumentoId = @documentoId
      `);

    // 3. Send WhatsApp anulacion template (fire-and-forget)
    try {
      await whatsappService.sendTemplate(doc.Telefono, {
        name: 'firma_anulacion',
        language: { code: 'es_MX' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: doc.NombreCliente || 'Cliente' },
              { type: 'text', text: doc.NombreDocumento || 'documento' },
            ],
          },
        ],
      });
    } catch (waError) {
      logger.warn('[FIRMA-REMINDER] Error enviando template de anulacion por WhatsApp', {
        documentoId: doc.DocumentoId,
        error: waError.message,
      });
    }

    // 4. Send Teams notification (fire-and-forget)
    try {
      const card = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: 'D13438',
        summary: `Documento anulado por housekeeping: ${doc.NombreDocumento || doc.EnvelopeId}`,
        sections: [
          {
            activityTitle: 'Documento Anulado (Housekeeping)',
            activitySubtitle: new Date().toLocaleString('es-MX', {
              timeZone: 'America/Mexico_City',
            }),
            facts: [
              { name: 'Documento', value: doc.NombreDocumento || 'N/A' },
              { name: 'Cliente', value: doc.NombreCliente || 'N/A' },
              { name: 'Estado anterior', value: doc.Estado },
              { name: 'Envelope ID', value: doc.EnvelopeId || 'N/A' },
              { name: 'Dias inactivo', value: String(doc.DiasInactivo || 0) },
            ],
            markdown: true,
          },
        ],
      };
      await teamsService.sendToTeams(card);
    } catch (teamsError) {
      logger.warn('[FIRMA-REMINDER] Error enviando notificacion Teams de anulacion', {
        documentoId: doc.DocumentoId,
        error: teamsError.message,
      });
    }

    logger.info('[FIRMA-REMINDER] Documento anulado por housekeeping', {
      documentoId: doc.DocumentoId,
      envelopeId: doc.EnvelopeId,
      diasInactivo: doc.DiasInactivo,
      estadoAnterior: doc.Estado,
    });

    return true;
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error anulando documento por housekeeping', error, {
      documentoId: doc.DocumentoId,
      envelopeId: doc.EnvelopeId,
      operation: 'voidStaleDocument',
    });
    return false;
  }
}

/**
 * Process all housekeeping (void stale envelopes)
 * @param {Object} results - Results accumulator
 */
async function processHousekeeping(results) {
  try {
    const documents = await getDocumentsForHousekeeping();

    if (documents.length === 0) {
      logger.debug('[FIRMA-REMINDER] No hay documentos para housekeeping');
      return;
    }

    logger.info('[FIRMA-REMINDER] Procesando housekeeping', {
      total: documents.length,
      housekeepingDays: config.firma.housekeepingDays,
    });

    for (const doc of documents) {
      const voided = await voidStaleDocument(doc);
      if (voided) {
        results.housekeepingVoided++;
      } else {
        results.errores++;
      }

      // Delay between operations (DocuSign + WhatsApp calls)
      if (documents.indexOf(doc) < documents.length - 1) {
        await sleep(2000);
      }
    }
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error general procesando housekeeping', error);
    results.errores++;
  }
}

// ==============================================================
// MAIN HANDLER
// ==============================================================

module.exports = async function (context, myTimer) {
  const startTime = Date.now();
  logger.info('[FIRMA-REMINDER] Timer ejecutado', {
    isPastDue: myTimer.isPastDue,
  });

  if (myTimer.isPastDue) {
    logger.warn('[FIRMA-REMINDER] Timer ejecutado tarde');
  }

  const results = {
    recordatoriosEnviados: 0,
    reportesTeamsEnviados: 0,
    housekeepingVoided: 0,
    errores: 0,
  };

  try {
    // 1. Client reminders
    await processClientReminders(results);

    // 2. SAP/Teams reports
    await processSapReports(results);

    // 3. Housekeeping
    await processHousekeeping(results);
  } catch (error) {
    logger.error('[FIRMA-REMINDER] Error general en timer', { error: error.message });
    results.errores++;
  }

  const durationMs = Date.now() - startTime;

  // Log summary
  context.log('============================================================');
  context.log('FIRMA REMINDER TIMER - Resultado del procesamiento');
  context.log('============================================================');
  context.log('Recordatorios enviados:  ', results.recordatoriosEnviados);
  context.log('Reportes Teams enviados: ', results.reportesTeamsEnviados);
  context.log('Housekeeping anulados:   ', results.housekeepingVoided);
  context.log('Errores:                 ', results.errores);
  context.log('Duracion:                ', durationMs, 'ms');
  context.log('============================================================');

  logger.info('[FIRMA-REMINDER] Timer completado', {
    ...results,
    durationMs,
  });

  if (results.errores > 0) {
    context.log.warn(
      `[FIRMA-REMINDER] Se encontraron ${results.errores} errores durante el procesamiento`
    );
  }

  // Flush AppInsights antes de que termine la function
  await appInsights.flush();
};
