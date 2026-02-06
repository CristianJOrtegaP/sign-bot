/**
 * AC FIXBOT - Utilidades de enriquecimiento de sesión
 * Extracción de datos mid-flow y formateo de confirmaciones
 */

const db = require('../../../../core/services/storage/databaseService');
const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const { safeParseJSON } = require('../../../../core/utils/helpers');
const { ORIGEN_ACCION } = require('../../../constants/sessionStates');

/**
 * Formatea mensaje de confirmación cuando se modifica información
 * @param {Array} modificaciones - Lista de campos modificados
 * @returns {string} - Mensaje formateado
 */
function formatModificacionConfirmacion(modificaciones) {
  const camposFormateados = {
    problema: 'descripción del problema',
    codigo_sap: 'código SAP',
    numero_empleado: 'número de empleado',
  };

  const cambios = modificaciones.map((m) => {
    const campoNombre = camposFormateados[m.campo] || m.campo;
    return `*${campoNombre}* actualizado:\n  _Anterior:_ ${m.anterior}\n  _Nuevo:_ ${m.nuevo}`;
  });

  return `Informacion actualizada:\n\n${cambios.join('\n\n')}\n\nContinuamos con tu reporte.`;
}

/**
 * Enriquece la sesión con datos extraídos de un mensaje (mid-flow)
 * Soporta:
 * - Agregar datos nuevos cuando no existen
 * - MODIFICAR datos existentes cuando el usuario lo solicita explícitamente
 * @returns {Object|null} Información sobre modificaciones realizadas, o null si no hubo cambios
 */
async function enrichSessionWithExtractedData(from, text, session, context) {
  try {
    const aiService = require('../../../../core/services/ai/aiService');
    const extracted = await aiService.extractAllData(text, session.Estado);

    if (extracted.confianza < 0.7 || extracted.datos_encontrados.length === 0) {
      return null; // No hay datos relevantes para extraer
    }

    context.log(
      `🧠 Extracción mid-flow: ${JSON.stringify(extracted.datos_encontrados)}, modificación: ${extracted.es_modificacion}`
    );

    // Obtener datos actuales de la sesión
    const datosTemp = safeParseJSON(session.DatosTemp) || {};
    let needsUpdate = false;
    const modificaciones = [];

    // Determinar si es una modificación explícita
    const esModificacion = extracted.es_modificacion || false;

    // PROBLEMA: Agregar si no existe O modificar si el usuario lo pide
    if (extracted.problema) {
      if (!datosTemp.problemaTemp) {
        // Agregar problema nuevo
        datosTemp.problemaTemp = extracted.problema;
        needsUpdate = true;
        context.log(`🧠 Problema extraído mid-flow: "${extracted.problema}"`);
      } else if (esModificacion && extracted.campo_modificado === 'problema') {
        // Modificar problema existente
        const problemaAnterior = datosTemp.problemaTemp;
        datosTemp.problemaTemp = extracted.problema;
        needsUpdate = true;
        modificaciones.push({
          campo: 'problema',
          anterior: problemaAnterior,
          nuevo: extracted.problema,
        });
        context.log(`✏️ Problema MODIFICADO: "${problemaAnterior}" → "${extracted.problema}"`);
      }
    }

    // NÚMERO DE EMPLEADO (solo vehículos): Agregar o modificar
    if (extracted.numero_empleado && datosTemp.tipoReporte === 'VEHICULO') {
      if (!datosTemp.numeroEmpleado) {
        // Agregar empleado nuevo
        datosTemp.numeroEmpleado = extracted.numero_empleado;
        needsUpdate = true;
        context.log(`🧠 Empleado extraído mid-flow: "${extracted.numero_empleado}"`);
      } else if (esModificacion && extracted.campo_modificado === 'numero_empleado') {
        // Modificar empleado existente
        const empleadoAnterior = datosTemp.numeroEmpleado;
        datosTemp.numeroEmpleado = extracted.numero_empleado;
        needsUpdate = true;
        modificaciones.push({
          campo: 'numero_empleado',
          anterior: empleadoAnterior,
          nuevo: extracted.numero_empleado,
        });
        context.log(
          `✏️ Empleado MODIFICADO: "${empleadoAnterior}" → "${extracted.numero_empleado}"`
        );
      }
    }

    // CÓDIGO SAP: Agregar o modificar
    if (extracted.codigo_sap) {
      const campoSap =
        datosTemp.tipoReporte === 'VEHICULO' ? 'codigoSAPVehiculo' : 'codigoSapExtraido';
      if (!datosTemp[campoSap]) {
        // Agregar SAP nuevo
        datosTemp[campoSap] = extracted.codigo_sap;
        needsUpdate = true;
        context.log(`🧠 SAP extraído mid-flow: "${extracted.codigo_sap}"`);
      } else if (esModificacion && extracted.campo_modificado === 'codigo_sap') {
        // Modificar SAP existente
        const sapAnterior = datosTemp[campoSap];
        datosTemp[campoSap] = extracted.codigo_sap;
        needsUpdate = true;
        modificaciones.push({
          campo: 'codigo_sap',
          anterior: sapAnterior,
          nuevo: extracted.codigo_sap,
        });
        context.log(`✏️ SAP MODIFICADO: "${sapAnterior}" → "${extracted.codigo_sap}"`);
      }
    }

    // Actualizar sesión si encontramos datos nuevos o modificaciones
    if (needsUpdate) {
      const accion =
        modificaciones.length > 0
          ? `Datos MODIFICADOS: ${modificaciones.map((m) => m.campo).join(', ')}`
          : `Datos adicionales extraídos por IA: ${extracted.datos_encontrados.join(', ')}`;

      await db.updateSession(
        from,
        session.Estado,
        datosTemp,
        session.EquipoIdTemp,
        ORIGEN_ACCION.BOT,
        accion
      );
      // Actualizar la referencia local de la sesión
      session.DatosTemp = JSON.stringify(datosTemp);
      context.log(
        `✅ Sesión ${modificaciones.length > 0 ? 'MODIFICADA' : 'enriquecida'} con datos extraídos`
      );

      // Retornar información sobre modificaciones para enviar confirmación
      if (modificaciones.length > 0) {
        return { modificaciones, datosTemp };
      }
    }
    return null;
  } catch (error) {
    logger.error('Error en extracción mid-flow', error, { from, estado: session.Estado });
    return null;
  }
}

module.exports = {
  formatModificacionConfirmacion,
  enrichSessionWithExtractedData,
};
