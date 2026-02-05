-- =============================================
-- AC FIXBOT - MIGRACIÓN: ESTADO DE CONFIRMACIÓN DE EQUIPO
-- Version: 2.2
-- Fecha: 2026-02-04
-- =============================================
--
-- DESCRIPCIÓN:
-- Agrega estado de confirmación después de detectar equipo por OCR.
-- El usuario debe confirmar que el equipo detectado es correcto.
--
-- NUEVO ESTADO:
-- - REFRIGERADOR_CONFIRMAR_EQUIPO (ID 25): Esperando confirmación de equipo
--
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════════╗'
PRINT '║                                                                ║'
PRINT '║    AC FIXBOT - ESTADO DE CONFIRMACIÓN DE EQUIPO                ║'
PRINT '║                       Version 2.2                              ║'
PRINT '║                                                                ║'
PRINT '╚════════════════════════════════════════════════════════════════╝'
PRINT ''

-- =============================================
-- AGREGAR ESTADO REFRIGERADOR_CONFIRMAR_EQUIPO
-- =============================================

IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'REFRIGERADOR_CONFIRMAR_EQUIPO')
BEGIN
    PRINT '   [1] Agregando estado REFRIGERADOR_CONFIRMAR_EQUIPO...'

    -- Habilitar inserción de identidad explícita
    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON

    INSERT INTO [dbo].[CatEstadoSesion]
        ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        (25, 'REFRIGERADOR_CONFIRMAR_EQUIPO', 'Confirmar Equipo Detectado',
         'Esperando confirmación del usuario de que el equipo detectado por OCR es correcto.',
         0, 16, 1)

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF

    PRINT '   ✅ Estado REFRIGERADOR_CONFIRMAR_EQUIPO agregado con ID: 25'
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado REFRIGERADOR_CONFIRMAR_EQUIPO ya existe'
END
GO

-- =============================================
-- VERIFICACIÓN
-- =============================================

PRINT ''
PRINT '   📊 Verificando estado:'

DECLARE @EstadoId INT
SELECT @EstadoId = [EstadoId]
FROM [dbo].[CatEstadoSesion]
WHERE [Codigo] = 'REFRIGERADOR_CONFIRMAR_EQUIPO'

IF @EstadoId IS NOT NULL
BEGIN
    PRINT '   ✅ Estado REFRIGERADOR_CONFIRMAR_EQUIPO existe con ID: ' + CAST(@EstadoId AS VARCHAR(5))
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: Estado no fue creado'
    RAISERROR('Migración fallida', 16, 1)
END
GO

-- =============================================
-- RESUMEN
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════════╗'
PRINT '║              ✅ MIGRACIÓN COMPLETADA                           ║'
PRINT '╚════════════════════════════════════════════════════════════════╝'
PRINT ''
PRINT '📋 Estado agregado: REFRIGERADOR_CONFIRMAR_EQUIPO'
PRINT ''
PRINT '📝 Uso:'
PRINT '   - Después de OCR detectar un código SAP y encontrar equipo'
PRINT '   - Se muestra información del equipo al usuario'
PRINT '   - Usuario confirma con botones "Sí" o "No"'
PRINT '   - Si confirma: continúa flujo normal'
PRINT '   - Si rechaza: pide nuevo código SAP'
PRINT ''
GO
