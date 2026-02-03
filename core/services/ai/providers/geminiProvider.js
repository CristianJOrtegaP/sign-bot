/**
 * AC FIXBOT - Gemini AI Provider
 * Implementa la interfaz de IA usando Google Gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../../infrastructure/errorHandler');

let genAI = null;
let model = null;

// Prompts del sistema (compartidos con otros providers)
const PROMPTS = require('./prompts');

/**
 * Inicializa el provider de Gemini
 * @param {Object} config - Configuración del provider
 */
function initialize(config) {
    if (!config.apiKey) {
        throw new Error('GEMINI_API_KEY es requerida para el provider de Gemini');
    }

    genAI = new GoogleGenerativeAI(config.apiKey);
    model = genAI.getGenerativeModel({ model: config.model || 'gemini-2.5-flash' });

    logger.info('Gemini Provider inicializado', { model: config.model });
}

/**
 * Detecta la intención del usuario en un mensaje
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} config - Configuración con umbrales de confianza
 * @returns {Object} - Objeto con la intención detectada
 */
async function detectIntent(userMessage, config) {
    try {
        const chat = model.startChat({
            history: [
                {
                    role: 'user',
                    parts: [{ text: PROMPTS.DETECT_INTENT }]
                },
                {
                    role: 'model',
                    parts: [{ text: 'Entendido. Analizaré los mensajes y responderé solo con JSON.' }]
                }
            ]
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response.text();

        logger.ai('Gemini detectIntent - Respuesta recibida', { responseLength: response.length });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                intencion: parsed.intencion || 'OTRO',
                confianza: parsed.confianza || config.confidence.low,
                datos_extraidos: parsed.datos_extraidos || {}
            };
        }

        return {
            intencion: 'OTRO',
            confianza: config.confidence.low,
            datos_extraidos: {}
        };

    } catch (error) {
        logger.error('Error en Gemini detectIntent', error, { service: 'Gemini', operation: 'detectIntent' });
        return {
            intencion: 'OTRO',
            confianza: 0,
            datos_extraidos: {}
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
        const chat = model.startChat({
            history: [
                {
                    role: 'user',
                    parts: [{ text: PROMPTS.INTERPRET_TERM }]
                },
                {
                    role: 'model',
                    parts: [{ text: 'Entendido. Interpretaré términos y responderé solo con JSON.' }]
                }
            ]
        });

        const result = await chat.sendMessage(`Interpreta este término: "${userText}"`);
        const response = result.response.text();

        logger.ai('Gemini interpretTerm - Respuesta recibida', { responseLength: response.length });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                intencion: parsed.intencion_interpretada || 'OTRO',
                confianza: parsed.confianza || config.confidence.low,
                razon: parsed.razon || 'Sin razón especificada'
            };
        }

        return {
            intencion: 'OTRO',
            confianza: config.confidence.minimum,
            razon: 'No se pudo parsear la respuesta de Gemini'
        };

    } catch (error) {
        logger.error('Error interpretando término con Gemini', error, { service: 'Gemini', operation: 'interpretTerm' });
        return {
            intencion: 'OTRO',
            confianza: 0,
            razon: 'Error al llamar a Gemini'
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
        const chat = model.startChat({
            history: [
                {
                    role: 'user',
                    parts: [{ text: PROMPTS.EXTRACT_STRUCTURED }]
                },
                {
                    role: 'model',
                    parts: [{ text: 'Entendido. Extraeré datos estructurados y responderé solo con JSON.' }]
                }
            ]
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response.text();

        logger.ai('Gemini extractStructuredData - Respuesta recibida', { responseLength: response.length });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                intencion: parsed.intencion || 'OTRO',
                tipo_equipo: parsed.tipo_equipo || 'OTRO',
                problema: parsed.problema || null,
                confianza: parsed.confianza || config.confidence.low,
                razon: parsed.razon || 'Sin razón especificada'
            };
        }

        return {
            intencion: 'OTRO',
            tipo_equipo: 'OTRO',
            problema: null,
            confianza: config.confidence.minimum,
            razon: 'No se pudo parsear la respuesta de Gemini'
        };

    } catch (error) {
        logger.error('Error extrayendo datos estructurados con Gemini', error, { service: 'Gemini', operation: 'extractStructuredData' });
        return {
            intencion: 'OTRO',
            tipo_equipo: 'OTRO',
            problema: null,
            confianza: 0,
            razon: 'Error al llamar a Gemini'
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
async function extractAllData(userMessage, config, contextoActual = null) {
    try {
        let prompt = PROMPTS.EXTRACT_ALL;
        if (contextoActual) {
            prompt = prompt.replace(
                'CONTEXTO: El usuario está reportando fallas',
                `CONTEXTO: El usuario está reportando fallas. Estado actual del flujo: ${contextoActual}`
            );
        }

        const chat = model.startChat({
            history: [
                {
                    role: 'user',
                    parts: [{ text: prompt }]
                },
                {
                    role: 'model',
                    parts: [{ text: 'Entendido. Extraeré toda la información posible y responderé solo con JSON.' }]
                }
            ]
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response.text();

        logger.ai('Gemini extractAllData - Respuesta recibida', { responseLength: response.length });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

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
                razon: parsed.razon || 'Sin razón especificada'
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
            razon: 'No se pudo parsear la respuesta de Gemini'
        };

    } catch (error) {
        logger.error('Error en Gemini extractAllData', error, { service: 'Gemini', operation: 'extractAllData' });
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
            razon: 'Error al llamar a Gemini'
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

        const visionPrompt = `Eres un asistente que analiza imágenes de equipos (refrigeradores, vehículos) para extraer información.

INSTRUCCIONES:
1. Analiza la imagen y el texto del usuario
2. Extrae toda la información relevante que encuentres:
   - Códigos visibles (SAP, serie, barras)
   - Tipo de equipo (refrigerador, camión, etc.)
   - Problemas visibles (daños, fugas, etc.)
   - Números de empleado si son visibles
3. Combina la información de la imagen con el texto del usuario

Texto del usuario: "${userText || 'Sin texto adicional'}"

Responde SIEMPRE con JSON en este formato:
{
  "tipo_equipo": "REFRIGERADOR|VEHICULO|OTRO|null",
  "codigo_sap": "código si es visible o null",
  "numero_empleado": "número si es visible o null",
  "problema": "descripción del problema (de imagen o texto)",
  "informacion_visual": "descripción de lo que ves en la imagen",
  "codigos_visibles": ["lista de códigos encontrados"],
  "confianza": 0-100,
  "datos_encontrados": ["lista de campos encontrados"]
}`;

        logger.ai('Gemini Vision - Enviando imagen para análisis');

        const result = await model.generateContent([
            {
                text: visionPrompt
            },
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            }
        ]);

        const response = result.response.text();
        logger.ai('Gemini Vision - Respuesta recibida', { responseLength: response.length });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

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
                datos_encontrados: parsed.datos_encontrados || []
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
            datos_encontrados: []
        };

    } catch (error) {
        logger.error('Error en Gemini Vision', error, { service: 'Gemini', operation: 'analyzeImageWithVision' });
        return {
            tipo_equipo: null,
            codigo_sap: null,
            numero_empleado: null,
            problema: null,
            informacion_visual: '',
            codigos_visibles: [],
            confianza: 0,
            datos_encontrados: []
        };
    }
}

/**
 * Retorna el nombre del provider
 */
function getName() {
    return 'gemini';
}

module.exports = {
    initialize,
    detectIntent,
    interpretTerm,
    extractStructuredData,
    extractAllData,
    analyzeImageWithVision,
    getName
};
