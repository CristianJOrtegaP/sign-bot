/**
 * Test Fixtures - Database Records
 * Datos de ejemplo para simular registros de base de datos
 */

/**
 * Equipos de refrigeracion
 */
const refrigeradores = {
    valid: {
        EquipoId: 1,
        CodigoSAP: '1234567',
        Modelo: 'Refrigerador Industrial VR-42',
        Marca: 'Imbera',
        Serie: 'IMB-2024-001',
        NombreCliente: 'OXXO Reforma 123',
        ClienteId: 100,
        DireccionCliente: 'Av. Reforma 123, Col. Juarez, CDMX',
        Ubicacion: 'Interior tienda',
        FechaInstalacion: new Date('2023-06-15'),
        Activo: true
    },
    inactive: {
        EquipoId: 2,
        CodigoSAP: '9999999',
        Modelo: 'Refrigerador Obsoleto',
        Marca: 'Vieja Marca',
        NombreCliente: 'Cliente Inactivo',
        ClienteId: 101,
        Activo: false
    },
    withHistory: {
        EquipoId: 3,
        CodigoSAP: '7654321',
        Modelo: 'Enfriador Vertical EV-200',
        Marca: 'Metalfrio',
        NombreCliente: 'Bodega Aurrera Centro',
        ClienteId: 102,
        Activo: true,
        TotalReportes: 5,
        UltimoReporte: new Date('2024-01-10')
    }
};

/**
 * Vehiculos de reparto
 */
const vehiculos = {
    valid: {
        VehiculoId: 1,
        CodigoSAP: 'VH-12345',
        Placa: 'ABC-123-XY',
        Marca: 'Chevrolet',
        Modelo: 'NHR',
        Anio: 2022,
        NumeroEmpleadoAsignado: '12345',
        NombreEmpleado: 'Juan Perez',
        CentroDistribucion: 'CEDIS Norte',
        Activo: true
    },
    unassigned: {
        VehiculoId: 2,
        CodigoSAP: 'VH-99999',
        Placa: 'XYZ-999-AB',
        Marca: 'Ford',
        Modelo: 'Transit',
        Anio: 2021,
        NumeroEmpleadoAsignado: null,
        CentroDistribucion: 'CEDIS Sur',
        Activo: true
    }
};

/**
 * Sesiones de chat
 */
const sesiones = {
    new: {
        SesionId: 1,
        Telefono: '+5215512345678',
        Estado: 'INICIO',
        EstadoId: 1,
        DatosTemp: null,
        EquipoIdTemp: null,
        UltimaActividad: new Date(),
        AvisoTimeoutEnviado: false,
        CreatedAt: new Date()
    },
    inProgress: {
        SesionId: 2,
        Telefono: '+5215598765432',
        Estado: 'REFRI_ESPERA_SAP',
        EstadoId: 3,
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
        EquipoIdTemp: null,
        UltimaActividad: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago
        AvisoTimeoutEnviado: false
    },
    nearTimeout: {
        SesionId: 3,
        Telefono: '+5215511111111',
        Estado: 'REFRI_ESPERA_DESCRIPCION',
        EstadoId: 5,
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR', codigoSAP: '1234567' }),
        EquipoIdTemp: 1,
        UltimaActividad: new Date(Date.now() - 26 * 60 * 1000), // 26 mins ago
        AvisoTimeoutEnviado: false
    },
    timedOut: {
        SesionId: 4,
        Telefono: '+5215522222222',
        Estado: 'REFRI_ESPERA_SAP',
        EstadoId: 3,
        DatosTemp: null,
        EquipoIdTemp: null,
        UltimaActividad: new Date(Date.now() - 35 * 60 * 1000), // 35 mins ago
        AvisoTimeoutEnviado: true
    },
    withEncuesta: {
        SesionId: 5,
        Telefono: '+5215533333333',
        Estado: 'ENCUESTA_PREGUNTA_1',
        EstadoId: 20,
        DatosTemp: JSON.stringify({ encuestaId: 1, preguntaActual: 1 }),
        EquipoIdTemp: null,
        UltimaActividad: new Date()
    }
};

/**
 * Reportes/Tickets
 */
const reportes = {
    pending: {
        ReporteId: 1,
        NumeroTicket: 'TKT1706300001',
        EquipoId: 1,
        ClienteId: 100,
        Telefono: '+5215512345678',
        TipoReporte: 'REFRIGERADOR',
        Descripcion: 'El refrigerador no enfria correctamente',
        ImagenUrl: null,
        Estado: 'PENDIENTE',
        FechaCreacion: new Date('2024-01-27T10:00:00'),
        FechaResolucion: null,
        TecnicoAsignado: null
    },
    inProgress: {
        ReporteId: 2,
        NumeroTicket: 'TKT1706300002',
        EquipoId: 1,
        ClienteId: 100,
        Telefono: '+5215512345678',
        TipoReporte: 'REFRIGERADOR',
        Descripcion: 'Gotea agua',
        Estado: 'EN_PROCESO',
        FechaCreacion: new Date('2024-01-26T15:00:00'),
        TecnicoAsignado: 'Carlos Rodriguez'
    },
    resolved: {
        ReporteId: 3,
        NumeroTicket: 'TKT1706300003',
        EquipoId: 3,
        ClienteId: 102,
        Telefono: '+5215598765432',
        TipoReporte: 'REFRIGERADOR',
        Descripcion: 'No enciende',
        Estado: 'RESUELTO',
        FechaCreacion: new Date('2024-01-25T09:00:00'),
        FechaResolucion: new Date('2024-01-25T14:00:00'),
        TecnicoAsignado: 'Miguel Lopez'
    },
    vehiculo: {
        ReporteId: 4,
        NumeroTicket: 'TKT1706300004',
        VehiculoId: 1,
        Telefono: '+5215512345678',
        TipoReporte: 'VEHICULO',
        NumeroEmpleado: '12345',
        Descripcion: 'Frenos hacen ruido',
        Estado: 'PENDIENTE',
        FechaCreacion: new Date('2024-01-27T11:00:00')
    }
};

/**
 * Encuestas de satisfaccion
 */
const encuestas = {
    pending: {
        EncuestaId: 1,
        ReporteId: 3,
        Telefono: '+5215598765432',
        Estado: 'PENDIENTE',
        FechaEnvio: new Date(),
        FechaExpiracion: new Date(Date.now() + 72 * 60 * 60 * 1000),
        Respuestas: null
    },
    inProgress: {
        EncuestaId: 2,
        ReporteId: 3,
        Telefono: '+5215598765432',
        Estado: 'EN_PROCESO',
        PreguntaActual: 3,
        Respuestas: JSON.stringify({ p1: 5, p2: 4 }),
        FechaInicio: new Date()
    },
    completed: {
        EncuestaId: 3,
        ReporteId: 2,
        Telefono: '+5215512345678',
        Estado: 'COMPLETADA',
        Respuestas: JSON.stringify({
            p1: 5, p2: 5, p3: 4, p4: 5, p5: 5, p6: 5,
            comentario: 'Excelente servicio'
        }),
        PromedioCalificacion: 4.83,
        FechaCompletada: new Date()
    },
    expired: {
        EncuestaId: 4,
        ReporteId: 1,
        Telefono: '+5215511111111',
        Estado: 'EXPIRADA',
        FechaEnvio: new Date(Date.now() - 100 * 60 * 60 * 1000),
        FechaExpiracion: new Date(Date.now() - 28 * 60 * 60 * 1000)
    }
};

/**
 * Mensajes de Dead Letter Queue
 */
const deadLetterMessages = {
    pending: {
        DeadLetterId: 1,
        Telefono: '+5215512345678',
        MessageId: 'wamid.123456789',
        Payload: JSON.stringify({ text: 'Hola' }),
        ErrorMessage: 'Database connection failed',
        Estado: 'PENDING',
        RetryCount: 0,
        NextRetryAt: new Date(),
        CreatedAt: new Date()
    },
    retrying: {
        DeadLetterId: 2,
        Telefono: '+5215598765432',
        MessageId: 'wamid.987654321',
        Payload: JSON.stringify({ text: 'Reporte refrigerador' }),
        ErrorMessage: 'WhatsApp API timeout',
        Estado: 'RETRYING',
        RetryCount: 2,
        NextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
        CreatedAt: new Date(Date.now() - 10 * 60 * 1000)
    },
    failed: {
        DeadLetterId: 3,
        Telefono: '+5215511111111',
        MessageId: 'wamid.111111111',
        Payload: JSON.stringify({ text: 'Test' }),
        ErrorMessage: 'Max retries exceeded',
        Estado: 'FAILED',
        RetryCount: 3,
        CreatedAt: new Date(Date.now() - 60 * 60 * 1000)
    }
};

/**
 * Genera multiples registros para tests de carga
 */
const generateBulkRecords = (count = 100) => {
    const records = {
        equipos: [],
        sesiones: [],
        reportes: []
    };

    for (let i = 0; i < count; i++) {
        records.equipos.push({
            EquipoId: 1000 + i,
            CodigoSAP: String(2000000 + i),
            Modelo: `Refrigerador Test ${i}`,
            Marca: 'TestBrand',
            NombreCliente: `Cliente ${i}`,
            ClienteId: 200 + i,
            Activo: true
        });

        records.sesiones.push({
            SesionId: 1000 + i,
            Telefono: `+52155${String(10000000 + i)}`,
            Estado: 'INICIO',
            UltimaActividad: new Date()
        });

        records.reportes.push({
            ReporteId: 1000 + i,
            NumeroTicket: `TKT${2000000 + i}`,
            EquipoId: 1000 + i,
            ClienteId: 200 + i,
            Telefono: `+52155${String(10000000 + i)}`,
            Estado: 'PENDIENTE',
            FechaCreacion: new Date()
        });
    }

    return records;
};

module.exports = {
    refrigeradores,
    vehiculos,
    sesiones,
    reportes,
    encuestas,
    deadLetterMessages,
    generateBulkRecords
};
