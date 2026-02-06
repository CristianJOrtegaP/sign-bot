/**
 * AC FIXBOT - Servicio de Detección de Intenciones
 * Detecta intenciones rápidamente con regex antes de llamar a IA
 * Soporta múltiples proveedores: Gemini / Azure OpenAI
 */

const aiService = require('./aiService');
const metrics = require('../infrastructure/metricsService');
const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');
const { withTimeoutAndFallback } = require('../../utils/promises');

// Lazy load Redis para caché distribuido de intents
let _redisService = null;
function getRedisService() {
  if (_redisService === null) {
    try {
      _redisService = require('../cache/redisService');
    } catch {
      _redisService = false;
    }
  }
  return _redisService || null;
}

// Configuración: Activar/Desactivar IA
const USE_AI = config.isAIEnabled;
const AI_PROVIDER = config.ai.provider;
logger.info('IntentService inicializado', { useAI: USE_AI, provider: AI_PROVIDER });

/**
 * Cache TTL para intenciones detectadas por IA (~500ms ahorro por hit)
 * Evita llamadas repetidas a IA para mensajes identicos
 */
const AI_INTENT_CACHE = new Map();
const AI_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const AI_CACHE_MAX_SIZE = 500; // Maximo de entradas

/**
 * Limpia entradas expiradas del cache de IA
 */
function cleanAICache() {
  const now = Date.now();
  for (const [key, entry] of AI_INTENT_CACHE) {
    if (now - entry.timestamp > AI_CACHE_TTL_MS) {
      AI_INTENT_CACHE.delete(key);
    }
  }
  // Evitar crecimiento ilimitado
  if (AI_INTENT_CACHE.size > AI_CACHE_MAX_SIZE) {
    const keysToDelete = Array.from(AI_INTENT_CACHE.keys()).slice(0, 100);
    keysToDelete.forEach((k) => AI_INTENT_CACHE.delete(k));
  }
}

// Limpiar cache periodicamente (cada 2 minutos)
// .unref() permite que el proceso termine sin esperar este timer
setInterval(cleanAICache, 2 * 60 * 1000).unref();

const AI_CACHE_TTL_SECONDS = Math.floor(AI_CACHE_TTL_MS / 1000);

/**
 * Guarda resultado de IA en cache local + Redis (distribuido)
 */
function cacheAIResult(normalizedText, result) {
  AI_INTENT_CACHE.set(normalizedText, { result, timestamp: Date.now() });
  // Fire-and-forget: guardar en Redis para compartir entre instancias
  const redis = getRedisService();
  if (redis && config.redis.enabled && !redis.isUsingFallback()) {
    redis.set(`intent:${normalizedText}`, result, AI_CACHE_TTL_SECONDS).catch(() => {});
  }
}

/**
 * Cache estático de intents exactos (O(1) lookup - más rápido que regex)
 * Para mensajes muy frecuentes que no requieren análisis
 */
const STATIC_INTENTS = new Map([
  // Saludos exactos
  ['hola', 'SALUDO'],
  ['hi', 'SALUDO'],
  ['hey', 'SALUDO'],
  ['buenas', 'SALUDO'],
  ['buenos dias', 'SALUDO'],
  ['buenos días', 'SALUDO'],
  ['buenas tardes', 'SALUDO'],
  ['buenas noches', 'SALUDO'],
  // Confirmaciones
  ['si', 'CONFIRMAR'],
  ['sí', 'CONFIRMAR'],
  ['ok', 'CONFIRMAR'],
  ['dale', 'CONFIRMAR'],
  ['va', 'CONFIRMAR'],
  ['claro', 'CONFIRMAR'],
  ['correcto', 'CONFIRMAR'],
  // Cancelaciones
  ['no', 'CANCELAR'],
  ['cancelar', 'CANCELAR'],
  ['salir', 'CANCELAR'],
  ['dejalo', 'CANCELAR'],
  ['déjalo', 'CANCELAR'],
  // Despedidas
  ['gracias', 'DESPEDIDA'],
  ['adios', 'DESPEDIDA'],
  ['adiós', 'DESPEDIDA'],
  ['bye', 'DESPEDIDA'],
  ['chao', 'DESPEDIDA'],
]);

// Patrones de regex para detección rápida
const PATTERNS = {
  SALUDO: /^(hola|hi|hey|buenos?\s*(d[ií]as?|tardes?|noches?)|buenas|saludos?|qu[eé]\s*tal)/i,
  CANCELAR:
    /^(cancelar|cancela|cancelarlo|no\s*quiero\s*(continuar|seguir)|dejarlo|olv[ií]dalo|olvida\s*esto|no\s*importa|ya\s*no|d[eé]jalo)$/i,
  DESPEDIDA:
    /^(adi[oó]s|adios|bye|chao|hasta luego|hasta pronto|hasta la vista|gracias|gracias por todo|nos vemos|finalizar|salir|terminar)/i,
  REPORTAR_FALLA:
    /(no\s*(enfr[ií]a|prende|funciona|enciende|sirve)|falla|problema|da[ñn]ado|descompuesto|roto|ruido|gotea|error|reportar)/i,
  TIPO_REFRIGERADOR:
    /^(refrigerador(es)?|refri(s)?|nevera(s)?|enfriador(es)?|cooler(s)?|frigorífico(s)?|frigorifico(s)?|hielera(s)?|fr[ií]o)$/i,
  TIPO_VEHICULO:
    /^(veh[ií]culo(s)?|vehiculo(s)?|carro(s)?|auto(m[oó]vil)?(es)?|camion(eta)?(es)?|unidad(es)?|transporte|cami[oó]n|camion)$/i,
  // Patrón para detectar modificaciones de información
  MODIFICAR_DATOS:
    /(cambia(r)?|modifica(r)?|actualiza(r)?|corrige|correg(ir)?|en realidad|mejor dicho|no,?\s*(es|era)|quise decir|me equivoqu[eé])\s*(el|la|los|las)?\s*(problema|descripci[oó]n|falla|c[oó]digo|sap|empleado|n[uú]mero)?/i,
};

/**
 * Detecta la intención del usuario de forma rápida
 * Usa regex para casos comunes y IA solo cuando es necesario
 * @param {string} text - Mensaje del usuario
 * @returns {Object} - Objeto con la intención detectada
 */
async function detectIntent(text, budget = null) {
  const timer = metrics.startTimer('intent_detection');
  const cleanText = text.trim();
  const normalizedText = cleanText.toLowerCase();

  // 0. Cache estático para intents exactos (< 0.1ms, O(1) lookup)
  const cachedIntent = STATIC_INTENTS.get(normalizedText);
  if (cachedIntent) {
    timer.end({ method: 'cache', intent: cachedIntent });
    return {
      intencion: cachedIntent,
      confianza: config.ai.confidence.high,
      metodo: 'cache',
      datos_extraidos: {},
    };
  }

  // 1. Detección rápida con regex (< 1ms)
  // Excepción: Si es SALUDO pero el mensaje es largo o contiene palabras de problema, continuar a IA
  for (const [intent, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(cleanText)) {
      // Si es saludo pero el mensaje también contiene palabras de REPORTAR_FALLA,
      // tratar como REPORTAR_FALLA (ej: "Hola mi refri no enciende")
      if (intent === 'SALUDO' && PATTERNS.REPORTAR_FALLA.test(cleanText)) {
        logger.debug('Saludo + problema detectado, redirigiendo a REPORTAR_FALLA', {
          text: cleanText.substring(0, 50),
        });
        timer.end({ method: 'regex', intent: 'REPORTAR_FALLA' });
        return {
          intencion: 'REPORTAR_FALLA',
          confianza: config.ai.confidence.high,
          metodo: 'regex',
          datos_extraidos: {},
        };
      }
      // Si es saludo + mensaje largo, seguir a IA para extraer datos completos
      if (intent === 'SALUDO' && cleanText.length > config.ai.messageLengthThreshold && USE_AI) {
        logger.debug('Saludo detectado pero mensaje largo, usando IA', {
          length: cleanText.length,
        });
        break; // Continuar al procesamiento con IA
      }
      timer.end({ method: 'regex', intent });
      return {
        intencion: intent,
        confianza: config.ai.confidence.high,
        metodo: 'regex',
        datos_extraidos: {},
      };
    }
  }

  // 2. Si USE_AI está desactivado, devolver OTRO sin llamar a IA
  if (!USE_AI) {
    timer.end({ method: 'fallback', intent: config.intents.OTRO });
    return {
      intencion: config.intents.OTRO,
      confianza: config.ai.confidence.low,
      metodo: 'fallback',
      datos_extraidos: {},
    };
  }

  // 2.5 Cache TTL para resultados de IA (~500ms ahorro por hit)
  // Primero verificar cache local, luego Redis (distribuido entre instancias)
  const aiCacheEntry = AI_INTENT_CACHE.get(normalizedText);
  if (aiCacheEntry && Date.now() - aiCacheEntry.timestamp < AI_CACHE_TTL_MS) {
    timer.end({ method: 'ai_cache', intent: aiCacheEntry.result.intencion });
    return { ...aiCacheEntry.result, metodo: 'ai_cache' };
  }

  // Cache distribuido: verificar Redis si está disponible
  const redis = getRedisService();
  if (redis && config.redis.enabled && !redis.isUsingFallback()) {
    try {
      const redisResult = await redis.get(`intent:${normalizedText}`);
      if (redisResult) {
        // Guardar también en cache local para próximos lookups
        AI_INTENT_CACHE.set(normalizedText, { result: redisResult, timestamp: Date.now() });
        timer.end({ method: 'ai_cache_redis', intent: redisResult.intencion });
        return { ...redisResult, metodo: 'ai_cache_redis' };
      }
    } catch {
      // Ignorar errores de Redis, continuar con IA
    }
  }

  // 3. Mensajes largos - usar extractAllData para extraer TODOS los datos en una sola llamada IA
  // Extrae: tipo_equipo, problema, codigo_sap, numero_empleado, intencion
  // Esto evita llamadas redundantes posteriores en textHandler
  if (cleanText.length > config.ai.messageLengthThreshold) {
    const extractTimer = metrics.startTimer('ai_extract_all');

    // Aplicar timeout con budget si disponible, sino 4 segundos fijo
    const extractTimeout = budget ? budget.effectiveTimeout(4000) : 4000;
    if (extractTimeout === 0) {
      timer.end({ method: 'fallback_budget', intent: 'REPORTAR_FALLA' });
      return {
        intencion: 'REPORTAR_FALLA',
        confianza: 0,
        metodo: 'fallback_budget',
        datos_extraidos: {},
      };
    }
    const extracted = await withTimeoutAndFallback(
      aiService.extractAllData(cleanText),
      extractTimeout,
      {
        intencion: 'REPORTAR_FALLA',
        tipo_equipo: null,
        codigo_sap: null,
        numero_empleado: null,
        problema: null,
        confianza: 0,
        datos_encontrados: [],
        razon: 'Timeout en extracción completa',
        metodo: 'fallback_timeout',
      },
      'extractAllData'
    );

    extractTimer.end({ intent: extracted.intencion });

    // Si IA tiene alta confianza, usar datos completos extraídos
    if (extracted.confianza >= config.ai.confidence.medium) {
      timer.end({ method: 'ai_extract', intent: extracted.intencion });
      logger.ai(`${AI_PROVIDER} extrajo datos completos (una sola llamada)`, {
        intent: extracted.intencion,
        tipoEquipo: extracted.tipo_equipo,
        problema: extracted.problema,
        codigoSap: extracted.codigo_sap,
        numeroEmpleado: extracted.numero_empleado,
      });
      const result = {
        intencion: extracted.intencion,
        tipo_equipo: extracted.tipo_equipo,
        problema: extracted.problema,
        codigo_sap: extracted.codigo_sap,
        numero_empleado: extracted.numero_empleado,
        confianza: extracted.confianza,
        metodo: 'ai_extract',
        provider: AI_PROVIDER,
        razon: extracted.razon,
        datos_extraidos: {
          tipo_equipo: extracted.tipo_equipo,
          problema: extracted.problema,
          codigo_sap: extracted.codigo_sap,
          numero_empleado: extracted.numero_empleado,
          datos_encontrados: extracted.datos_encontrados,
        },
      };
      // Cachear resultado de IA (local + Redis distribuido)
      cacheAIResult(normalizedText, result);
      return result;
    }
  }

  // 4. Mensajes cortos - interpretar términos específicos
  // Esto evita que índices crezcan con variaciones innecesarias
  if (cleanText.length <= config.ai.messageLengthThreshold) {
    const interpretTimer = metrics.startTimer('ai_interpret_term');

    // Aplicar timeout con budget si disponible, sino 3 segundos fijo
    const interpretTimeout = budget ? budget.effectiveTimeout(3000) : 3000;
    if (interpretTimeout === 0) {
      timer.end({ method: 'fallback_budget', intent: 'OTRO' });
      return { intencion: 'OTRO', confianza: 0, metodo: 'fallback_budget', datos_extraidos: {} };
    }
    const interpretation = await withTimeoutAndFallback(
      aiService.interpretTerm(cleanText),
      interpretTimeout,
      {
        intencion: 'OTRO',
        confianza: 0,
        razon: 'Timeout en interpretación de término',
        metodo: 'fallback_timeout',
      },
      'interpretTerm'
    );

    interpretTimer.end({ intent: interpretation.intencion });

    // Si IA tiene alta confianza en su interpretación, usarla
    if (interpretation.confianza >= config.ai.confidence.medium) {
      timer.end({ method: 'ai_interpret', intent: interpretation.intencion });
      logger.ai(`${AI_PROVIDER} interpretó término`, {
        intent: interpretation.intencion,
        confianza: interpretation.confianza,
        razon: interpretation.razon,
      });
      const result = {
        intencion: interpretation.intencion,
        confianza: interpretation.confianza,
        metodo: 'ai_interpret',
        provider: AI_PROVIDER,
        razon: interpretation.razon,
        datos_extraidos: {},
      };
      // Cachear resultado de IA (local + Redis distribuido)
      cacheAIResult(normalizedText, result);
      return result;
    }
  }

  // 5. Si no coincide con ningún patrón, usar IA completa (solo cuando es necesario)
  const aiTimer = metrics.startTimer('ai_api_call');

  // Aplicar timeout con budget si disponible, sino 3 segundos fijo
  const detectTimeout = budget ? budget.effectiveTimeout(3000) : 3000;
  if (detectTimeout === 0) {
    timer.end({ method: 'fallback_budget', intent: 'OTRO' });
    return { intencion: 'OTRO', confianza: 0, metodo: 'fallback_budget', datos_extraidos: {} };
  }
  const aiResult = await withTimeoutAndFallback(
    aiService.detectIntent(cleanText),
    detectTimeout,
    {
      intencion: 'OTRO',
      confianza: 0,
      razon: 'Timeout en detección de intent',
      metodo: 'fallback_timeout',
    },
    'detectIntent (AI)'
  );

  aiTimer.end({ intent: aiResult.intencion });

  timer.end({ method: 'ai', intent: aiResult.intencion });
  const result = {
    ...aiResult,
    metodo: 'ai',
    provider: AI_PROVIDER,
  };
  // Cachear resultado de IA
  AI_INTENT_CACHE.set(normalizedText, { result, timestamp: Date.now() });
  return result;
}

module.exports = {
  detectIntent,
};
