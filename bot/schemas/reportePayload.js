/**
 * AC FIXBOT - Schema de Validacion para Reportes
 */

const { z } = require('zod');

// Schema para crear un reporte de refrigerador
const reporteRefrigeradorSchema = z.object({
    telefono: z.string()
        .min(7, 'Telefono debe tener al menos 7 digitos')
        .regex(/^\d+$/, 'Telefono solo debe contener numeros'),
    codigoSAP: z.string()
        .regex(/^\d{5,10}$/, 'Codigo SAP debe tener entre 5 y 10 digitos'),
    descripcion: z.string()
        .min(5, 'Descripcion debe tener al menos 5 caracteres')
        .max(500, 'Descripcion no puede exceder 500 caracteres'),
    equipoId: z.number().int().positive().optional()
});

// Schema para crear un reporte de vehiculo
const reporteVehiculoSchema = z.object({
    telefono: z.string()
        .min(7, 'Telefono debe tener al menos 7 digitos')
        .regex(/^\d+$/, 'Telefono solo debe contener numeros'),
    numeroEmpleado: z.string()
        .min(1, 'Numero de empleado es requerido'),
    codigoSAP: z.string()
        .regex(/^\d{5,10}$/, 'Codigo SAP debe tener entre 5 y 10 digitos'),
    descripcion: z.string()
        .min(5, 'Descripcion debe tener al menos 5 caracteres')
        .max(500, 'Descripcion no puede exceder 500 caracteres'),
    latitud: z.number().min(-90).max(90).optional(),
    longitud: z.number().min(-180).max(180).optional()
});

// Schema para codigo SAP
const codigoSAPSchema = z.string()
    .regex(/^\d{5,10}$/, 'Codigo SAP debe tener entre 5 y 10 digitos');

/**
 * Valida un codigo SAP
 * @param {string} codigoSAP - Codigo a validar
 * @returns {{ success: boolean, error?: string }}
 */
function validateCodigoSAP(codigoSAP) {
    try {
        codigoSAPSchema.parse(codigoSAP);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.errors?.[0]?.message || 'Codigo SAP invalido'
        };
    }
}

/**
 * Valida un reporte de refrigerador
 * @param {Object} payload - Payload a validar
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function validateReporteRefrigerador(payload) {
    try {
        const result = reporteRefrigeradorSchema.parse(payload);
        return { success: true, data: result };
    } catch (error) {
        return {
            success: false,
            error: error.errors?.map(e => e.message).join(', ') || 'Datos invalidos'
        };
    }
}

/**
 * Valida un reporte de vehiculo
 * @param {Object} payload - Payload a validar
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function validateReporteVehiculo(payload) {
    try {
        const result = reporteVehiculoSchema.parse(payload);
        return { success: true, data: result };
    } catch (error) {
        return {
            success: false,
            error: error.errors?.map(e => e.message).join(', ') || 'Datos invalidos'
        };
    }
}

module.exports = {
    reporteRefrigeradorSchema,
    reporteVehiculoSchema,
    codigoSAPSchema,
    validateCodigoSAP,
    validateReporteRefrigerador,
    validateReporteVehiculo
};
