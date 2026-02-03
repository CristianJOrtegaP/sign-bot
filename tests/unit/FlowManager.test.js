/**
 * Tests - Flow Manager
 * Pruebas del orquestador central de flujos
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../bot/controllers/flows/refrigeradorFlow', () => ({
    handleSAPInput: jest.fn().mockResolvedValue(undefined),
    handleConfirmacion: jest.fn().mockResolvedValue(undefined),
    iniciarFlujo: jest.fn().mockResolvedValue(undefined),
    iniciarFlujoConDatos: jest.fn().mockResolvedValue(undefined),
    confirmarEquipo: jest.fn().mockResolvedValue(undefined),
    corregirEquipo: jest.fn().mockResolvedValue(undefined),
    crearReporte: jest.fn().mockResolvedValue('TKT-12345678')
}));

jest.mock('../../bot/controllers/flows/vehiculoFlow', () => ({
    handleNumeroEmpleado: jest.fn().mockResolvedValue(undefined),
    handleSAPVehiculo: jest.fn().mockResolvedValue(undefined),
    handleDescripcion: jest.fn().mockResolvedValue(undefined),
    handleUbicacion: jest.fn().mockResolvedValue(undefined),
    iniciarFlujo: jest.fn().mockResolvedValue(undefined),
    iniciarFlujoConDatos: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../bot/controllers/flows/encuestaFlow', () => ({
    handleInvitacion: jest.fn().mockResolvedValue(undefined),
    handleRespuestaPregunta: jest.fn().mockResolvedValue(undefined),
    handleComentarioDecision: jest.fn().mockResolvedValue(undefined),
    handleComentario: jest.fn().mockResolvedValue(undefined),
    handleBotonAceptar: jest.fn().mockResolvedValue(undefined),
    handleBotonSalir: jest.fn().mockResolvedValue(undefined),
    handleBotonRating: jest.fn().mockResolvedValue(undefined),
    handleBotonSiComentario: jest.fn().mockResolvedValue(undefined),
    handleBotonNoComentario: jest.fn().mockResolvedValue(undefined)
}));

const FlowManager = require('../../bot/controllers/flows/FlowManager');
const refrigeradorFlow = require('../../bot/controllers/flows/refrigeradorFlow');
const vehiculoFlow = require('../../bot/controllers/flows/vehiculoFlow');
const encuestaFlow = require('../../bot/controllers/flows/encuestaFlow');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');

describe('FlowManager', () => {
    let mockContext;
    const testPhone = '+5215540829614';

    beforeEach(() => {
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn()
        };
    });

    describe('processSessionState', () => {
        test('debe procesar estado REFRI_ESPERA_SAP', async () => {
            const session = {
                Estado: 'REFRI_ESPERA_SAP',
                DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                '1234567',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(refrigeradorFlow.handleSAPInput).toHaveBeenCalledWith(
                testPhone,
                '1234567',
                session,
                mockContext
            );
        });

        test('debe procesar estado REFRI_CONFIRMAR_EQUIPO', async () => {
            const session = {
                Estado: 'REFRI_CONFIRMAR_EQUIPO',
                DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                'si',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(refrigeradorFlow.handleConfirmacion).toHaveBeenCalled();
        });

        test('debe procesar estado REFRI_ESPERA_DESCRIPCION', async () => {
            const session = {
                Estado: 'REFRI_ESPERA_DESCRIPCION',
                DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR', equipoId: 1 })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                'No enfría',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(refrigeradorFlow.crearReporte).toHaveBeenCalled();
        });

        test('debe procesar estado VEHICULO_ESPERA_EMPLEADO', async () => {
            const session = {
                Estado: 'VEHICULO_ESPERA_EMPLEADO',
                DatosTemp: JSON.stringify({ tipoReporte: 'VEHICULO' })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                '123456',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(vehiculoFlow.handleNumeroEmpleado).toHaveBeenCalled();
        });

        test('debe procesar estado VEHICULO_ESPERA_SAP', async () => {
            const session = {
                Estado: 'VEHICULO_ESPERA_SAP',
                DatosTemp: JSON.stringify({ tipoReporte: 'VEHICULO' })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                '7654321',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(vehiculoFlow.handleSAPVehiculo).toHaveBeenCalled();
        });

        test('debe procesar estado ENCUESTA_PREGUNTA_1', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                '5',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(encuestaFlow.handleRespuestaPregunta).toHaveBeenCalled();
        });

        test('debe retornar false para estado no registrado', async () => {
            const session = { Estado: 'ESTADO_DESCONOCIDO' };

            const result = await FlowManager.processSessionState(
                testPhone,
                'texto',
                session,
                mockContext
            );

            expect(result).toBe(false);
        });

        test('debe manejar estados legacy', async () => {
            const session = {
                Estado: 'ESPERA_SAP',
                DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' })
            };

            const result = await FlowManager.processSessionState(
                testPhone,
                '1234567',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(refrigeradorFlow.handleSAPInput).toHaveBeenCalled();
        });
    });

    describe('processButton', () => {
        test('debe procesar botón de refrigerador', async () => {
            const session = { Estado: 'INICIO' };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_tipo_refrigerador',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(refrigeradorFlow.iniciarFlujo).toHaveBeenCalledWith(testPhone);
        });

        test('debe procesar botón de vehículo', async () => {
            const session = { Estado: 'INICIO' };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_tipo_vehiculo',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(vehiculoFlow.iniciarFlujo).toHaveBeenCalledWith(testPhone);
        });

        test('debe procesar botón de confirmar equipo', async () => {
            const session = {
                Estado: 'REFRI_CONFIRMAR_EQUIPO',
                EquipoIdTemp: 1
            };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_confirmar_equipo',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(refrigeradorFlow.confirmarEquipo).toHaveBeenCalled();
        });

        test('debe procesar botón de cancelar', async () => {
            const session = { Estado: 'REFRI_ESPERA_SAP' };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_cancelar',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'CANCELADO',
                null,
                null,
                'USUARIO',
                expect.any(String)
            );
            expect(whatsapp.sendText).toHaveBeenCalled();
        });

        test('debe procesar botón de rating de encuesta', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_rating_5',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(encuestaFlow.handleBotonRating).toHaveBeenCalledWith(
                testPhone,
                5,
                session,
                mockContext
            );
        });

        test('debe procesar botón de aceptar encuesta', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_encuesta_aceptar',
                session,
                mockContext
            );

            expect(result).toBe(true);
            expect(encuestaFlow.handleBotonAceptar).toHaveBeenCalled();
        });

        test('debe retornar false para botón no registrado', async () => {
            const session = { Estado: 'INICIO' };

            const result = await FlowManager.processButton(
                testPhone,
                'btn_desconocido',
                session,
                mockContext
            );

            expect(result).toBe(false);
        });
    });

    describe('cancelarFlujo', () => {
        test('debe cancelar flujo y enviar mensaje', async () => {
            await FlowManager.cancelarFlujo(testPhone, mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'CANCELADO',
                null,
                null,
                'USUARIO',
                'Flujo cancelado por el usuario'
            );
            expect(whatsapp.sendText).toHaveBeenCalled();
            expect(db.saveMessage).toHaveBeenCalled();
        });
    });

    describe('iniciarFlujoConDatos', () => {
        test('debe iniciar flujo de refrigerador con datos extraídos', async () => {
            const datosExtraidos = {
                problema: 'No enfría',
                codigo_sap: '1234567'
            };

            await FlowManager.iniciarFlujoConDatos(
                testPhone,
                'REFRIGERADOR',
                datosExtraidos,
                true,
                mockContext
            );

            expect(refrigeradorFlow.iniciarFlujoConDatos).toHaveBeenCalledWith(
                testPhone,
                datosExtraidos,
                true,
                mockContext
            );
        });

        test('debe iniciar flujo de vehículo con datos extraídos', async () => {
            const datosExtraidos = {
                problema: 'Motor falla',
                numero_empleado: '123456'
            };

            await FlowManager.iniciarFlujoConDatos(
                testPhone,
                'VEHICULO',
                datosExtraidos,
                false,
                mockContext
            );

            expect(vehiculoFlow.iniciarFlujoConDatos).toHaveBeenCalledWith(
                testPhone,
                datosExtraidos,
                false,
                mockContext
            );
        });
    });

    describe('getFlow', () => {
        test('debe retornar refrigeradorFlow para REFRIGERADOR', () => {
            const flow = FlowManager.getFlow('REFRIGERADOR');
            expect(flow).toBe(refrigeradorFlow);
        });

        test('debe retornar vehiculoFlow para VEHICULO', () => {
            const flow = FlowManager.getFlow('VEHICULO');
            expect(flow).toBe(vehiculoFlow);
        });

        test('debe retornar encuestaFlow para ENCUESTA', () => {
            const flow = FlowManager.getFlow('ENCUESTA');
            expect(flow).toBe(encuestaFlow);
        });

        test('debe retornar vehiculoFlow como default', () => {
            const flow = FlowManager.getFlow('OTRO');
            expect(flow).toBe(vehiculoFlow);
        });
    });

    describe('getTipoReportePorEstado', () => {
        test('debe retornar REFRIGERADOR para estados de refrigerador', () => {
            expect(FlowManager.getTipoReportePorEstado('REFRI_ESPERA_SAP')).toBe('REFRIGERADOR');
            expect(FlowManager.getTipoReportePorEstado('REFRI_CONFIRMAR_EQUIPO')).toBe('REFRIGERADOR');
            expect(FlowManager.getTipoReportePorEstado('REFRI_ESPERA_DESCRIPCION')).toBe('REFRIGERADOR');
        });

        test('debe retornar VEHICULO para estados de vehículo', () => {
            expect(FlowManager.getTipoReportePorEstado('VEHICULO_ESPERA_EMPLEADO')).toBe('VEHICULO');
            expect(FlowManager.getTipoReportePorEstado('VEHICULO_ESPERA_SAP')).toBe('VEHICULO');
            expect(FlowManager.getTipoReportePorEstado('VEHICULO_ESPERA_DESCRIPCION')).toBe('VEHICULO');
        });

        test('debe retornar ENCUESTA para estados de encuesta', () => {
            expect(FlowManager.getTipoReportePorEstado('ENCUESTA_INVITACION')).toBe('ENCUESTA');
            expect(FlowManager.getTipoReportePorEstado('ENCUESTA_PREGUNTA_1')).toBe('ENCUESTA');
        });

        test('debe retornar null para estados no reconocidos', () => {
            expect(FlowManager.getTipoReportePorEstado('INICIO')).toBeNull();
            expect(FlowManager.getTipoReportePorEstado('UNKNOWN')).toBeNull();
        });
    });
});
