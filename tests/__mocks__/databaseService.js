/**
 * Mock - Database Service
 * Simula todas las funciones del servicio de base de datos
 */

// Almacenamiento en memoria para simular BD
const sessions = new Map();
const equipos = new Map();
const reportes = new Map();
const messages = [];
const processedMessageIds = new Set();

// Datos de ejemplo
const sampleEquipo = {
  EquipoId: 1,
  CodigoSAP: '1234567',
  Modelo: 'Refrigerador Industrial',
  Marca: 'Imbera',
  NombreCliente: 'OXXO Reforma 123',
  ClienteId: 100,
  Ubicacion: 'CDMX, Col. Roma',
};

const sampleSession = {
  SesionId: 1,
  Telefono: '+5215512345678',
  Estado: 'INICIO',
  EstadoId: 1,
  DatosTemp: null,
  EquipoIdTemp: null,
  UltimaActividad: new Date(),
};

// Inicializar con datos de ejemplo
equipos.set('1234567', sampleEquipo);
equipos.set('7654321', {
  ...sampleEquipo,
  EquipoId: 2,
  CodigoSAP: '7654321',
  NombreCliente: 'OXXO Centro',
});

let ticketCounter = 1000;
let reporteIdCounter = 1;

const mockDatabaseService = {
  // Reset para tests
  __reset: () => {
    sessions.clear();
    reportes.clear();
    messages.length = 0;
    processedMessageIds.clear();
    ticketCounter = 1000;
    reporteIdCounter = 1;
  },

  // Helpers para tests
  __setSession: (telefono, sessionData) => {
    sessions.set(telefono, { ...sampleSession, ...sessionData, Telefono: telefono });
  },

  __getSession: (telefono) => sessions.get(telefono),

  __setEquipo: (codigoSAP, equipoData) => {
    equipos.set(codigoSAP, { ...sampleEquipo, ...equipoData, CodigoSAP: codigoSAP });
  },

  __addReporte: (reporte) => {
    reportes.set(reporte.NumeroTicket, reporte);
  },

  __getMessages: () => [...messages],

  // ========== Funciones de Equipo ==========
  getEquipoBySAP: jest.fn().mockImplementation(async (codigoSAP) => {
    return equipos.get(codigoSAP) || null;
  }),

  getEquipoById: jest.fn().mockImplementation(async (equipoId) => {
    for (const equipo of equipos.values()) {
      if (equipo.EquipoId === equipoId) {
        return equipo;
      }
    }
    return null;
  }),

  searchEquiposBySAP: jest.fn().mockImplementation(async (pattern, limit = 10) => {
    const results = [];
    for (const equipo of equipos.values()) {
      if (equipo.CodigoSAP.includes(pattern)) {
        results.push(equipo);
        if (results.length >= limit) {
          break;
        }
      }
    }
    return results;
  }),

  // ========== Funciones de Reporte ==========
  createReporte: jest
    .fn()
    .mockImplementation(async (equipoId, clienteId, telefono, descripcion, imagenUrl) => {
      const ticket = `TKT${++ticketCounter}`;
      const reporte = {
        ReporteId: ++reporteIdCounter,
        NumeroTicket: ticket,
        EquipoId: equipoId,
        ClienteId: clienteId,
        Telefono: telefono,
        Descripcion: descripcion,
        ImagenUrl: imagenUrl,
        Estado: 'PENDIENTE',
        FechaCreacion: new Date(),
      };
      reportes.set(ticket, reporte);
      return ticket;
    }),

  createReporteVehiculo: jest
    .fn()
    .mockImplementation(async (codigoSAP, numeroEmpleado, telefono, descripcion, imagenUrl) => {
      const ticket = `TKT${++ticketCounter}`;
      const reporte = {
        ReporteId: ++reporteIdCounter,
        NumeroTicket: ticket,
        CodigoSAPVehiculo: codigoSAP,
        NumeroEmpleado: numeroEmpleado,
        Telefono: telefono,
        Descripcion: descripcion,
        ImagenUrl: imagenUrl,
        Estado: 'PENDIENTE',
        FechaCreacion: new Date(),
      };
      reportes.set(ticket, reporte);
      return ticket;
    }),

  getReporteByTicket: jest.fn().mockImplementation(async (numeroTicket) => {
    return reportes.get(numeroTicket) || null;
  }),

  getReportesByTelefono: jest.fn().mockImplementation(async (telefono, limit = 10) => {
    const results = [];
    for (const reporte of reportes.values()) {
      if (reporte.Telefono === telefono) {
        results.push(reporte);
        if (results.length >= limit) {
          break;
        }
      }
    }
    return results;
  }),

  updateReporteEstado: jest.fn().mockImplementation(async (numeroTicket, nuevoEstado) => {
    const reporte = reportes.get(numeroTicket);
    if (reporte) {
      reporte.Estado = nuevoEstado;
      return true;
    }
    return false;
  }),

  // ========== Funciones de Sesión ==========
  getSession: jest.fn().mockImplementation(async (telefono) => {
    if (!sessions.has(telefono)) {
      sessions.set(telefono, { ...sampleSession, Telefono: telefono });
    }
    return sessions.get(telefono);
  }),

  // Versión sin caché (para evitar race conditions)
  getSessionFresh: jest.fn().mockImplementation(async (telefono) => {
    if (!sessions.has(telefono)) {
      sessions.set(telefono, { ...sampleSession, Telefono: telefono });
    }
    return sessions.get(telefono);
  }),

  updateSession: jest
    .fn()
    .mockImplementation(
      async (
        telefono,
        estado,
        datosTemp,
        equipoIdTemp,
        _origenAccion,
        _descripcion,
        _reporteId
      ) => {
        const session = sessions.get(telefono) || { ...sampleSession, Telefono: telefono };
        session.Estado = estado;
        session.DatosTemp = datosTemp ? JSON.stringify(datosTemp) : null;
        session.EquipoIdTemp = equipoIdTemp;
        session.UltimaActividad = new Date();
        sessions.set(telefono, session);
        return session;
      }
    ),

  updateLastActivity: jest.fn().mockImplementation(async (telefono) => {
    const session = sessions.get(telefono);
    if (session) {
      session.UltimaActividad = new Date();
    }
    return true;
  }),

  saveMessage: jest
    .fn()
    .mockImplementation(
      async (telefono, tipo, contenido, tipoContenido, intencionDetectada, confianzaIA) => {
        messages.push({
          telefono,
          tipo,
          contenido,
          tipoContenido,
          intencionDetectada,
          confianzaIA,
          timestamp: new Date(),
        });
        return true;
      }
    ),

  updateImagePlaceholder: jest.fn().mockImplementation(async (telefono, imageId, imagenUrl) => {
    // Buscar y actualizar el placeholder en los mensajes
    const placeholderPattern = `[IMG_PLACEHOLDER:${imageId}]`;
    const messageIndex = messages.findIndex(
      (m) => m.telefono === telefono && m.contenido === placeholderPattern
    );
    if (messageIndex >= 0) {
      messages[messageIndex].contenido = imagenUrl;
      return true;
    }
    return false;
  }),

  checkSpam: jest.fn().mockImplementation(async (_telefono) => {
    return { esSpam: false, totalMensajes: 5, razon: null };
  }),

  isMessageProcessed: jest.fn().mockImplementation(async (messageId) => {
    if (processedMessageIds.has(messageId)) {
      return true;
    }
    processedMessageIds.add(messageId);
    return false;
  }),

  cleanOldProcessedMessages: jest.fn().mockResolvedValue(0),

  // ========== Funciones de Timeout ==========
  getSessionsNeedingWarning: jest.fn().mockResolvedValue([]),
  getSessionsToClose: jest.fn().mockResolvedValue([]),
  markSessionWarningSet: jest.fn().mockResolvedValue(true),

  // ========== Funciones de Cache ==========
  clearEquipoCache: jest.fn().mockReturnValue(true),
  clearSessionCache: jest.fn().mockReturnValue(true),
  getCacheStats: jest.fn().mockReturnValue({
    equipos: { size: 0, hits: 0, misses: 0 },
    sesiones: { size: 0, hits: 0, misses: 0 },
    reportes: { size: 0, hits: 0, misses: 0 },
  }),
  startCacheCleanup: jest.fn(),
  stopCacheCleanup: jest.fn(),

  // Acceso a repositorios (mock)
  repositories: {
    sesiones: {},
    equipos: {},
    reportes: {},
  },
};

module.exports = mockDatabaseService;
