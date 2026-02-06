/**
 * Factory: Reportes / Tickets
 */

function createReporte(overrides = {}) {
  return {
    ReporteId: 1,
    NumeroTicket: 'TKT-00000001',
    TelefonoReportante: '+5215512345678',
    TipoReporte: 'REFRIGERADOR',
    EstadoReporte: 'PENDIENTE',
    EquipoId: 100,
    CodigoSAP: '1234567',
    Descripcion: 'No enfria correctamente',
    Latitud: null,
    Longitud: null,
    CentroServicioId: null,
    TiempoEstimadoMinutos: null,
    FechaCreacion: new Date(),
    FechaResolucion: null,
    ...overrides,
  };
}

function createReporteResuelto(overrides = {}) {
  const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  return createReporte({
    EstadoReporte: 'RESUELTO',
    FechaResolucion: oneDayAgo,
    CentroServicioId: 1,
    TiempoEstimadoMinutos: 45,
    ...overrides,
  });
}

function createEquipo(overrides = {}) {
  return {
    EquipoId: 100,
    CodigoSAP: '1234567',
    Tipo: 'REFRIGERADOR',
    Marca: 'Imbera',
    Modelo: 'VR-17',
    UbicacionDescripcion: 'Tienda La Esquina - Monterrey',
    ClienteNombre: 'Juan Pérez',
    Activo: true,
    ...overrides,
  };
}

module.exports = { createReporte, createReporteResuelto, createEquipo };
