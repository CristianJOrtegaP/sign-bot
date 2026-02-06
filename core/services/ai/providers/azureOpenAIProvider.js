/**
 * AC FIXBOT - Azure OpenAI Provider
 * Implementa la interfaz de IA usando Azure OpenAI (GPT-4)
 * Compatible con @azure/openai v2.x
 */

const { AzureOpenAI } = require('openai');
const { logger } = require('../../infrastructure/errorHandler');

let client = null;
let deploymentName = null;

// Prompts del sistema (compartidos con otros providers)
const PROMPTS = require('./prompts');
const { sanitizeForLLM } = require('../../../utils/helpers');

/**
 * Inicializa el provider de Azure OpenAI
 * @param {Object} config - Configuración del provider
 */
function initialize(config) {
  if (!config.endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT es requerida para el provider de Azure OpenAI');
  }
  if (!config.apiKey) {
    throw new Error('AZURE_OPENAI_KEY es requerida para el provider de Azure OpenAI');
  }
  if (!config.deploymentName) {
    throw new Error('AZURE_OPENAI_DEPLOYMENT es requerida para el provider de Azure OpenAI');
  }

  // SDK v2.x usa AzureOpenAI del paquete 'openai'
  // timeout: Previene bloqueos — el SDK tiene default de 10 min, lo limitamos a 8s
  // maxRetries: Limita retries internos del SDK para no exceder el budget del webhook
  client = new AzureOpenAI({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    apiVersion: '2024-08-01-preview',
    deployment: config.deploymentName,
    timeout: 8000,
    maxRetries: 1,
  });
  deploymentName = config.deploymentName;

  logger.info('Azure OpenAI Provider inicializado', {
    endpoint: config.endpoint,
    deployment: deploymentName,
  });
}

/**
 * Envía un mensaje al modelo y obtiene la respuesta
 * @param {string} systemPrompt - Prompt del sistema
 * @param {string} userMessage - Mensaje del usuario
 * @returns {string} - Respuesta del modelo
 */
async function sendMessage(systemPrompt, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model: deploymentName,
    messages: messages,
    temperature: 0.3, // Baja temperatura para respuestas más consistentes
    max_tokens: 200, // Respuestas JSON típicas: 80-150 tokens
  });

  // Capturar uso de tokens para monitoreo de costos
  if (response.usage) {
    logger.info('Azure OpenAI - Token usage', {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    });
  }

  return response.choices[0]?.message?.content || '';
}

/**
 * Parsea la respuesta JSON del modelo
 * @param {string} response - Respuesta del modelo
 * @returns {Object|null} - Objeto parseado o null
 */
function parseJsonResponse(response) {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_e) {
      return null;
    }
  }
  return null;
}

/**
 * Detecta la intención del usuario en un mensaje
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} config - Configuración con umbrales de confianza
 * @returns {Object} - Objeto con la intención detectada
 */
async function detectIntent(userMessage, config) {
  try {
    const response = await sendMessage(
      PROMPTS.DETECT_INTENT,
      sanitizeForLLM(userMessage, { maxLength: 500 })
    );

    logger.ai('Azure OpenAI detectIntent - Respuesta recibida', {
      responseLength: response.length,
    });

    const parsed = parseJsonResponse(response);
    if (parsed) {
      return {
        intencion: parsed.intencion || 'OTRO',
        confianza: parsed.confianza || config.confidence.low,
        datos_extraidos: parsed.datos_extraidos || {},
      };
    }

    return {
      intencion: 'OTRO',
      confianza: config.confidence.low,
      datos_extraidos: {},
    };
  } catch (error) {
    logger.error('Error en Azure OpenAI detectIntent', error, {
      service: 'AzureOpenAI',
      operation: 'detectIntent',
    });
    return {
      intencion: 'OTRO',
      confianza: 0,
      datos_extraidos: {},
    };
  }
}

/**
 * Interpreta términos ambiguos o sinónimos
 * @param {string} userText - Texto del usuario
 * @param {Object} config - Configuración
 * @returns {Object} - Intención interpretada con confianza
 */
async function interpretTerm(userText, config) {
  try {
    const response = await sendMessage(
      PROMPTS.INTERPRET_TERM,
      `Interpreta este término: ${sanitizeForLLM(userText, { maxLength: 200 })}`
    );

    logger.ai('Azure OpenAI interpretTerm - Respuesta recibida', {
      responseLength: response.length,
    });

    const parsed = parseJsonResponse(response);
    if (parsed) {
      return {
        intencion: parsed.intencion_interpretada || 'OTRO',
        confianza: parsed.confianza || config.confidence.low,
        razon: parsed.razon || 'Sin razón especificada',
      };
    }

    return {
      intencion: 'OTRO',
      confianza: config.confidence.minimum,
      razon: 'No se pudo parsear la respuesta de Azure OpenAI',
    };
  } catch (error) {
    logger.error('Error interpretando término con Azure OpenAI', error, {
      service: 'AzureOpenAI',
      operation: 'interpretTerm',
    });
    return {
      intencion: 'OTRO',
      confianza: 0,
      razon: 'Error al llamar a Azure OpenAI',
    };
  }
}

/**
 * Extrae datos estructurados de mensajes largos
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} config - Configuración
 * @returns {Object} - Datos estructurados extraídos
 */
async function extractStructuredData(userMessage, config) {
  try {
    const response = await sendMessage(
      PROMPTS.EXTRACT_STRUCTURED,
      sanitizeForLLM(userMessage, { maxLength: 1000 })
    );

    logger.ai('Azure OpenAI extractStructuredData - Respuesta recibida', {
      responseLength: response.length,
    });

    const parsed = parseJsonResponse(response);
    if (parsed) {
      return {
        intencion: parsed.intencion || 'OTRO',
        tipo_equipo: parsed.tipo_equipo || 'OTRO',
        problema: parsed.problema || null,
        confianza: parsed.confianza || config.confidence.low,
        razon: parsed.razon || 'Sin razón especificada',
      };
    }

    return {
      intencion: 'OTRO',
      tipo_equipo: 'OTRO',
      problema: null,
      confianza: config.confidence.minimum,
      razon: 'No se pudo parsear la respuesta de Azure OpenAI',
    };
  } catch (error) {
    logger.error('Error extrayendo datos estructurados con Azure OpenAI', error, {
      service: 'AzureOpenAI',
      operation: 'extractStructuredData',
    });
    return {
      intencion: 'OTRO',
      tipo_equipo: 'OTRO',
      problema: null,
      confianza: 0,
      razon: 'Error al llamar a Azure OpenAI',
    };
  }
}

/**
 * Extrae TODA la información posible de un mensaje
 * Incluye: tipo equipo, código SAP, número empleado, problema
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} config - Configuración
 * @param {string} contextoActual - Estado actual del flujo (opcional)
 * @returns {Object} - Todos los datos extraídos
 */
// Prefijos de estado válidos para inyectar en system prompt
const VALID_STATE_PREFIXES = [
  'INICIO',
  'REFRIGERADOR_',
  'VEHICULO_',
  'CONFIRMAR_',
  'ESPERA_',
  'ENCUESTA_',
  'CONSULTA_',
  'AGENTE_',
  'FINALIZADO',
  'CANCELADO',
  'TIMEOUT',
];

async function extractAllData(userMessage, config, contextoActual = null) {
  try {
    let prompt = PROMPTS.EXTRACT_ALL;
    if (contextoActual) {
      // Validar contextoActual contra whitelist de estados conocidos
      const isValid = VALID_STATE_PREFIXES.some((p) => String(contextoActual).startsWith(p));
      if (isValid) {
        prompt = prompt.replace(
          'CONTEXTO: El usuario está reportando fallas',
          `CONTEXTO: El usuario está reportando fallas. Estado actual del flujo: ${contextoActual}`
        );
      }
    }

    const response = await sendMessage(prompt, sanitizeForLLM(userMessage, { maxLength: 1000 }));

    logger.ai('Azure OpenAI extractAllData - Respuesta recibida', {
      responseLength: response.length,
    });

    const parsed = parseJsonResponse(response);
    if (parsed) {
      // Validar código SAP (5-10 dígitos)
      let codigoSap = parsed.codigo_sap;
      if (codigoSap) {
        const soloDigitos = String(codigoSap).replace(/\D/g, '');
        if (soloDigitos.length < 5 || soloDigitos.length > 10) {
          codigoSap = null;
        } else {
          codigoSap = soloDigitos;
        }
      }

      return {
        tipo_equipo: parsed.tipo_equipo || null,
        codigo_sap: codigoSap,
        numero_empleado: parsed.numero_empleado || null,
        problema: parsed.problema || null,
        intencion: parsed.intencion || 'OTRO',
        confianza: parsed.confianza || config.confidence.low,
        datos_encontrados: parsed.datos_encontrados || [],
        es_modificacion: parsed.es_modificacion || false,
        campo_modificado: parsed.campo_modificado || null,
        razon: parsed.razon || 'Sin razón especificada',
      };
    }

    return {
      tipo_equipo: null,
      codigo_sap: null,
      numero_empleado: null,
      problema: null,
      intencion: 'OTRO',
      confianza: config.confidence.minimum,
      datos_encontrados: [],
      es_modificacion: false,
      campo_modificado: null,
      razon: 'No se pudo parsear la respuesta de Azure OpenAI',
    };
  } catch (error) {
    logger.error('Error en Azure OpenAI extractAllData', error, {
      service: 'AzureOpenAI',
      operation: 'extractAllData',
    });
    return {
      tipo_equipo: null,
      codigo_sap: null,
      numero_empleado: null,
      problema: null,
      intencion: 'OTRO',
      confianza: 0,
      datos_encontrados: [],
      es_modificacion: false,
      campo_modificado: null,
      razon: 'Error al llamar a Azure OpenAI',
    };
  }
}

/**
 * Analiza una imagen y extrae información relevante
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} userText - Texto opcional del usuario (caption)
 * @param {Object} config - Configuración
 * @returns {Object} - Datos extraídos de la imagen
 */
async function analyzeImageWithVision(imageBuffer, userText, config) {
  try {
    // Convertir buffer a base64
    const base64Image = imageBuffer.toString('base64');

    // Crear el prompt para análisis de imagen (mejorado para detectar problemas visuales)
    const visionPrompt = `Eres un asistente experto que analiza imágenes de equipos y vehículos para detectar problemas y extraer información.

CONTEXTO: Los usuarios envían fotos de refrigeradores comerciales o vehículos (camiones, camionetas) que presentan fallas o problemas.

INSTRUCCIONES IMPORTANTES:
1. PRIORIDAD ALTA - Detectar problemas visuales:
   - Llantas: ponchadas, desinfladas, dañadas, con objetos clavados
   - Daños físicos: golpes, abolladuras, rasguños, partes rotas
   - Fugas: aceite, refrigerante, combustible, agua
   - Motor: humo, cables sueltos, piezas dañadas
   - Carrocería: vidrios rotos, luces dañadas, espejos rotos
   - Refrigeradores: fugas de gas, acumulación de hielo, puertas dañadas

2. Extraer códigos si son visibles:
   - Códigos SAP (5-10 dígitos)
   - Números de serie
   - Placas de vehículos

3. Si el usuario menciona un problema en el texto, CONFIRMAR si la imagen muestra ese problema

IMPORTANTE: Si ves CUALQUIER problema visual (llanta ponchada, daño, fuga, etc.), SIEMPRE reportarlo en el campo "problema".

Responde SIEMPRE con JSON en este formato:
{
  "tipo_equipo": "REFRIGERADOR|VEHICULO|OTRO|null",
  "codigo_sap": "código si es visible o null",
  "numero_empleado": "número si es visible o null",
  "problema": "descripción específica del problema visto en la imagen o mencionado por el usuario",
  "informacion_visual": "descripción detallada de lo que ves en la imagen",
  "codigos_visibles": ["lista de códigos encontrados"],
  "confianza": 0-100,
  "calidad_imagen": "alta|media|baja",
  "datos_encontrados": ["lista de campos encontrados: tipo_equipo, problema, codigo_sap, etc."]
}

REGLAS para calidad_imagen:
- "baja": imagen borrosa, muy oscura, sin enfoque, no se distinguen detalles relevantes
- "media": imagen legible pero con problemas menores de enfoque o iluminación
- "alta": imagen clara, bien enfocada y con buena iluminación`;

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: visionPrompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          },
          {
            type: 'text',
            text: `Texto del usuario: ${sanitizeForLLM(userText || 'Sin texto adicional', { maxLength: 500 })}`,
          },
        ],
      },
    ];

    logger.ai('Azure OpenAI Vision - Enviando imagen para análisis');

    const response = await client.chat.completions.create({
      model: deploymentName,
      messages: messages,
      temperature: 0.3,
      max_tokens: 400, // Vision JSON: 100-250 tokens típicos
    });

    const content = response.choices[0]?.message?.content || '';

    // Capturar uso de tokens para monitoreo de costos
    if (response.usage) {
      logger.info('Azure OpenAI Vision - Token usage', {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      });
    }

    logger.ai('Azure OpenAI Vision - Respuesta recibida', { responseLength: content.length });

    const parsed = parseJsonResponse(content);
    if (parsed) {
      // Validar código SAP
      let codigoSap = parsed.codigo_sap;
      if (codigoSap) {
        const soloDigitos = String(codigoSap).replace(/\D/g, '');
        if (soloDigitos.length >= 5 && soloDigitos.length <= 10) {
          codigoSap = soloDigitos;
        } else {
          codigoSap = null;
        }
      }

      return {
        tipo_equipo: parsed.tipo_equipo || null,
        codigo_sap: codigoSap,
        numero_empleado: parsed.numero_empleado || null,
        problema: parsed.problema || null,
        informacion_visual: parsed.informacion_visual || '',
        codigos_visibles: parsed.codigos_visibles || [],
        confianza: parsed.confianza || config.confidence.low,
        calidad_imagen: parsed.calidad_imagen || null,
        datos_encontrados: parsed.datos_encontrados || [],
      };
    }

    return {
      tipo_equipo: null,
      codigo_sap: null,
      numero_empleado: null,
      problema: null,
      informacion_visual: '',
      codigos_visibles: [],
      confianza: config.confidence.minimum,
      calidad_imagen: null,
      datos_encontrados: [],
    };
  } catch (error) {
    logger.error('Error en Azure OpenAI Vision', error, {
      service: 'AzureOpenAI',
      operation: 'analyzeImageWithVision',
    });
    return {
      tipo_equipo: null,
      codigo_sap: null,
      numero_empleado: null,
      problema: null,
      informacion_visual: '',
      codigos_visibles: [],
      confianza: 0,
      calidad_imagen: null,
      datos_encontrados: [],
    };
  }
}

/**
 * Retorna el nombre del provider
 */
function getName() {
  return 'azure-openai';
}

module.exports = {
  initialize,
  detectIntent,
  interpretTerm,
  extractStructuredData,
  extractAllData,
  analyzeImageWithVision,
  getName,
};
