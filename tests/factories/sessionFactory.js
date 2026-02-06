/**
 * Factory: Session Objects
 * Crea objetos de sesion para testing
 */

function createSession(overrides = {}) {
  return {
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
    NombreUsuario: 'Test User',
    ...overrides,
  };
}

function createActiveRefriSession(telefono = '+5215512345678', overrides = {}) {
  return createSession({
    Telefono: telefono,
    EstadoId: 23,
    Estado: 'REFRIGERADOR_ACTIVO',
    TipoReporteId: 1,
    TipoReporte: 'REFRIGERADOR',
    DatosTemp: JSON.stringify({
      tipoReporte: 'REFRIGERADOR',
      camposRequeridos: {
        codigoSAP: { valor: null, completo: false },
        problema: { valor: null, completo: false },
      },
      campoSolicitado: 'codigoSAP',
    }),
    Version: 2,
    ...overrides,
  });
}

function createActiveVehiculoSession(telefono = '+5215512345678', overrides = {}) {
  return createSession({
    Telefono: telefono,
    EstadoId: 24,
    Estado: 'VEHICULO_ACTIVO',
    TipoReporteId: 2,
    TipoReporte: 'VEHICULO',
    DatosTemp: JSON.stringify({
      tipoReporte: 'VEHICULO',
      camposRequeridos: {
        numeroEmpleado: { valor: null, completo: false },
        codigoSAP: { valor: null, completo: false },
        problema: { valor: null, completo: false },
        ubicacion: { valor: null, completo: false },
      },
      campoSolicitado: 'numeroEmpleado',
    }),
    Version: 2,
    ...overrides,
  });
}

function createEncuestaSession(telefono = '+5215512345678', pregunta = 1) {
  const estados = {
    1: 'ENCUESTA_PREGUNTA_1',
    2: 'ENCUESTA_PREGUNTA_2',
    3: 'ENCUESTA_PREGUNTA_3',
    4: 'ENCUESTA_PREGUNTA_4',
    5: 'ENCUESTA_PREGUNTA_5',
    6: 'ENCUESTA_PREGUNTA_6',
  };
  return createSession({
    Telefono: telefono,
    Estado: estados[pregunta] || 'ENCUESTA_INVITACION',
    DatosTemp: JSON.stringify({ encuestaId: 1, preguntaActual: pregunta }),
    Version: pregunta + 1,
  });
}

function createTimedOutSession(telefono = '+5215512345678') {
  const thirtyMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
  return createSession({
    Telefono: telefono,
    Estado: 'REFRIGERADOR_ACTIVO',
    UltimaActividad: thirtyMinutesAgo,
    Version: 3,
  });
}

function createConsultaSession(telefono = '+5215512345678') {
  return createSession({
    Telefono: telefono,
    Estado: 'CONSULTA_ESPERA_TICKET',
    Version: 2,
  });
}

module.exports = {
  createSession,
  createActiveRefriSession,
  createActiveVehiculoSession,
  createEncuestaSession,
  createTimedOutSession,
  createConsultaSession,
};
