/**
 * AC FIXBOT - Conversations API
 * API REST para gestionar conversaciones y handoff a agente humano
 * (El dashboard visual está en /api/dashboard)
 *
 * Endpoints GET:
 * - /api/conversations/list (lista de conversaciones)
 * - /api/conversations/chat/{telefono} (historial de un usuario)
 * - /api/conversations/search/{query} (buscar por teléfono)
 * - /api/conversations/kpis (datos para dashboard de KPIs)
 *
 * Endpoints POST:
 * - /api/conversations/takeover/{telefono} (agente toma la conversación)
 * - /api/conversations/release/{telefono} (devolver al bot)
 * - /api/conversations/send/{telefono} (enviar mensaje como agente)
 */

const connectionPool = require('../core/services/storage/connectionPool');
const whatsapp = require('../core/services/external/whatsappService');
const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const {
  ESTADO,
  ORIGEN_ACCION,
  TIPO_MENSAJE: _TIPO_MENSAJE,
  TIPO_CONTENIDO: _TIPO_CONTENIDO,
} = require('../bot/constants/sessionStates');

/**
 * Obtiene lista de conversaciones activas (agrupadas por teléfono)
 */
async function getConversationsList(limit = 50, offset = 0) {
  const pool = await connectionPool.getPool();

  const result = await pool.request().input('limit', limit).input('offset', offset).query(`
      SELECT
        s.Telefono,
        s.NombreUsuario,
        ce.Codigo AS Estado,
        s.TipoReporteId,
        s.UltimaActividad AS FechaUltimoMensaje,
        s.FechaCreacion,
        s.ContadorMensajes,
        s.AgenteId,
        s.AgenteNombre,
        s.FechaTomaAgente,
        (SELECT COUNT(*) FROM MensajesChat mc WHERE mc.Telefono = s.Telefono) as TotalMensajes,
        (SELECT TOP 1 mc.Contenido FROM MensajesChat mc WHERE mc.Telefono = s.Telefono ORDER BY mc.FechaCreacion DESC) as UltimoMensaje,
        tr.Nombre as TipoReporte,
        ce.Nombre as EstadoNombre
      FROM SesionesChat s
      INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
      LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
      ORDER BY s.UltimaActividad DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  return result.recordset;
}

/**
 * Obtiene historial de mensajes de un teléfono específico
 */
async function getChatHistory(telefono, limit = 1000) {
  const pool = await connectionPool.getPool();

  const result = await pool.request().input('telefono', telefono).input('limit', limit).query(`
      SELECT TOP (@limit)
        MensajeId,
        SesionId,
        Tipo,
        Contenido,
        TipoContenido,
        IntencionDetectada,
        ConfianzaIA,
        AgenteId,
        FechaCreacion
      FROM MensajesChat
      WHERE Telefono = @telefono
      ORDER BY FechaCreacion ASC
    `);

  // Obtener info de sesión
  const sessionResult = await pool.request().input('telefono', telefono).query(`
      SELECT
        s.Telefono,
        s.NombreUsuario,
        ce.Codigo AS Estado,
        s.FechaCreacion,
        s.UltimaActividad AS FechaUltimoMensaje,
        s.ContadorMensajes,
        s.AgenteId,
        s.AgenteNombre,
        s.FechaTomaAgente,
        tr.Nombre as TipoReporte,
        ce.Nombre as EstadoNombre
      FROM SesionesChat s
      INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
      LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
      WHERE s.Telefono = @telefono
    `);

  return {
    session: sessionResult.recordset[0] || null,
    messages: result.recordset,
  };
}

/**
 * Busca conversaciones por número de teléfono
 */
async function searchConversations(query) {
  const pool = await connectionPool.getPool();

  const result = await pool.request().input('query', `%${query}%`).query(`
      SELECT
        s.Telefono,
        s.NombreUsuario,
        ce.Codigo AS Estado,
        s.UltimaActividad AS FechaUltimoMensaje,
        s.ContadorMensajes,
        s.AgenteId,
        s.AgenteNombre,
        (SELECT COUNT(*) FROM MensajesChat mc WHERE mc.Telefono = s.Telefono) as TotalMensajes,
        tr.Nombre as TipoReporte,
        ce.Nombre as EstadoNombre
      FROM SesionesChat s
      INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
      LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
      WHERE s.Telefono LIKE @query
      ORDER BY s.UltimaActividad DESC
    `);

  return result.recordset;
}

/**
 * Agente toma control de una conversación
 */
async function takeoverConversation(telefono, agenteId, agenteNombre) {
  const pool = await connectionPool.getPool();

  // Verificar que la sesión existe y no está ya tomada
  const checkResult = await pool.request().input('telefono', telefono).query(`
      SELECT ce.Codigo AS Estado, s.AgenteId
      FROM SesionesChat s
      INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
      WHERE s.Telefono = @telefono
    `);

  if (checkResult.recordset.length === 0) {
    return { success: false, error: 'Sesión no encontrada' };
  }

  const session = checkResult.recordset[0];
  if (session.Estado === ESTADO.AGENTE_ACTIVO && session.AgenteId) {
    return { success: false, error: `Conversación ya tomada por ${session.AgenteId}` };
  }

  // Guardar estado anterior para poder restaurar
  const estadoAnterior = session.Estado;

  // Actualizar sesión a modo agente
  await pool
    .request()
    .input('telefono', telefono)
    .input('estadoCodigo', ESTADO.AGENTE_ACTIVO)
    .input('agenteId', agenteId)
    .input('agenteNombre', agenteNombre)
    .input('estadoAnterior', estadoAnterior).query(`
      UPDATE SesionesChat
      SET EstadoId = (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = @estadoCodigo),
          AgenteId = @agenteId,
          AgenteNombre = @agenteNombre,
          FechaTomaAgente = GETDATE(),
          DatosTemp = JSON_MODIFY(ISNULL(DatosTemp, '{}'), '$.estadoAnteriorAgente', @estadoAnterior)
      WHERE Telefono = @telefono
    `);

  // Registrar en historial
  await pool
    .request()
    .input('telefono', telefono)
    .input('estadoAnterior', estadoAnterior)
    .input('estadoNuevo', ESTADO.AGENTE_ACTIVO)
    .input('origen', ORIGEN_ACCION.SISTEMA)
    .input('descripcion', `Conversación tomada por agente: ${agenteNombre}`).query(`
      INSERT INTO HistorialSesiones (Telefono, EstadoAnteriorId, EstadoNuevoId, OrigenAccion, Descripcion)
      SELECT @telefono,
             (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = @estadoAnterior),
             (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = @estadoNuevo),
             @origen, @descripcion
    `);

  return { success: true, estadoAnterior };
}

/**
 * Agente devuelve control al bot
 */
async function releaseConversation(telefono) {
  const pool = await connectionPool.getPool();

  // Obtener estado anterior guardado
  const checkResult = await pool.request().input('telefono', telefono).query(`
      SELECT ce.Codigo AS Estado, s.DatosTemp, s.AgenteNombre
      FROM SesionesChat s
      INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
      WHERE s.Telefono = @telefono
    `);

  if (checkResult.recordset.length === 0) {
    return { success: false, error: 'Sesión no encontrada' };
  }

  const session = checkResult.recordset[0];
  if (session.Estado !== ESTADO.AGENTE_ACTIVO) {
    return { success: false, error: 'La conversación no está en modo agente' };
  }

  // Intentar restaurar estado anterior o usar INICIO
  let estadoRestaurar = ESTADO.INICIO;
  try {
    const datosTemp = JSON.parse(session.DatosTemp || '{}');
    if (datosTemp.estadoAnteriorAgente) {
      estadoRestaurar = datosTemp.estadoAnteriorAgente;
    }
  } catch (_e) {
    // Usar INICIO si no se puede parsear
  }

  // Actualizar sesión
  await pool.request().input('telefono', telefono).input('estadoCodigo', estadoRestaurar).query(`
      UPDATE SesionesChat
      SET EstadoId = (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = @estadoCodigo),
          AgenteId = NULL,
          AgenteNombre = NULL,
          FechaTomaAgente = NULL,
          DatosTemp = JSON_MODIFY(ISNULL(DatosTemp, '{}'), '$.estadoAnteriorAgente', NULL)
      WHERE Telefono = @telefono
    `);

  // Registrar en historial
  await pool
    .request()
    .input('telefono', telefono)
    .input('estadoAnterior', ESTADO.AGENTE_ACTIVO)
    .input('estadoNuevo', estadoRestaurar)
    .input('origen', ORIGEN_ACCION.SISTEMA)
    .input('descripcion', `Conversación devuelta al bot por: ${session.AgenteNombre}`).query(`
      INSERT INTO HistorialSesiones (Telefono, EstadoAnteriorId, EstadoNuevoId, OrigenAccion, Descripcion)
      SELECT @telefono,
             (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = @estadoAnterior),
             (SELECT EstadoId FROM CatEstadoSesion WHERE Codigo = @estadoNuevo),
             @origen, @descripcion
    `);

  return { success: true, estadoRestaurado: estadoRestaurar };
}

/**
 * Agente envía mensaje al usuario
 */
async function sendAgentMessage(telefono, mensaje, agenteId) {
  const pool = await connectionPool.getPool();

  // Verificar que la sesión está en modo agente
  const checkResult = await pool.request().input('telefono', telefono).query(`
      SELECT ce.Codigo AS Estado, s.AgenteId
      FROM SesionesChat s
      INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
      WHERE s.Telefono = @telefono
    `);

  if (checkResult.recordset.length === 0) {
    return { success: false, error: 'Sesión no encontrada' };
  }

  const session = checkResult.recordset[0];
  if (session.Estado !== ESTADO.AGENTE_ACTIVO) {
    return {
      success: false,
      error: 'La conversación no está en modo agente. Primero debe tomar la conversación.',
    };
  }

  // Enviar mensaje via WhatsApp
  try {
    await whatsapp.sendText(telefono, mensaje);
  } catch (error) {
    return { success: false, error: `Error enviando mensaje: ${error.message}` };
  }

  // Guardar mensaje en historial con tipo 'A' (Agente)
  // Usamos 'B' porque la BD actual solo tiene 'U' y 'B', pero guardamos AgenteId
  await pool
    .request()
    .input('telefono', telefono)
    .input('contenido', mensaje)
    .input('agenteId', agenteId).query(`
      DECLARE @SesionId INT;
      SELECT @SesionId = SesionId FROM SesionesChat WHERE Telefono = @telefono;

      INSERT INTO MensajesChat (SesionId, Telefono, Tipo, Contenido, TipoContenido, AgenteId)
      VALUES (@SesionId, @telefono, 'B', @contenido, 'TEXTO', @agenteId);

      UPDATE SesionesChat SET UltimaActividad = GETDATE() WHERE Telefono = @telefono;
    `);

  return { success: true };
}

/**
 * Obtiene datos para el dashboard de KPIs
 */
async function getKPIsData() {
  const pool = await connectionPool.getPool();

  // Query 1: Reportes por periodo (hoy, ayer, semana)
  const reportesQuery = await pool.request().query(`
    SELECT
      SUM(CASE WHEN FechaCreacion >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS ReportesHoy,
      SUM(CASE WHEN FechaCreacion >= DATEADD(DAY, -1, CAST(GETDATE() AS DATE))
               AND FechaCreacion < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS ReportesAyer,
      SUM(CASE WHEN FechaCreacion >= DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END) AS ReportesSemana,
      COUNT(*) AS TotalReportes
    FROM Reportes
    WHERE FechaCreacion >= DATEADD(DAY, -30, GETDATE())
  `);

  // Query 2: Por estado (para tasa resolucion y barras)
  const porEstadoQuery = await pool.request().query(`
    SELECT
      er.Codigo AS Estado,
      er.Nombre AS EstadoNombre,
      COUNT(*) AS Total
    FROM Reportes r
    INNER JOIN CatEstadoReporte er ON r.EstadoReporteId = er.EstadoReporteId
    WHERE r.FechaCreacion >= DATEADD(DAY, -30, GETDATE())
    GROUP BY er.Codigo, er.Nombre, er.Orden
    ORDER BY er.Orden
  `);

  // Query 3: Por tipo (para donut)
  const porTipoQuery = await pool.request().query(`
    SELECT
      tr.Codigo AS TipoReporte,
      tr.Nombre AS TipoNombre,
      COUNT(*) AS Total
    FROM Reportes r
    INNER JOIN CatTipoReporte tr ON r.TipoReporteId = tr.TipoReporteId
    WHERE r.FechaCreacion >= DATEADD(DAY, -30, GETDATE())
    GROUP BY tr.Codigo, tr.Nombre
  `);

  // Query 4: Tendencia 7 dias
  const tendenciaQuery = await pool.request().query(`
    SELECT
      CAST(FechaCreacion AS DATE) AS Fecha,
      COUNT(*) AS Total
    FROM Reportes
    WHERE FechaCreacion >= DATEADD(DAY, -7, GETDATE())
    GROUP BY CAST(FechaCreacion AS DATE)
    ORDER BY Fecha
  `);

  // Query 5: Sesiones activas
  const sesionesQuery = await pool.request().query(`
    SELECT
      COUNT(*) AS SesionesActivas,
      SUM(CASE WHEN ce.Codigo = 'AGENTE_ACTIVO' THEN 1 ELSE 0 END) AS ConAgente
    FROM SesionesChat s
    INNER JOIN CatEstadoSesion ce ON s.EstadoId = ce.EstadoId
    WHERE ce.EsTerminal = 0
  `);

  // Query 6: Mensajes hoy
  const mensajesQuery = await pool.request().query(`
    SELECT
      COUNT(*) AS MensajesHoy,
      SUM(CASE WHEN Tipo = 'U' THEN 1 ELSE 0 END) AS Entrantes,
      SUM(CASE WHEN Tipo = 'B' THEN 1 ELSE 0 END) AS Salientes
    FROM MensajesChat
    WHERE FechaCreacion >= CAST(GETDATE() AS DATE)
  `);

  // Query 7: Satisfaccion (promedio de encuestas)
  const satisfaccionQuery = await pool.request().query(`
    SELECT
      CAST(AVG(CAST(r.Valor AS DECIMAL(5,2))) AS DECIMAL(3,1)) AS PromedioSatisfaccion,
      COUNT(DISTINCT e.EncuestaId) AS TotalEncuestas
    FROM RespuestasEncuesta r
    INNER JOIN Encuestas e ON r.EncuestaId = e.EncuestaId
    INNER JOIN CatEstadoEncuesta ce ON e.EstadoEncuestaId = ce.EstadoEncuestaId
    WHERE ce.Codigo = 'COMPLETADA'
      AND e.FechaEnvio >= DATEADD(DAY, -30, GETDATE())
  `);

  // Calcular tasa de resolucion
  const estados = porEstadoQuery.recordset || [];
  const total = estados.reduce((sum, e) => sum + e.Total, 0);
  const resueltos = estados.find((e) => e.Estado === 'RESUELTO')?.Total || 0;
  const tasaResolucion = total > 0 ? Math.round((resueltos / total) * 100) : 0;

  // Calcular tendencia (comparar hoy vs ayer)
  const reportes = reportesQuery.recordset[0] || {};
  const tendenciaReportes =
    reportes.ReportesAyer > 0
      ? Math.round(((reportes.ReportesHoy - reportes.ReportesAyer) / reportes.ReportesAyer) * 100)
      : 0;

  return {
    success: true,
    kpis: {
      reportesHoy: reportes.ReportesHoy || 0,
      reportesSemana: reportes.ReportesSemana || 0,
      tendenciaReportes: tendenciaReportes,
      tasaResolucion: tasaResolucion,
      satisfaccion: satisfaccionQuery.recordset[0]?.PromedioSatisfaccion || 0,
      sesionesActivas: sesionesQuery.recordset[0]?.SesionesActivas || 0,
      sesionesConAgente: sesionesQuery.recordset[0]?.ConAgente || 0,
      mensajesHoy: mensajesQuery.recordset[0]?.MensajesHoy || 0,
      mensajesEntrantes: mensajesQuery.recordset[0]?.Entrantes || 0,
      mensajesSalientes: mensajesQuery.recordset[0]?.Salientes || 0,
    },
    charts: {
      porEstado: porEstadoQuery.recordset || [],
      porTipo: porTipoQuery.recordset || [],
      tendencia7dias: tendenciaQuery.recordset || [],
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Main handler
 */
module.exports = async function (context, req) {
  const action = req.params.action || '';
  const param = req.params.param || '';
  const method = req.method.toUpperCase();

  // Manejar CORS preflight
  if (method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    };
    return;
  }

  try {
    let response;

    // POST actions (agente)
    if (method === 'POST') {
      const body = req.body || {};

      switch (action) {
        case 'takeover':
          if (!param) {
            response = { success: false, error: 'Telefono requerido' };
            break;
          }
          response = await takeoverConversation(
            param,
            body.agenteId || 'unknown',
            body.agenteNombre || 'Agente'
          );
          break;

        case 'release':
          if (!param) {
            response = { success: false, error: 'Telefono requerido' };
            break;
          }
          response = await releaseConversation(param);
          break;

        case 'send':
          if (!param) {
            response = { success: false, error: 'Telefono requerido' };
            break;
          }
          if (!body.mensaje) {
            response = { success: false, error: 'Mensaje requerido' };
            break;
          }
          response = await sendAgentMessage(param, body.mensaje, body.agenteId || 'unknown');
          break;

        default:
          response = { success: false, error: 'Accion POST no reconocida' };
      }

      context.res = {
        status: 200,
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }),
        body: response,
      };
      return;
    }

    // GET actions
    switch (action) {
      case '':
      case 'list': {
        const conversations = await getConversationsList(
          parseInt(req.query.limit) || 50,
          parseInt(req.query.offset) || 0
        );
        response = { success: true, conversations };
        break;
      }

      case 'chat': {
        if (!param) {
          response = { success: false, error: 'Telefono requerido' };
          break;
        }
        const chatData = await getChatHistory(param, parseInt(req.query.limit) || 500);
        response = { success: true, ...chatData };
        break;
      }

      case 'search': {
        if (!param || param.length < 3) {
          response = { success: false, error: 'Query muy corto (min 3 caracteres)' };
          break;
        }
        const searchResults = await searchConversations(param);
        response = { success: true, results: searchResults };
        break;
      }

      case 'kpis':
        response = await getKPIsData();
        break;

      default:
        response = { success: false, error: 'Accion no reconocida' };
    }

    context.res = {
      status: 200,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }),
      body: response,
    };
  } catch (error) {
    context.log.error('Error en API conversations:', error);
    context.res = {
      status: 500,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }),
      body: { success: false, error: error.message },
    };
  }
};
