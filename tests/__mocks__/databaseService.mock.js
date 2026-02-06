/**
 * Mock: Database Service (Facade)
 * Simula operaciones de BD con almacenamiento en memoria
 */

const _sessions = new Map();
const _messages = [];
const _processedMessages = new Set();

const defaultSession = {
  SesionId: 1,
  Telefono: '+5215512345678',
  EstadoId: 1,
  Estado: 'INICIO',
  TipoReporteId: null,
  TipoReporte: null,
  DatosTemp: null,
  EquipoIdTemp: null,
  EquipoId: null,
  ContadorMensajes: 0,
  UltimoResetContador: new Date(),
  FechaCreacion: new Date(),
  UltimaActividad: new Date(),
  Version: 1,
  NombreUsuario: null,
};

const dbMock = {
  getSession: jest.fn(async (tel) => {
    return _sessions.get(tel) || { ...defaultSession, Telefono: tel };
  }),

  getSessionFresh: jest.fn(async (tel) => {
    return _sessions.get(tel) || { ...defaultSession, Telefono: tel };
  }),

  updateSession: jest.fn(
    async (tel, estado, datos, equipoId, origen, motivo, reporteId, version) => {
      const current = _sessions.get(tel) || { ...defaultSession, Telefono: tel };
      if (version !== undefined && version !== null && current.Version !== version) {
        const { ConcurrencyError } = require('../../core/errors');
        throw new ConcurrencyError(`Version mismatch: expected ${version}, got ${current.Version}`);
      }
      const updated = {
        ...current,
        Estado: estado,
        DatosTemp: datos
          ? typeof datos === 'string'
            ? datos
            : JSON.stringify(datos)
          : current.DatosTemp,
        EquipoIdTemp: equipoId !== undefined ? equipoId : current.EquipoIdTemp,
        Version: (current.Version || 1) + 1,
        UltimaActividad: new Date(),
      };
      _sessions.set(tel, updated);
      return updated;
    }
  ),

  saveMessage: jest.fn().mockResolvedValue(undefined),
  updateLastActivity: jest.fn().mockResolvedValue(undefined),
  updateUserName: jest.fn().mockResolvedValue(undefined),

  registerMessageAtomic: jest.fn(async (msgId) => {
    if (_processedMessages.has(msgId)) {
      return { isDuplicate: true, retryCount: 1 };
    }
    _processedMessages.add(msgId);
    return { isDuplicate: false, retryCount: 0 };
  }),

  isMessageProcessed: jest.fn(async (msgId) => _processedMessages.has(msgId)),

  getEquipoBySAP: jest.fn(async (sap) => {
    if (sap === '1234567') {
      return {
        EquipoId: 100,
        CodigoSAP: '1234567',
        Tipo: 'REFRIGERADOR',
        Marca: 'Imbera',
        Modelo: 'VR-17',
        UbicacionDescripcion: 'Tienda La Esquina',
        ClienteNombre: 'Juan Pérez',
        Activo: true,
      };
    }
    return null;
  }),

  createReporte: jest.fn(async () => ({
    ReporteId: 1,
    NumeroTicket: 'TKT-00000001',
  })),

  getReportesByTelefono: jest.fn(async () => []),
  getReporteByTicket: jest.fn(async () => null),
  clearSessionCache: jest.fn(),

  repositories: {
    encuestas: {
      getReportesPendientesEncuesta: jest.fn(async () => []),
      create: jest.fn(async () => ({
        encuestaId: 1,
        tipoEncuesta: { Codigo: 'SAT' },
        preguntas: [],
      })),
      updateEstado: jest.fn().mockResolvedValue(undefined),
      expirarSinRespuesta: jest.fn(async () => 0),
      getActivaByTelefono: jest.fn(async () => null),
    },
    sesiones: {
      getSession: jest.fn(
        async (tel) => _sessions.get(tel) || { ...defaultSession, Telefono: tel }
      ),
    },
  },

  // Helpers para tests
  __setSession(tel, session) {
    _sessions.set(tel, { ...defaultSession, ...session, Telefono: tel });
  },
  __getStoredSession(tel) {
    return _sessions.get(tel) || null;
  },
  __reset() {
    _sessions.clear();
    _messages.length = 0;
    _processedMessages.clear();
    Object.values(dbMock).forEach((fn) => {
      if (typeof fn === 'function' && fn.mockClear) {
        fn.mockClear();
      }
    });
  },
};

module.exports = dbMock;
