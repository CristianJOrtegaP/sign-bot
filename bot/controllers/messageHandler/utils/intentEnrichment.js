/**
 * AC FIXBOT - Utilidades de enriquecimiento de intenciones
 * Extracción de datos estructurados con IA y regex fallback
 */

const { logger } = require('../../../../core/services/infrastructure/errorHandler');

/**
 * Detecta tipo de equipo usando regex (fallback cuando AI falla)
 */
function detectTipoEquipoRegex(text) {
  const textLower = text.toLowerCase();

  // Patrones para VEHICULO
  const vehiculoPatterns = [
    /\b(veh[ií]culo|carro|auto|cami[oó]n|camioneta|unidad|transporte)\b/i,
    /\b(sin gas|sin gasolina|sin combustible|se qued[oó] sin gas|falta gasolina)\b/i,
    /\b(no (arranca|enciende|prende)|ponchadura|llanta|motor|frenos|bater[ií]a|aceite|transmisi[oó]n)\b/i,
  ];

  // Patrones para REFRIGERADOR
  const refrigeradorPatterns = [
    /\b(refrigerador|refri|nevera|enfriador|cooler|congelador|frigor[ií]fico|hielera|equipo de fr[ií]o)\b/i,
    /\b(no enfr[ií]a|gotea agua|hielo|escarcha|temperatura)\b/i,
  ];

  // Verificar VEHICULO
  for (const pattern of vehiculoPatterns) {
    if (pattern.test(textLower)) {
      return 'VEHICULO';
    }
  }

  // Verificar REFRIGERADOR
  for (const pattern of refrigeradorPatterns) {
    if (pattern.test(textLower)) {
      return 'REFRIGERADOR';
    }
  }

  return null;
}

/**
 * Enriquece la intención con TODOS los datos posibles extraídos por IA
 * Incluye: tipo_equipo, problema, codigo_sap, numero_empleado
 * Con regex fallback si AI falla
 */
async function enrichIntentWithStructuredData(text, detectedIntent, context, estadoActual = null) {
  try {
    const aiService = require('../../../../core/services/ai/aiService');
    const extracted = await aiService.extractAllData(text, estadoActual);

    context.log(`📦 Extracción completa:`, JSON.stringify(extracted));

    // REGEX FALLBACK: Si AI no detectó tipo de equipo, usar regex
    let tipoEquipo = extracted.tipo_equipo;
    if (!tipoEquipo || tipoEquipo === 'OTRO') {
      tipoEquipo = detectTipoEquipoRegex(text);
      if (tipoEquipo) {
        context.log(`🎯 Regex fallback detectó tipo: ${tipoEquipo}`);
      }
    }

    if (extracted.confianza >= 0.7 || tipoEquipo) {
      const tipoFinal = tipoEquipo || detectedIntent.tipo_equipo;

      // Solo procesar si tenemos tipo de equipo válido
      if (tipoFinal && tipoFinal !== 'OTRO') {
        return {
          ...detectedIntent,
          tipo_equipo: tipoFinal,
          problema: extracted.problema || detectedIntent.problema,
          codigo_sap: extracted.codigo_sap,
          numero_empleado: extracted.numero_empleado,
          metodo:
            tipoEquipo && !extracted.tipo_equipo
              ? 'regex_fallback+ai_extract'
              : 'regex+ai_extract_all',
          datos_extraidos: {
            tipo_equipo: tipoFinal,
            problema: extracted.problema,
            codigo_sap: extracted.codigo_sap,
            numero_empleado: extracted.numero_empleado,
            datos_encontrados: extracted.datos_encontrados,
          },
        };
      }
    }
    context.log(
      `⚠️ Extracción no cumple requisitos: confianza=${extracted.confianza}, tipo_equipo=${tipoEquipo}`
    );
  } catch (error) {
    logger.error('Error en extracción completa', error, { estadoActual });
  }
  return detectedIntent;
}

module.exports = {
  detectTipoEquipoRegex,
  enrichIntentWithStructuredData,
};
