/**
 * Tests - Session States Constants
 * Pruebas de las constantes y helpers de estados de sesión
 */

const {
    TIPO_REPORTE,
    TIPO_REPORTE_ID,
    ESTADO_REPORTE,
    ESTADO_REPORTE_ID,
    ESTADO_REPORTE_INFO: _ESTADO_REPORTE_INFO,
    ESTADOS_REPORTE_FINALES: _ESTADOS_REPORTE_FINALES,
    ESTADO,
    ESTADO_ID: _ESTADO_ID,
    ESTADOS_TERMINALES,
    ESTADOS_REFRIGERADOR,
    ESTADOS_VEHICULO,
    ESTADOS_ENCUESTA,
    MAPEO_ESTADOS_LEGACY,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO,
    SPAM_CONFIG,
    esEstadoTerminal,
    esEstadoRefrigerador,
    esEstadoVehiculo,
    esEstadoEncuesta,
    getEstadoId,
    getTipoReporteId,
    getTipoReportePorEstado,
    getEstadoReporteId,
    getEstadoReporteInfo,
    esEstadoReporteFinal
} = require('../../bot/constants/sessionStates');

describe('Session States Constants', () => {
    describe('TIPO_REPORTE', () => {
        test('debe tener tipos de reporte correctos', () => {
            expect(TIPO_REPORTE.REFRIGERADOR).toBe('REFRIGERADOR');
            expect(TIPO_REPORTE.VEHICULO).toBe('VEHICULO');
        });
    });

    describe('TIPO_REPORTE_ID', () => {
        test('debe tener IDs correctos', () => {
            expect(TIPO_REPORTE_ID.REFRIGERADOR).toBe(1);
            expect(TIPO_REPORTE_ID.VEHICULO).toBe(2);
        });
    });

    describe('ESTADO_REPORTE', () => {
        test('debe tener estados de reporte correctos', () => {
            expect(ESTADO_REPORTE.PENDIENTE).toBe('PENDIENTE');
            expect(ESTADO_REPORTE.EN_PROCESO).toBe('EN_PROCESO');
            expect(ESTADO_REPORTE.RESUELTO).toBe('RESUELTO');
            expect(ESTADO_REPORTE.CANCELADO).toBe('CANCELADO');
        });
    });

    describe('ESTADO_REPORTE_ID', () => {
        test('debe tener IDs de estados de reporte correctos', () => {
            expect(ESTADO_REPORTE_ID.PENDIENTE).toBe(1);
            expect(ESTADO_REPORTE_ID.EN_PROCESO).toBe(2);
            expect(ESTADO_REPORTE_ID.RESUELTO).toBe(3);
            expect(ESTADO_REPORTE_ID.CANCELADO).toBe(4);
        });
    });

    describe('ESTADO', () => {
        test('debe tener estados terminales', () => {
            expect(ESTADO.INICIO).toBe('INICIO');
            expect(ESTADO.CANCELADO).toBe('CANCELADO');
            expect(ESTADO.FINALIZADO).toBe('FINALIZADO');
            expect(ESTADO.TIMEOUT).toBe('TIMEOUT');
        });

        test('debe tener estados de refrigerador', () => {
            expect(ESTADO.REFRI_ESPERA_SAP).toBe('REFRI_ESPERA_SAP');
            expect(ESTADO.REFRI_CONFIRMAR_EQUIPO).toBe('REFRI_CONFIRMAR_EQUIPO');
            expect(ESTADO.REFRI_ESPERA_DESCRIPCION).toBe('REFRI_ESPERA_DESCRIPCION');
        });

        test('debe tener estados de vehículo', () => {
            expect(ESTADO.VEHICULO_ESPERA_EMPLEADO).toBe('VEHICULO_ESPERA_EMPLEADO');
            expect(ESTADO.VEHICULO_ESPERA_SAP).toBe('VEHICULO_ESPERA_SAP');
            expect(ESTADO.VEHICULO_ESPERA_DESCRIPCION).toBe('VEHICULO_ESPERA_DESCRIPCION');
            expect(ESTADO.VEHICULO_ESPERA_UBICACION).toBe('VEHICULO_ESPERA_UBICACION');
        });

        test('debe tener estados de encuesta', () => {
            expect(ESTADO.ENCUESTA_INVITACION).toBe('ENCUESTA_INVITACION');
            expect(ESTADO.ENCUESTA_PREGUNTA_1).toBe('ENCUESTA_PREGUNTA_1');
            expect(ESTADO.ENCUESTA_COMENTARIO).toBe('ENCUESTA_COMENTARIO');
            expect(ESTADO.ENCUESTA_ESPERA_COMENTARIO).toBe('ENCUESTA_ESPERA_COMENTARIO');
        });
    });

    describe('ORIGEN_ACCION', () => {
        test('debe tener orígenes correctos', () => {
            expect(ORIGEN_ACCION.USUARIO).toBe('USUARIO');
            expect(ORIGEN_ACCION.BOT).toBe('BOT');
            expect(ORIGEN_ACCION.TIMER).toBe('TIMER');
            expect(ORIGEN_ACCION.SISTEMA).toBe('SISTEMA');
        });
    });

    describe('TIPO_MENSAJE', () => {
        test('debe tener tipos de mensaje correctos', () => {
            expect(TIPO_MENSAJE.USUARIO).toBe('U');
            expect(TIPO_MENSAJE.BOT).toBe('B');
        });
    });

    describe('TIPO_CONTENIDO', () => {
        test('debe tener tipos de contenido correctos', () => {
            expect(TIPO_CONTENIDO.TEXTO).toBe('TEXTO');
            expect(TIPO_CONTENIDO.IMAGEN).toBe('IMAGEN');
            expect(TIPO_CONTENIDO.BOTON).toBe('BOTON');
            expect(TIPO_CONTENIDO.UBICACION).toBe('UBICACION');
        });
    });

    describe('SPAM_CONFIG', () => {
        test('debe tener configuración de spam', () => {
            expect(typeof SPAM_CONFIG.UMBRAL_MENSAJES_POR_HORA).toBe('number');
            expect(typeof SPAM_CONFIG.UMBRAL_MENSAJES_POR_MINUTO).toBe('number');
            expect(typeof SPAM_CONFIG.TIEMPO_BLOQUEO_MINUTOS).toBe('number');
        });
    });

    describe('Helper Functions', () => {
        describe('esEstadoTerminal', () => {
            test('debe retornar true para estados terminales', () => {
                expect(esEstadoTerminal('INICIO')).toBe(true);
                expect(esEstadoTerminal('CANCELADO')).toBe(true);
                expect(esEstadoTerminal('FINALIZADO')).toBe(true);
                expect(esEstadoTerminal('TIMEOUT')).toBe(true);
            });

            test('debe retornar false para estados no terminales', () => {
                expect(esEstadoTerminal('REFRI_ESPERA_SAP')).toBe(false);
                expect(esEstadoTerminal('VEHICULO_ESPERA_EMPLEADO')).toBe(false);
                expect(esEstadoTerminal('ENCUESTA_PREGUNTA_1')).toBe(false);
            });
        });

        describe('esEstadoRefrigerador', () => {
            test('debe retornar true para estados de refrigerador', () => {
                expect(esEstadoRefrigerador('REFRI_ESPERA_SAP')).toBe(true);
                expect(esEstadoRefrigerador('REFRI_CONFIRMAR_EQUIPO')).toBe(true);
                expect(esEstadoRefrigerador('REFRI_ESPERA_DESCRIPCION')).toBe(true);
            });

            test('debe retornar false para otros estados', () => {
                expect(esEstadoRefrigerador('INICIO')).toBe(false);
                expect(esEstadoRefrigerador('VEHICULO_ESPERA_SAP')).toBe(false);
            });
        });

        describe('esEstadoVehiculo', () => {
            test('debe retornar true para estados de vehículo', () => {
                expect(esEstadoVehiculo('VEHICULO_ESPERA_EMPLEADO')).toBe(true);
                expect(esEstadoVehiculo('VEHICULO_ESPERA_SAP')).toBe(true);
                expect(esEstadoVehiculo('VEHICULO_ESPERA_DESCRIPCION')).toBe(true);
                expect(esEstadoVehiculo('VEHICULO_ESPERA_UBICACION')).toBe(true);
            });

            test('debe retornar false para otros estados', () => {
                expect(esEstadoVehiculo('INICIO')).toBe(false);
                expect(esEstadoVehiculo('REFRI_ESPERA_SAP')).toBe(false);
            });
        });

        describe('esEstadoEncuesta', () => {
            test('debe retornar true para estados de encuesta', () => {
                expect(esEstadoEncuesta('ENCUESTA_INVITACION')).toBe(true);
                expect(esEstadoEncuesta('ENCUESTA_PREGUNTA_1')).toBe(true);
                expect(esEstadoEncuesta('ENCUESTA_PREGUNTA_6')).toBe(true);
                expect(esEstadoEncuesta('ENCUESTA_COMENTARIO')).toBe(true);
                expect(esEstadoEncuesta('ENCUESTA_ESPERA_COMENTARIO')).toBe(true);
            });

            test('debe retornar false para otros estados', () => {
                expect(esEstadoEncuesta('INICIO')).toBe(false);
                expect(esEstadoEncuesta('REFRI_ESPERA_SAP')).toBe(false);
            });
        });

        describe('getEstadoId', () => {
            test('debe retornar ID correcto para estados válidos', () => {
                expect(getEstadoId('INICIO')).toBe(1);
                expect(getEstadoId('CANCELADO')).toBe(2);
                expect(getEstadoId('FINALIZADO')).toBe(3);
                expect(getEstadoId('REFRI_ESPERA_SAP')).toBe(5);
            });

            test('debe retornar null para estados inválidos', () => {
                expect(getEstadoId('ESTADO_INVALIDO')).toBeNull();
            });
        });

        describe('getTipoReporteId', () => {
            test('debe retornar ID correcto para tipos válidos', () => {
                expect(getTipoReporteId('REFRIGERADOR')).toBe(1);
                expect(getTipoReporteId('VEHICULO')).toBe(2);
            });

            test('debe retornar null para tipos inválidos', () => {
                expect(getTipoReporteId('OTRO')).toBeNull();
            });
        });

        describe('getTipoReportePorEstado', () => {
            test('debe retornar REFRIGERADOR para estados de refrigerador', () => {
                expect(getTipoReportePorEstado('REFRI_ESPERA_SAP')).toBe('REFRIGERADOR');
            });

            test('debe retornar VEHICULO para estados de vehículo', () => {
                expect(getTipoReportePorEstado('VEHICULO_ESPERA_SAP')).toBe('VEHICULO');
            });

            test('debe retornar null para otros estados', () => {
                expect(getTipoReportePorEstado('INICIO')).toBeNull();
                expect(getTipoReportePorEstado('ENCUESTA_PREGUNTA_1')).toBeNull();
            });
        });

        describe('getEstadoReporteId', () => {
            test('debe retornar ID correcto', () => {
                expect(getEstadoReporteId('PENDIENTE')).toBe(1);
                expect(getEstadoReporteId('RESUELTO')).toBe(3);
            });

            test('debe retornar null para estados inválidos', () => {
                expect(getEstadoReporteId('INVALIDO')).toBeNull();
            });
        });

        describe('getEstadoReporteInfo', () => {
            test('debe retornar info para estado PENDIENTE', () => {
                const info = getEstadoReporteInfo('PENDIENTE');
                expect(info.emoji).toBe('🟡');
                expect(info.nombre).toBe('Pendiente');
                expect(info.mensaje).toBeDefined();
            });

            test('debe retornar info para estado RESUELTO', () => {
                const info = getEstadoReporteInfo('RESUELTO');
                expect(info.emoji).toBe('🟢');
                expect(info.nombre).toBe('Resuelto');
            });

            test('debe retornar info por defecto para estados desconocidos', () => {
                const info = getEstadoReporteInfo('DESCONOCIDO');
                expect(info.emoji).toBe('⚪');
                expect(info.nombre).toBe('DESCONOCIDO');
            });
        });

        describe('esEstadoReporteFinal', () => {
            test('debe retornar true para estados finales', () => {
                expect(esEstadoReporteFinal('RESUELTO')).toBe(true);
                expect(esEstadoReporteFinal('CANCELADO')).toBe(true);
            });

            test('debe retornar false para estados no finales', () => {
                expect(esEstadoReporteFinal('PENDIENTE')).toBe(false);
                expect(esEstadoReporteFinal('EN_PROCESO')).toBe(false);
            });
        });
    });

    describe('Arrays de Estados', () => {
        test('ESTADOS_TERMINALES debe contener estados correctos', () => {
            expect(ESTADOS_TERMINALES).toContain('INICIO');
            expect(ESTADOS_TERMINALES).toContain('CANCELADO');
            expect(ESTADOS_TERMINALES).toContain('FINALIZADO');
            expect(ESTADOS_TERMINALES).toContain('TIMEOUT');
            expect(ESTADOS_TERMINALES.length).toBe(4);
        });

        test('ESTADOS_REFRIGERADOR debe contener estados correctos', () => {
            expect(ESTADOS_REFRIGERADOR).toContain('REFRI_ESPERA_SAP');
            expect(ESTADOS_REFRIGERADOR).toContain('REFRI_CONFIRMAR_EQUIPO');
            expect(ESTADOS_REFRIGERADOR).toContain('REFRI_ESPERA_DESCRIPCION');
            expect(ESTADOS_REFRIGERADOR.length).toBe(3);
        });

        test('ESTADOS_VEHICULO debe contener estados correctos', () => {
            expect(ESTADOS_VEHICULO).toContain('VEHICULO_ESPERA_EMPLEADO');
            expect(ESTADOS_VEHICULO).toContain('VEHICULO_ESPERA_SAP');
            expect(ESTADOS_VEHICULO).toContain('VEHICULO_ESPERA_DESCRIPCION');
            expect(ESTADOS_VEHICULO).toContain('VEHICULO_ESPERA_UBICACION');
            expect(ESTADOS_VEHICULO.length).toBe(4);
        });

        test('ESTADOS_ENCUESTA debe contener todos los estados de encuesta', () => {
            expect(ESTADOS_ENCUESTA).toContain('ENCUESTA_INVITACION');
            expect(ESTADOS_ENCUESTA).toContain('ENCUESTA_PREGUNTA_1');
            expect(ESTADOS_ENCUESTA).toContain('ENCUESTA_PREGUNTA_6');
            expect(ESTADOS_ENCUESTA).toContain('ENCUESTA_COMENTARIO');
            expect(ESTADOS_ENCUESTA).toContain('ENCUESTA_ESPERA_COMENTARIO');
            expect(ESTADOS_ENCUESTA.length).toBe(9);
        });
    });

    describe('MAPEO_ESTADOS_LEGACY', () => {
        test('debe mapear estados legacy correctamente', () => {
            expect(MAPEO_ESTADOS_LEGACY['ESPERA_SAP']).toBe('REFRI_ESPERA_SAP');
            expect(MAPEO_ESTADOS_LEGACY['CONFIRMAR_EQUIPO']).toBe('REFRI_CONFIRMAR_EQUIPO');
            expect(MAPEO_ESTADOS_LEGACY['ESPERA_NUMERO_EMPLEADO']).toBe('VEHICULO_ESPERA_EMPLEADO');
        });
    });
});
