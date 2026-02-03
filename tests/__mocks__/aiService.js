/**
 * Mock - AI Service
 * Simula todas las funciones del servicio de IA
 */

const mockAiService = {
    // Reset para tests
    __reset: () => {
        mockAiService.detectIntent.mockClear();
        mockAiService.interpretTerm.mockClear();
        mockAiService.extractStructuredData.mockClear();
        mockAiService.extractAllData.mockClear();
    },

    // Configurar respuesta de detectIntent
    __setDetectIntentResponse: (response) => {
        mockAiService.detectIntent.mockResolvedValue(response);
    },

    detectIntent: jest.fn().mockImplementation(async (userMessage) => {
        // Detección básica por patrones
        const msg = userMessage.toLowerCase();

        if (/^(hola|hi|hey|buenos?\s*d[ií]as?|buenas)/.test(msg)) {
            return { intencion: 'SALUDO', confianza: 0.95, metodo: 'mock' };
        }
        if (/refrigerador|refri|nevera|enfriador/.test(msg)) {
            return { intencion: 'TIPO_REFRIGERADOR', confianza: 0.9, metodo: 'mock' };
        }
        if (/veh[ií]culo|carro|auto|camion/.test(msg)) {
            return { intencion: 'TIPO_VEHICULO', confianza: 0.9, metodo: 'mock' };
        }
        if (/no\s*(enfr[ií]a|funciona|prende)|falla|problema/.test(msg)) {
            return { intencion: 'REPORTAR_FALLA', confianza: 0.85, metodo: 'mock' };
        }
        if (/estado|ticket|reporte|consultar/.test(msg)) {
            return { intencion: 'CONSULTAR_ESTADO', confianza: 0.85, metodo: 'mock' };
        }
        if (/adi[oó]s|bye|chao|gracias|terminar/.test(msg)) {
            return { intencion: 'DESPEDIDA', confianza: 0.9, metodo: 'mock' };
        }
        if (/cancelar|cancela|no\s*quiero/.test(msg)) {
            return { intencion: 'CANCELAR', confianza: 0.95, metodo: 'mock' };
        }

        return { intencion: 'OTRO', confianza: 0.5, metodo: 'mock' };
    }),

    interpretTerm: jest.fn().mockImplementation(async (userText) => {
        const text = userText.toLowerCase();

        if (/refri|nevera|cooler|hielera/.test(text)) {
            return {
                intencion: 'TIPO_REFRIGERADOR',
                confianza: 0.85,
                razon: 'Término interpretado como refrigerador'
            };
        }
        if (/carro|auto|cami[oó]n|unidad/.test(text)) {
            return {
                intencion: 'TIPO_VEHICULO',
                confianza: 0.85,
                razon: 'Término interpretado como vehículo'
            };
        }

        return {
            intencion: 'OTRO',
            confianza: 0.4,
            razon: 'Término no reconocido'
        };
    }),

    extractStructuredData: jest.fn().mockImplementation(async (userMessage) => {
        const msg = userMessage.toLowerCase();
        const result = {
            intencion: 'OTRO',
            confianza: 0.5,
            tipo_equipo: null,
            problema: null,
            razon: 'Extracción básica'
        };

        // Detectar tipo de equipo
        if (/refrigerador|refri|nevera/.test(msg)) {
            result.tipo_equipo = 'REFRIGERADOR';
            result.intencion = 'REPORTAR_FALLA';
            result.confianza = 0.8;
        } else if (/veh[ií]culo|carro|auto/.test(msg)) {
            result.tipo_equipo = 'VEHICULO';
            result.intencion = 'REPORTAR_FALLA';
            result.confianza = 0.8;
        }

        // Detectar problema
        if (/no\s*enfr[ií]a/.test(msg)) {
            result.problema = 'No enfría';
        } else if (/no\s*prende/.test(msg)) {
            result.problema = 'No prende';
        } else if (/gotea|fuga/.test(msg)) {
            result.problema = 'Gotea/Fuga';
        } else if (/ruido/.test(msg)) {
            result.problema = 'Hace ruido';
        }

        return result;
    }),

    extractAllData: jest.fn().mockImplementation(async (userMessage, _config, _contextoActual) => {
        const msg = userMessage.toLowerCase();
        const result = {
            tipo_equipo: null,
            codigo_sap: null,
            numero_empleado: null,
            problema: null,
            confianza: 0.5
        };

        // Detectar código SAP (7 dígitos)
        const sapMatch = msg.match(/\b(\d{7})\b/);
        if (sapMatch) {
            result.codigo_sap = sapMatch[1];
            result.confianza = 0.9;
        }

        // Detectar número de empleado (6 dígitos)
        const empMatch = msg.match(/\b(\d{6})\b/);
        if (empMatch) {
            result.numero_empleado = empMatch[1];
        }

        // Detectar tipo de equipo
        if (/refrigerador|refri|nevera/.test(msg)) {
            result.tipo_equipo = 'REFRIGERADOR';
        } else if (/veh[ií]culo|carro|auto/.test(msg)) {
            result.tipo_equipo = 'VEHICULO';
        }

        return result;
    }),

    getProviderName: jest.fn().mockReturnValue('mock-provider'),

    isEnabled: jest.fn().mockReturnValue(true),

    initializeProvider: jest.fn()
};

module.exports = mockAiService;
