-- =============================================
-- AC FIXBOT - MIGRACIÓN FASE 2b: ESTADOS FLEXIBLES
-- Version: 2.1
-- Fecha: 2026-02-04
-- =============================================
--
-- DESCRIPCIÓN:
-- Agrega estados simplificados para arquitectura de flujo flexible.
-- Los nuevos estados permiten llenado de formulario en cualquier orden.
--
-- NUEVOS ESTADOS:
-- - REFRIGERADOR_ACTIVO (ID 23): Estado único para todo el flujo de refrigerador
-- - VEHICULO_ACTIVO (ID 24): Estado único para todo el flujo de vehículo
--
-- BENEFICIOS:
-- - Simplifica de 11 estados a 4 estados activos (INICIO + 2 flujos + terminales)
-- - Permite extraer múltiples campos de un solo mensaje
-- - Soporta tanto flujo guiado (secuencial) como flexible (todo en uno)
--
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════════╗'
PRINT '║                                                                ║'
PRINT '║         AC FIXBOT - MIGRACIÓN FASE 2b: ESTADOS FLEXIBLES      ║'
PRINT '║                       Version 2.1                              ║'
PRINT '║                                                                ║'
PRINT '╚════════════════════════════════════════════════════════════════╝'
PRINT ''

-- =============================================
-- SECCIÓN 1: AGREGAR ESTADOS FLEXIBLES
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 1: Agregando Estados Flexibles                        │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''

-- 1.1 Estado REFRIGERADOR_ACTIVO
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'REFRIGERADOR_ACTIVO')
BEGIN
    PRINT '   [1.1] Agregando estado REFRIGERADOR_ACTIVO...'

    INSERT INTO [dbo].[CatEstadoSesion]
        ([Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        ('REFRIGERADOR_ACTIVO', 'Flujo Refrigerador Activo',
         'Estado único para flujo flexible de refrigerador. Permite llenado de campos en cualquier orden.',
         0, 15, 1)

    PRINT '   ✅ Estado REFRIGERADOR_ACTIVO agregado (Orden: 15)'
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado REFRIGERADOR_ACTIVO ya existe, actualizando descripción...'

    UPDATE [dbo].[CatEstadoSesion]
    SET
        [Nombre] = 'Flujo Refrigerador Activo',
        [Descripcion] = 'Estado único para flujo flexible de refrigerador. Permite llenado de campos en cualquier orden.',
        [Orden] = 15
    WHERE [Codigo] = 'REFRIGERADOR_ACTIVO'

    PRINT '   ✅ Estado REFRIGERADOR_ACTIVO actualizado'
END
GO

-- 1.2 Estado VEHICULO_ACTIVO
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'VEHICULO_ACTIVO')
BEGIN
    PRINT '   [1.2] Agregando estado VEHICULO_ACTIVO...'

    INSERT INTO [dbo].[CatEstadoSesion]
        ([Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        ('VEHICULO_ACTIVO', 'Flujo Vehículo Activo',
         'Estado único para flujo flexible de vehículo. Permite llenado de campos en cualquier orden.',
         0, 25, 1)

    PRINT '   ✅ Estado VEHICULO_ACTIVO agregado (Orden: 25)'
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado VEHICULO_ACTIVO ya existe, actualizando descripción...'

    UPDATE [dbo].[CatEstadoSesion]
    SET
        [Nombre] = 'Flujo Vehículo Activo',
        [Descripcion] = 'Estado único para flujo flexible de vehículo. Permite llenado de campos en cualquier orden.',
        [Orden] = 25
    WHERE [Codigo] = 'VEHICULO_ACTIVO'

    PRINT '   ✅ Estado VEHICULO_ACTIVO actualizado'
END
GO

-- =============================================
-- SECCIÓN 2: VERIFICACIÓN
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 2: Verificación                                       │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''

-- Verificar estados flexibles
DECLARE @EstadosFlexibles TABLE (
    Codigo NVARCHAR(30),
    EstadoId INT,
    Orden INT
)

INSERT INTO @EstadosFlexibles
SELECT [Codigo], [EstadoId], [Orden]
FROM [dbo].[CatEstadoSesion]
WHERE [Codigo] IN ('REFRIGERADOR_ACTIVO', 'VEHICULO_ACTIVO')

IF (SELECT COUNT(*) FROM @EstadosFlexibles) = 2
BEGIN
    PRINT '   ✅ Verificación exitosa: Ambos estados flexibles existen'
    PRINT ''
    PRINT '   📊 Estados Flexibles:'
    SELECT
        '      - ' + Codigo + ' (ID: ' + CAST(EstadoId AS VARCHAR(5)) + ', Orden: ' + CAST(Orden AS VARCHAR(5)) + ')' AS Estado
    FROM @EstadosFlexibles
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: No se encontraron todos los estados flexibles'
    RAISERROR('Migración fallida: estados flexibles no fueron creados', 16, 1)
END
GO

-- Mostrar todos los estados activos del sistema
PRINT ''
PRINT '   📋 Todos los Estados de Sesión del Sistema:'
PRINT ''

SELECT
    '      ' +
    CAST(ROW_NUMBER() OVER (ORDER BY [Orden]) AS VARCHAR(3)) + '. ' +
    [Codigo] +
    REPLICATE(' ', 30 - LEN([Codigo])) +
    'ID: ' + CAST([EstadoId] AS VARCHAR(5)) +
    CASE WHEN [EsTerminal] = 1 THEN ' [TERMINAL]' ELSE '' END AS Estados
FROM [dbo].[CatEstadoSesion]
WHERE [Activo] = 1
ORDER BY [Orden]
GO

-- =============================================
-- RESUMEN FINAL
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════════╗'
PRINT '║                                                                ║'
PRINT '║              ✅ MIGRACIÓN COMPLETADA                           ║'
PRINT '║                                                                ║'
PRINT '╚════════════════════════════════════════════════════════════════╝'
PRINT ''
PRINT '🎉 Estados flexibles de FASE 2b agregados exitosamente'
PRINT ''
PRINT '📋 Cambios aplicados:'
PRINT '   ✅ Estado REFRIGERADOR_ACTIVO - para flujo flexible de refrigerador'
PRINT '   ✅ Estado VEHICULO_ACTIVO - para flujo flexible de vehículo'
PRINT ''
PRINT '📝 Próximos pasos:'
PRINT '   1. Actualizar sessionStates.js con nuevos estados'
PRINT '   2. Crear bot/services/fieldExtractor.js'
PRINT '   3. Crear bot/services/fieldManager.js'
PRINT '   4. Crear bot/controllers/flows/flexibleFlowManager.js'
PRINT '   5. Integrar en messageHandler.js'
PRINT ''
PRINT '📚 Documentación:'
PRINT '   - Propuesta: docs/PROPUESTA_FLUJO_FLEXIBLE.md'
PRINT '   - Plan completo: docs/PLAN_IMPLEMENTACION_COMPLETO.md'
PRINT ''
GO
