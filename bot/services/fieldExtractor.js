/**
 * AC FIXBOT - Field Extractor Service (FASE 2b)
 *
 * Extrae TODOS los campos posibles de un mensaje usando:
 * - Regex patterns para datos estructurados (SAP, empleado, ubicación)
 * - AI service para datos ambiguos (problema, tipo equipo)
 *
 * Cada campo extraído incluye:
 * - valor: El valor extraído
 * - confianza: 0-100 nivel de certeza
 * - fuente: 'regex' | 'ai' | 'usuario_confirmado'
 */

const aiService = require('../../core/services/ai/aiService');
const { validateSAPCode, validateEmployeeNumber } = require('../../core/utils/helpers');
const { logger } = require('../../core/services/infrastructure/errorHandler');
const config = require('../../core/config');

// ==============================================================
// PATRONES REGEX
// ==============================================================

const PATTERNS = {
  // Código SAP: 5-10 dígitos, puede venir con prefijo "SAP", "código", etc.
  codigoSAP: [
    /(?:sap|codigo|código|equipo|refri|refrigerador|vehiculo|vehículo)[:\s-]*(\d{5,10})/i,
    /(?:^|\s)(\d{5,10})(?:\s|$)/,
    /SAP[:\s#-]*(\d{5,10})/i,
  ],

  // Número de empleado: patrones comunes
  numeroEmpleado: [
    /(?:empleado|no\.?\s*emp|num\.?\s*emp|numero\s*de?\s*empleado)[:\s#-]*(\w{3,20})/i,
    /(?:mi\s*numero\s*es|soy\s*el?\s*empleado)[:\s-]*(\w{3,20})/i,
    /(?:^|\s)EMP[:\s#-]*(\w{3,20})/i,
  ],

  // Ubicación/Dirección: textos que indican ubicación
  ubicacion: [
    /(?:estoy\s*en|ubicaci[oó]n|direcci[oó]n|calle|avenida|av\.?|col\.?|colonia)[:\s]*(.{10,100})/i,
    /(?:me\s*encuentro\s*en|cerca\s*de)[:\s]*(.{10,100})/i,
  ],

  // Coordenadas GPS (formato decimal)
  coordenadas: [/(-?\d{1,3}\.\d{4,8})[,\s]+(-?\d{1,3}\.\d{4,8})/],

  // Ticket number (para consultas)
  numeroTicket: [/(?:ticket|folio|reporte)[:\s#-]*(TKT-[A-Z0-9]{6,10})/i, /(TKT-[A-Z0-9]{6,10})/i],
};

// ==============================================================
// EXTRACCIÓN CON REGEX
// ==============================================================

/**
 * Extrae código SAP del mensaje
 * @param {string} mensaje - Texto del mensaje
 * @returns {Object|null} - { valor, confianza, fuente } o null
 */
function extractCodigoSAP(mensaje) {
  for (const pattern of PATTERNS.codigoSAP) {
    const match = mensaje.match(pattern);
    if (match && match[1]) {
      const validation = validateSAPCode(match[1]);
      if (validation.valid) {
        return {
          valor: validation.cleaned,
          confianza: pattern.toString().includes('sap') ? 95 : 80,
          fuente: 'regex',
        };
      }
    }
  }
  return null;
}

/**
 * Extrae número de empleado del mensaje
 * @param {string} mensaje - Texto del mensaje
 * @returns {Object|null} - { valor, confianza, fuente } o null
 */
function extractNumeroEmpleado(mensaje) {
  for (const pattern of PATTERNS.numeroEmpleado) {
    const match = mensaje.match(pattern);
    if (match && match[1]) {
      const validation = validateEmployeeNumber(match[1]);
      if (validation.valid) {
        return {
          valor: validation.cleaned,
          confianza: 90,
          fuente: 'regex',
        };
      }
    }
  }
  return null;
}

/**
 * Extrae ubicación del mensaje
 * @param {string} mensaje - Texto del mensaje
 * @returns {Object|null} - { valor, confianza, fuente, coordenadas? } o null
 */
function extractUbicacion(mensaje) {
  // Primero intentar coordenadas GPS
  for (const pattern of PATTERNS.coordenadas) {
    const match = mensaje.match(pattern);
    if (match && match[1] && match[2]) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);

      // Validar que sean coordenadas válidas
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return {
          valor: `${lat}, ${lng}`,
          confianza: 95,
          fuente: 'regex',
          coordenadas: { latitud: lat, longitud: lng },
        };
      }
    }
  }

  // Luego intentar direcciones textuales
  for (const pattern of PATTERNS.ubicacion) {
    const match = mensaje.match(pattern);
    if (match && match[1]) {
      const direccion = match[1].trim();
      if (direccion.length >= 10) {
        return {
          valor: direccion,
          confianza: 70,
          fuente: 'regex',
        };
      }
    }
  }

  return null;
}

/**
 * Extrae número de ticket del mensaje
 * @param {string} mensaje - Texto del mensaje
 * @returns {Object|null} - { valor, confianza, fuente } o null
 */
function extractNumeroTicket(mensaje) {
  for (const pattern of PATTERNS.numeroTicket) {
    const match = mensaje.match(pattern);
    if (match && match[1]) {
      return {
        valor: match[1].toUpperCase(),
        confianza: 95,
        fuente: 'regex',
      };
    }
  }
  return null;
}

// ==============================================================
// EXTRACCIÓN CON AI
// ==============================================================

/**
 * Extrae campos usando AI para datos ambiguos
 * @param {string} mensaje - Texto del mensaje
 * @param {string} tipoReporte - Tipo de reporte actual (REFRIGERADOR, VEHICULO)
 * @returns {Object} - Campos extraídos por AI
 */
async function extractWithAI(mensaje, tipoReporte = null) {
  if (!config.ai.enabled) {
    logger.debug('[FieldExtractor] AI deshabilitado, omitiendo extracción AI');
    return {};
  }

  try {
    const aiResult = await aiService.extractAllData(mensaje, tipoReporte);

    const campos = {};

    // Mapear resultados de AI a campos
    if (aiResult.tipo_equipo && aiResult.tipo_equipo !== 'DESCONOCIDO') {
      campos.tipoEquipo = {
        valor: aiResult.tipo_equipo,
        confianza: (aiResult.confianza || 0.5) * 100,
        fuente: 'ai',
      };
    }

    if (aiResult.problema && aiResult.problema.trim()) {
      campos.problema = {
        valor: aiResult.problema.trim(),
        confianza: (aiResult.confianza || 0.5) * 100,
        fuente: 'ai',
      };
    }

    // AI también puede detectar SAP y empleado si no se detectaron por regex
    if (aiResult.codigo_sap) {
      const validation = validateSAPCode(aiResult.codigo_sap);
      if (validation.valid) {
        campos.codigoSAP_ai = {
          valor: validation.cleaned,
          confianza: (aiResult.confianza || 0.5) * 100,
          fuente: 'ai',
        };
      }
    }

    if (aiResult.numero_empleado) {
      const validation = validateEmployeeNumber(aiResult.numero_empleado);
      if (validation.valid) {
        campos.numeroEmpleado_ai = {
          valor: validation.cleaned,
          confianza: (aiResult.confianza || 0.5) * 100,
          fuente: 'ai',
        };
      }
    }

    return campos;
  } catch (error) {
    logger.error('[FieldExtractor] Error en extracción AI', { error: error.message });
    return {};
  }
}

// ==============================================================
// FUNCIÓN PRINCIPAL
// ==============================================================

/**
 * Extrae TODOS los campos posibles de un mensaje
 * Combina extracción por regex + AI
 *
 * @param {string} mensaje - Texto del mensaje del usuario
 * @param {Object} options - Opciones de extracción
 * @param {string} options.tipoReporte - Tipo de reporte (REFRIGERADOR, VEHICULO)
 * @param {boolean} options.useAI - Si usar AI para campos ambiguos (default: true)
 * @param {Object} options.context - Contexto de la conversación
 * @param {string} options.campoSolicitado - Campo que el bot acaba de solicitar (prioridad)
 * @returns {Object} - Campos extraídos: { codigoSAP, numeroEmpleado, problema, ubicacion, ... }
 */
async function extractAllFields(mensaje, options = {}) {
  const { tipoReporte = null, useAI = true, context = null, campoSolicitado = null } = options;

  if (!mensaje || typeof mensaje !== 'string') {
    logger.warn('[FieldExtractor] Mensaje vacío o inválido');
    return { campos: {}, totalCampos: 0 };
  }

  const mensajeLimpio = mensaje.trim();

  // DEBUG: Log siempre para diagnóstico
  logger.info('[FieldExtractor] extractAllFields iniciado', {
    mensaje: mensajeLimpio.substring(0, 50),
    longitudMensaje: mensajeLimpio.length,
    tipoReporte: tipoReporte || 'NULL',
    campoSolicitado: campoSolicitado || 'NULL',
    useAI,
  });

  if (context) {
    context.log?.info('[FieldExtractor] Extrayendo campos', {
      longitudMensaje: mensajeLimpio.length,
      tipoReporte,
      useAI,
      campoSolicitado,
    });
  }

  const campos = {};

  // 1. Extracción con Regex (alta prioridad, rápido)
  const sapRegex = extractCodigoSAP(mensajeLimpio);
  if (sapRegex) {
    campos.codigoSAP = sapRegex;
  }

  const empleadoRegex = extractNumeroEmpleado(mensajeLimpio);
  if (empleadoRegex) {
    campos.numeroEmpleado = empleadoRegex;
  }

  const ubicacionRegex = extractUbicacion(mensajeLimpio);
  if (ubicacionRegex) {
    campos.ubicacion = ubicacionRegex;
  }

  const ticketRegex = extractNumeroTicket(mensajeLimpio);
  if (ticketRegex) {
    campos.numeroTicket = ticketRegex;
  }

  // 1.5 PRIORIDAD CONTEXTUAL: Si hay un campo solicitado, priorizar ese campo
  // Esto resuelve ambigüedades cuando el mensaje es solo un número
  logger.info('[FieldExtractor] Verificando prioridad contextual', {
    campoSolicitado: campoSolicitado || 'NULL',
    longitudMensaje: mensajeLimpio.length,
  });

  // Rastrear qué campos fueron asignados por prioridad contextual
  // para evitar que AI los sobrescriba con campos conflictivos
  const camposContextuales = {};

  if (campoSolicitado && mensajeLimpio.length <= 20) {
    const esNumeroSimple = /^\d{3,12}$/.test(mensajeLimpio.replace(/\s/g, ''));

    logger.info('[FieldExtractor] Prioridad contextual activa', {
      campoSolicitado,
      esNumeroSimple,
      mensaje: mensajeLimpio,
    });

    if (esNumeroSimple) {
      const numeroLimpio = mensajeLimpio.replace(/\s/g, '');

      // Si el bot pidió número de empleado y el usuario envió un número,
      // interpretarlo como número de empleado (no como SAP)
      if (campoSolicitado === 'numeroEmpleado') {
        const validation = validateEmployeeNumber(numeroLimpio);
        logger.info('[FieldExtractor] Intentando interpretar como numeroEmpleado', {
          numeroLimpio,
          validationValid: validation.valid,
        });
        if (validation.valid) {
          // Remover la interpretación errónea como SAP
          delete campos.codigoSAP;
          campos.numeroEmpleado = {
            valor: validation.cleaned,
            confianza: 95, // Alta confianza porque responde a pregunta directa
            fuente: 'contextual',
          };
          // Marcar que este campo fue asignado por prioridad contextual
          // para evitar que AI agregue codigoSAP con el mismo valor
          camposContextuales.numeroEmpleado = true;
          logger.info('[FieldExtractor] ✅ Prioridad contextual aplicada: numeroEmpleado', {
            valor: validation.cleaned,
          });
        }
      }
      // Si el bot pidió código SAP y el usuario envió un número,
      // interpretarlo como SAP (no como empleado)
      else if (campoSolicitado === 'codigoSAP') {
        const validation = validateSAPCode(numeroLimpio);
        if (validation.valid) {
          delete campos.numeroEmpleado;
          campos.codigoSAP = {
            valor: validation.cleaned,
            confianza: 95,
            fuente: 'contextual',
          };
          // Marcar que este campo fue asignado por prioridad contextual
          camposContextuales.codigoSAP = true;
          logger.info('[FieldExtractor] ✅ Prioridad contextual aplicada: codigoSAP', {
            valor: validation.cleaned,
          });
        }
      }
    }

    // Si el bot pidió problema y el usuario envió texto descriptivo
    if (campoSolicitado === 'problema' && !esNumeroSimple && mensajeLimpio.length >= 5) {
      campos.problema = {
        valor: mensajeLimpio,
        confianza: 90,
        fuente: 'contextual',
      };
      logger.info('[FieldExtractor] ✅ Prioridad contextual aplicada: problema');
    }

    // Si el bot pidió ubicación y el usuario envió texto
    if (campoSolicitado === 'ubicacion' && !esNumeroSimple) {
      campos.ubicacion = {
        valor: mensajeLimpio,
        confianza: 85,
        fuente: 'contextual',
      };
      logger.info('[FieldExtractor] ✅ Prioridad contextual aplicada: ubicacion');
    }
  } else {
    logger.info('[FieldExtractor] Sin prioridad contextual', {
      razon: !campoSolicitado ? 'campoSolicitado es null' : 'mensaje muy largo',
    });
  }

  // 2. Extracción con AI (para campos no detectados por regex)
  if (useAI && config.ai.enabled) {
    const camposAI = await extractWithAI(mensajeLimpio, tipoReporte);

    // Problema siempre viene de AI
    if (camposAI.problema) {
      campos.problema = camposAI.problema;
    }

    // Tipo de equipo viene de AI
    if (camposAI.tipoEquipo) {
      campos.tipoEquipo = camposAI.tipoEquipo;
    }

    // SAP de AI solo si:
    // - No se detectó por regex
    // - Y no se asignó numeroEmpleado por prioridad contextual (evita conflicto)
    if (!campos.codigoSAP && camposAI.codigoSAP_ai && !camposContextuales.numeroEmpleado) {
      campos.codigoSAP = camposAI.codigoSAP_ai;
    } else if (camposContextuales.numeroEmpleado && camposAI.codigoSAP_ai) {
      logger.info(
        '[FieldExtractor] ⏭️ SAP de AI ignorado - numeroEmpleado tiene prioridad contextual'
      );
    }

    // Empleado de AI solo si:
    // - No se detectó por regex
    // - Y no se asignó codigoSAP por prioridad contextual (evita conflicto)
    if (!campos.numeroEmpleado && camposAI.numeroEmpleado_ai && !camposContextuales.codigoSAP) {
      campos.numeroEmpleado = camposAI.numeroEmpleado_ai;
    } else if (camposContextuales.codigoSAP && camposAI.numeroEmpleado_ai) {
      logger.info(
        '[FieldExtractor] ⏭️ Empleado de AI ignorado - codigoSAP tiene prioridad contextual'
      );
    }
  }

  // 3. Si el mensaje es largo y no se detectó problema, usarlo como problema potencial
  if (!campos.problema && mensajeLimpio.length > 20) {
    // Verificar que no sea solo datos estructurados
    const soloNumeros = /^\d+$/.test(mensajeLimpio.replace(/\s/g, ''));
    const esRespuestaCorta = ['si', 'no', 'ok', 'confirmo', 'correcto'].includes(
      mensajeLimpio.toLowerCase()
    );

    if (!soloNumeros && !esRespuestaCorta) {
      campos.problemaPotencial = {
        valor: mensajeLimpio,
        confianza: 40,
        fuente: 'inferido',
      };
    }
  }

  const totalCampos = Object.keys(campos).length;

  if (context) {
    context.log?.info('[FieldExtractor] Extracción completada', {
      totalCampos,
      camposEncontrados: Object.keys(campos),
    });
  }

  return {
    campos,
    totalCampos,
    mensaje: mensajeLimpio,
  };
}

/**
 * Extrae campos de una imagen usando AI Vision
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} caption - Caption del usuario (opcional)
 * @param {Object} options - Opciones
 * @returns {Object} - Campos extraídos de la imagen
 */
async function extractFieldsFromImage(imageBuffer, caption = '', options = {}) {
  const { context = null } = options;

  if (!config.ai.enabled || !config.vision.enabled) {
    logger.debug('[FieldExtractor] Vision deshabilitado');
    return { campos: {}, totalCampos: 0, esImagen: true };
  }

  try {
    const visionResult = await aiService.analyzeImageWithVision(imageBuffer, caption);

    const campos = {};

    if (visionResult.codigo_sap) {
      const validation = validateSAPCode(visionResult.codigo_sap);
      if (validation.valid) {
        campos.codigoSAP = {
          valor: validation.cleaned,
          confianza: (visionResult.confianza || 0.5) * 100,
          fuente: 'vision',
        };
      }
    }

    if (visionResult.problema) {
      campos.problema = {
        valor: visionResult.problema,
        confianza: (visionResult.confianza || 0.5) * 100,
        fuente: 'vision',
      };
    }

    if (visionResult.tipo_equipo && visionResult.tipo_equipo !== 'DESCONOCIDO') {
      campos.tipoEquipo = {
        valor: visionResult.tipo_equipo,
        confianza: (visionResult.confianza || 0.5) * 100,
        fuente: 'vision',
      };
    }

    // También extraer del caption si existe
    if (caption && caption.trim()) {
      const captionResult = await extractAllFields(caption, { ...options, useAI: false });
      // Mergear campos del caption (regex) con los de vision
      for (const [key, value] of Object.entries(captionResult.campos)) {
        if (!campos[key]) {
          campos[key] = value;
        }
      }
    }

    if (context) {
      context.log?.info('[FieldExtractor] Extracción de imagen completada', {
        totalCampos: Object.keys(campos).length,
        camposEncontrados: Object.keys(campos),
      });
    }

    return {
      campos,
      totalCampos: Object.keys(campos).length,
      esImagen: true,
      infoVisual: visionResult.informacion_visual,
    };
  } catch (error) {
    logger.error('[FieldExtractor] Error en extracción de imagen', { error: error.message });
    return { campos: {}, totalCampos: 0, esImagen: true, error: error.message };
  }
}

// ==============================================================
// EXPORTS
// ==============================================================

module.exports = {
  extractAllFields,
  extractFieldsFromImage,

  // Exportar funciones individuales para testing
  extractCodigoSAP,
  extractNumeroEmpleado,
  extractUbicacion,
  extractNumeroTicket,
  extractWithAI,

  // Exportar patrones para testing/debugging
  PATTERNS,
};
