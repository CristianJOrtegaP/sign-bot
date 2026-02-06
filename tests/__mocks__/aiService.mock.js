/**
 * Mock: AI Service (Facade)
 * Respuestas configurables para intent detection y data extraction
 */

let _detectIntentResponse = {
  intencion: 'OTRO',
  confianza: 0.5,
  metodo: 'mock',
  datos_extraidos: {},
};

let _extractAllDataResponse = {
  intencion: 'REPORTAR_FALLA',
  tipo_equipo: 'REFRIGERADOR',
  codigo_sap: null,
  numero_empleado: null,
  problema: null,
  confianza: 0.8,
  datos_encontrados: [],
  metodo: 'mock',
};

const aiMock = {
  detectIntent: jest.fn(async () => ({ ..._detectIntentResponse })),
  interpretTerm: jest.fn(async () => ({
    intencion: 'OTRO',
    confianza: 0.5,
    razon: 'mock',
    metodo: 'mock',
  })),
  extractStructuredData: jest.fn(async () => ({
    confianza: 0.8,
    datos_encontrados: [],
    metodo: 'mock',
  })),
  extractAllData: jest.fn(async () => ({ ..._extractAllDataResponse })),
  analyzeImageWithVision: jest.fn(async () => ({
    tipo_equipo: 'REFRIGERADOR',
    codigo_sap: null,
    problema: null,
    confianza: 0.5,
    codigos_visibles: [],
    metodo: 'mock',
  })),
  isEnabled: jest.fn(() => true),
  getProviderName: jest.fn(() => 'mock'),
  initializeProvider: jest.fn(),

  // Helpers
  __setDetectIntentResponse(response) {
    _detectIntentResponse = { ..._detectIntentResponse, ...response };
  },
  __setExtractResponse(response) {
    _extractAllDataResponse = { ..._extractAllDataResponse, ...response };
  },
  __reset() {
    _detectIntentResponse = {
      intencion: 'OTRO',
      confianza: 0.5,
      metodo: 'mock',
      datos_extraidos: {},
    };
    _extractAllDataResponse = {
      intencion: 'REPORTAR_FALLA',
      tipo_equipo: 'REFRIGERADOR',
      codigo_sap: null,
      numero_empleado: null,
      problema: null,
      confianza: 0.8,
      datos_encontrados: [],
      metodo: 'mock',
    };
    Object.values(aiMock).forEach((fn) => {
      if (typeof fn === 'function' && fn.mockClear) {
        fn.mockClear();
      }
    });
  },
};

module.exports = aiMock;
