/**
 * Tests - Flujo de Vehículo (E2E)
 * Pruebas completas del flujo de conversación para reportes de vehículo
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/ai/intentService', () => ({
    detectIntent: jest.fn()
}));

jest.mock('../../core/services/infrastructure/metricsService', () => ({
    startTimer: jest.fn(() => ({ end: jest.fn() })),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn()
}));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
    recordRequest: jest.fn(),
    isSpamming: jest.fn().mockReturnValue(false)
}));

const messageHandler = require('../../bot/controllers/messageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const intentService = require('../../core/services/ai/intentService');

describe('Flujo Completo - Vehículo', () => {
    const telefono = '+5215512345678';
    let mockContext;

    beforeEach(() => {
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn(),
            log_warn: jest.fn()
        };
        mockContext.log.warn = jest.fn();
        mockContext.log.error = jest.fn();

        intentService.detectIntent.mockResolvedValue({
            intencion: 'OTRO',
            confianza: 0.5,
            metodo: 'mock',
            datos_extraidos: {}
        });
    });

    describe('Flujo Exitoso Completo', () => {
        test('debe completar flujo: Selección → Empleado → SAP → Descripción → Ticket', async () => {
            // PASO 1: Usuario presiona botón de vehículo
            await messageHandler.handleButton(telefono, 'btn_tipo_vehiculo', 'msg_1', mockContext);

            // Verificar: Se pidió número de empleado
            const messages = whatsapp.__getAllMessages();
            const empleadoRequest = messages.find(m =>
                m.text?.includes('Empleado') || m.bodyText?.includes('Empleado')
            );
            expect(empleadoRequest).toBeDefined();

            // PASO 2: Usuario ingresa número de empleado
            whatsapp.__reset();
            db.__setSession(telefono, { Estado: 'VEHICULO_ESPERA_EMPLEADO' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, '123456', 'msg_2', mockContext);

            // Verificar: Se registró empleado y se pidió SAP del vehículo
            const messagesAfterEmpleado = whatsapp.__getAllMessages();
            const sapRequest = messagesAfterEmpleado.find(m =>
                m.text?.includes('SAP') || m.bodyText?.includes('SAP')
            );
            expect(sapRequest).toBeDefined();

            // PASO 3: Usuario ingresa SAP del vehículo
            whatsapp.__reset();
            db.__setSession(telefono, {
                Estado: 'VEHICULO_ESPERA_SAP',
                DatosTemp: JSON.stringify({ numeroEmpleado: '123456', tipoReporte: 'VEHICULO' })
            });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, '7654321', 'msg_3', mockContext);

            // Verificar: Se registró SAP y se pidió descripción
            const messagesAfterSAP = whatsapp.__getAllMessages();
            const descRequest = messagesAfterSAP.find(m =>
                m.text?.includes('problema') || m.bodyText?.includes('problema')
            );
            expect(descRequest).toBeDefined();

            // PASO 4: Usuario describe el problema
            whatsapp.__reset();
            db.__setSession(telefono, {
                Estado: 'VEHICULO_ESPERA_DESCRIPCION',
                DatosTemp: JSON.stringify({
                    numeroEmpleado: '123456',
                    codigoSAPVehiculo: '7654321',
                    tipoReporte: 'VEHICULO'
                })
            });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'No enciende el motor', 'msg_4', mockContext);

            // Verificar: Se pidió ubicación
            const messagesAfterDesc = whatsapp.__getAllMessages();
            const ubicacionRequest = messagesAfterDesc.find(m =>
                m.text?.includes('ubicación') || m.bodyText?.includes('ubicación')
            );
            expect(ubicacionRequest).toBeDefined();

            // PASO 5: Usuario envía ubicación
            whatsapp.__reset();
            db.__setSession(telefono, {
                Estado: 'VEHICULO_ESPERA_UBICACION',
                DatosTemp: JSON.stringify({
                    numeroEmpleado: '123456',
                    codigoSAPVehiculo: '7654321',
                    problemaTemp: 'No enciende el motor',
                    tipoReporte: 'VEHICULO'
                })
            });

            const ubicacion = {
                latitude: 19.4326,
                longitude: -99.1332,
                address: 'CDMX, Mexico'
            };

            await messageHandler.handleLocation(telefono, ubicacion, 'msg_5', mockContext);

            // Verificar: Se creó el ticket de vehículo
            // Los últimos 3 parámetros son: centroServicioId, tiempoEstimadoMinutos, distanciaCentroKm
            // En tests, el repositorio de centros falla así que son null
            expect(db.createReporteVehiculo).toHaveBeenCalledWith(
                '7654321',
                '123456',
                telefono,
                'No enciende el motor',
                null, // imagenUrl
                expect.objectContaining({
                    latitud: 19.4326,
                    longitud: -99.1332
                }),
                null, // centroServicioId
                null, // tiempoEstimadoMinutos
                null  // distanciaCentroKm
            );

            // Verificar: Se envió mensaje con número de ticket
            const finalMessages = whatsapp.__getAllMessages();
            const ticketMessage = finalMessages.find(m =>
                m.text?.includes('TKT') || m.text?.includes('Ticket')
            );
            expect(ticketMessage).toBeDefined();
        });
    });

    describe('Flujo con Número de Empleado Inválido', () => {
        test('debe rechazar número de empleado muy corto (menos de 3 caracteres)', async () => {
            db.__setSession(telefono, { Estado: 'VEHICULO_ESPERA_EMPLEADO' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            // Usuario ingresa número muy corto (menos de 3 caracteres)
            await messageHandler.handleText(telefono, '12', 'msg_1', mockContext);

            // Verificar: Se envió mensaje de error
            const messages = whatsapp.__getAllMessages();
            const errorMessage = messages.find(m =>
                m.text?.includes('inválido') || m.text?.includes('empleado')
            );
            expect(errorMessage).toBeDefined();
        });

        test('debe rechazar número de empleado muy largo (más de 20 caracteres)', async () => {
            db.__setSession(telefono, { Estado: 'VEHICULO_ESPERA_EMPLEADO' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            // Usuario ingresa número muy largo (más de 20 caracteres)
            await messageHandler.handleText(telefono, '123456789012345678901', 'msg_1', mockContext);

            const messages = whatsapp.__getAllMessages();
            const errorMessage = messages.find(m =>
                m.text?.includes('inválido') || m.text?.includes('empleado')
            );
            expect(errorMessage).toBeDefined();
        });
    });

    describe('Flujo con SAP de Vehículo Inválido', () => {
        test('debe rechazar SAP de vehículo con formato inválido', async () => {
            db.__setSession(telefono, {
                Estado: 'VEHICULO_ESPERA_SAP',
                DatosTemp: JSON.stringify({ numeroEmpleado: '123456', tipoReporte: 'VEHICULO' })
            });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'OTRO',
                confianza: 0.5,
                metodo: 'mock',
                datos_extraidos: {}
            });

            // Usuario ingresa SAP inválido
            await messageHandler.handleText(telefono, 'abc', 'msg_1', mockContext);

            const messages = whatsapp.__getAllMessages();
            const errorMessage = messages.find(m =>
                m.text?.includes('inválido') || m.text?.includes('SAP')
            );
            expect(errorMessage).toBeDefined();
        });
    });

    describe('Flujo con Cancelación en Diferentes Etapas', () => {
        test('debe cancelar en etapa de espera de empleado', async () => {
            db.__setSession(telefono, { Estado: 'VEHICULO_ESPERA_EMPLEADO' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'CANCELAR',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'cancelar', 'msg_1', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'CANCELADO',
                null,
                null,
                expect.any(String),
                expect.any(String)
            );
        });

        test('debe cancelar en etapa de espera de SAP', async () => {
            db.__setSession(telefono, {
                Estado: 'VEHICULO_ESPERA_SAP',
                DatosTemp: JSON.stringify({ numeroEmpleado: '123456', tipoReporte: 'VEHICULO' })
            });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'CANCELAR',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'no quiero continuar', 'msg_1', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'CANCELADO',
                null,
                null,
                expect.any(String),
                expect.any(String)
            );
        });

        test('debe cancelar en etapa de descripción', async () => {
            db.__setSession(telefono, {
                Estado: 'VEHICULO_ESPERA_DESCRIPCION',
                DatosTemp: JSON.stringify({
                    numeroEmpleado: '123456',
                    codigoSAPVehiculo: '7654321',
                    tipoReporte: 'VEHICULO'
                })
            });

            await messageHandler.handleButton(telefono, 'btn_cancelar', 'msg_1', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                'CANCELADO',
                null,
                null,
                expect.any(String),
                expect.any(String)
            );
        });
    });

    describe('Flujo Inteligente - Extracción de Datos', () => {
        test('debe extraer tipo de equipo, empleado y problema de mensaje largo', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'REPORTAR_FALLA',
                confianza: 0.85,
                metodo: 'ai_extract',
                tipo_equipo: 'VEHICULO',
                problema: 'No enciende',
                numero_empleado: '123456',
                datos_extraidos: {
                    tipo_equipo: 'VEHICULO',
                    problema: 'No enciende',
                    numero_empleado: '123456'
                }
            });

            await messageHandler.handleText(
                telefono,
                'Hola, soy el empleado 123456 y mi camioneta no enciende',
                'msg_1',
                mockContext
            );

            // Verificar: Se inició flujo de vehículo con datos extraídos
            expect(db.updateSession).toHaveBeenCalledWith(
                telefono,
                expect.stringContaining('VEHICULO'),
                expect.objectContaining({
                    tipoReporte: 'VEHICULO',
                    numeroEmpleado: '123456'
                }),
                expect.any(Object),
                expect.any(String),
                expect.any(String)
            );
        });
    });

    describe('Flujo con Texto de Tipo Vehículo', () => {
        test('debe iniciar flujo de vehículo al escribir "carro"', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'TIPO_VEHICULO',
                confianza: 0.9,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'carro', 'msg_1', mockContext);

            // Verificar: Se pidió número de empleado
            const messages = whatsapp.__getAllMessages();
            const empleadoRequest = messages.find(m =>
                m.text?.includes('Empleado') || m.bodyText?.includes('Empleado')
            );
            expect(empleadoRequest).toBeDefined();
        });

        test('debe iniciar flujo de vehículo al escribir "vehículo"', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'TIPO_VEHICULO',
                confianza: 0.9,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText(telefono, 'vehículo', 'msg_1', mockContext);

            const messages = whatsapp.__getAllMessages();
            const empleadoRequest = messages.find(m =>
                m.text?.includes('Empleado') || m.bodyText?.includes('Empleado')
            );
            expect(empleadoRequest).toBeDefined();
        });
    });
});
