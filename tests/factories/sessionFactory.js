/**
 * Factory: Session Objects
 * Crea objetos de sesion para testing - Sign Bot
 */

function createSession(overrides = {}) {
  return {
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
    NombreUsuario: 'Test User',
    ...overrides,
  };
}

function createConsultaDocumentosSession(telefono = '+5215512345678', overrides = {}) {
  return createSession({
    Telefono: telefono,
    EstadoId: 10,
    Estado: 'CONSULTA_DOCUMENTOS',
    DatosTemp: JSON.stringify({
      documentos: [],
    }),
    Version: 2,
    ...overrides,
  });
}

function createConsultaDetalleSession(
  telefono = '+5215512345678',
  documentoId = 1,
  overrides = {}
) {
  return createSession({
    Telefono: telefono,
    EstadoId: 11,
    Estado: 'CONSULTA_DETALLE',
    DatosTemp: JSON.stringify({
      documentoFirmaId: documentoId,
      documentos: [],
      documentoSeleccionado: 0,
    }),
    Version: 3,
    ...overrides,
  });
}

function createEsperandoConfirmacionSession(
  telefono = '+5215512345678',
  documentoId = 1,
  overrides = {}
) {
  return createSession({
    Telefono: telefono,
    EstadoId: 12,
    Estado: 'ESPERANDO_CONFIRMACION',
    DatosTemp: JSON.stringify({
      documentoFirmaId: documentoId,
      documentoNombre: 'Contrato Test',
      accion: 'RECHAZO',
    }),
    Version: 2,
    ...overrides,
  });
}

function createTimedOutSession(telefono = '+5215512345678') {
  const thirtyMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
  return createSession({
    Telefono: telefono,
    Estado: 'CONSULTA_DOCUMENTOS',
    UltimaActividad: thirtyMinutesAgo,
    Version: 3,
  });
}

module.exports = {
  createSession,
  createConsultaDocumentosSession,
  createConsultaDetalleSession,
  createEsperandoConfirmacionSession,
  createTimedOutSession,
};
