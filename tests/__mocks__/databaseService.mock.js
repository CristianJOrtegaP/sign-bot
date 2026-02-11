/**
 * Mock: Database Service (Facade)
 * Simula operaciones de BD con almacenamiento en memoria
 */

const _sessions = new Map();
const _messages = [];
const _processedMessages = new Set();
const _documentos = new Map();
let _nextDocumentoId = 1;

const defaultSession = {
  SesionId: 1,
  Telefono: '+5215512345678',
  EstadoId: 1,
  Estado: 'INICIO',
  DatosTemp: null,
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

  // ============================================================
  // Documento / Firma operations
  // ============================================================

  getDocumentoById: jest.fn(async (id) => {
    return _documentos.get(id) || null;
  }),

  getDocumentoPorEnvelope: jest.fn(async (envelopeId) => {
    for (const doc of _documentos.values()) {
      if (doc.EnvelopeId === envelopeId) {
        return doc;
      }
    }
    return null;
  }),

  getDocumentosPorTelefono: jest.fn(async (telefono) => {
    const docs = [];
    for (const doc of _documentos.values()) {
      if (doc.ClienteTelefono === telefono) {
        docs.push(doc);
      }
    }
    return docs;
  }),

  // Alias utilizado por consultaDocumentosFlow
  getDocumentosFirmaPorTelefono: jest.fn(async (telefono) => {
    const docs = [];
    for (const doc of _documentos.values()) {
      if (doc.ClienteTelefono === telefono) {
        docs.push(doc);
      }
    }
    return docs;
  }),

  crearDocumento: jest.fn(async (data) => {
    const id = _nextDocumentoId++;
    const doc = { ...data, DocumentoFirmaId: id };
    _documentos.set(id, doc);
    return { DocumentoId: id };
  }),

  actualizarEstadoDocumento: jest.fn(async (id, estado, motivo) => {
    const doc = _documentos.get(id);
    if (doc) {
      doc.EstadoDocumento = estado;
      if (motivo) {
        doc.MotivoRechazo = motivo;
      }
      _documentos.set(id, doc);
    }
    return true;
  }),

  updateDocumentoFirmaEstado: jest.fn(async (id, estado, motivo) => {
    const doc = _documentos.get(id);
    if (doc) {
      doc.EstadoDocumento = estado;
      if (motivo) {
        doc.MotivoRechazo = motivo;
      }
      _documentos.set(id, doc);
    }
    return true;
  }),

  obtenerPendientesRecordatorio: jest.fn(async () => []),
  obtenerPendientesReporteSap: jest.fn(async () => []),
  obtenerParaHousekeeping: jest.fn(async () => []),

  obtenerEstadisticas: jest.fn(async () => ({
    total: 0,
    porEstado: {},
    porTipo: {},
  })),

  // Legacy (used by FlexibleFlowContext)
  getEquipoBySAP: jest.fn().mockResolvedValue(null),

  clearSessionCache: jest.fn(),

  // ============================================================
  // Repositories
  // ============================================================

  repositories: {
    documentosFirma: {
      getById: jest.fn(async (id) => _documentos.get(id) || null),
      getByEnvelopeId: jest.fn(async (envelopeId) => {
        for (const doc of _documentos.values()) {
          if (doc.EnvelopeId === envelopeId) {
            return doc;
          }
        }
        return null;
      }),
      getByTelefono: jest.fn(async (telefono) => {
        const docs = [];
        for (const doc of _documentos.values()) {
          if (doc.ClienteTelefono === telefono) {
            docs.push(doc);
          }
        }
        return docs;
      }),
      create: jest.fn(async (data) => {
        const id = _nextDocumentoId++;
        const doc = { ...data, DocumentoFirmaId: id };
        _documentos.set(id, doc);
        return doc;
      }),
      updateEstado: jest.fn(async (id, estado, motivo) => {
        const doc = _documentos.get(id);
        if (doc) {
          doc.EstadoDocumento = estado;
          if (motivo) {
            doc.MotivoRechazo = motivo;
          }
          _documentos.set(id, doc);
        }
        return true;
      }),
      getPendientesRecordatorio: jest.fn(async () => []),
      getPendientesReporteSap: jest.fn(async () => []),
      getParaHousekeeping: jest.fn(async () => []),
    },
    eventosDocuSign: {
      create: jest.fn(async (data) => ({ EventoId: 1, ...data })),
      getByEnvelopeId: jest.fn(async () => []),
      exists: jest.fn(async () => false),
    },
    sesiones: {
      getSession: jest.fn(
        async (tel) => _sessions.get(tel) || { ...defaultSession, Telefono: tel }
      ),
    },
  },

  // ============================================================
  // Helpers para tests
  // ============================================================

  __setSession(tel, session) {
    _sessions.set(tel, { ...defaultSession, ...session, Telefono: tel });
  },
  __getStoredSession(tel) {
    return _sessions.get(tel) || null;
  },
  __setDocumento(id, documento) {
    _documentos.set(id, { DocumentoFirmaId: id, ...documento });
  },
  __getStoredDocumento(id) {
    return _documentos.get(id) || null;
  },
  __reset() {
    _sessions.clear();
    _messages.length = 0;
    _processedMessages.clear();
    _documentos.clear();
    _nextDocumentoId = 1;

    // Reset all jest.fn() mocks
    const resetMocks = (obj) => {
      Object.values(obj).forEach((fn) => {
        if (typeof fn === 'function' && fn.mockClear) {
          fn.mockClear();
        } else if (typeof fn === 'object' && fn !== null && !Buffer.isBuffer(fn)) {
          resetMocks(fn);
        }
      });
    };
    resetMocks(dbMock);
  },
};

module.exports = dbMock;
