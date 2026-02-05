-- =============================================
-- MIGRACION 006: Agregar estados de confirmación AI Vision
-- AC FIXBOT - Estados para confirmar datos detectados por AI Vision
-- Fecha: 2026-02-04
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  MIGRACION 006: Estados de Confirmación AI Vision';
PRINT '===============================================================';
PRINT '';

-- =============================================
-- PASO 0: AMPLIAR COLUMNA Codigo SI ES NECESARIO
-- =============================================

-- Verificar y ampliar la columna Codigo a 50 caracteres para soportar nombres largos
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'CatEstadoSesion'
    AND COLUMN_NAME = 'Codigo'
    AND CHARACTER_MAXIMUM_LENGTH < 50
)
BEGIN
    PRINT '   [0] Ampliando columna Codigo a 50 caracteres...';
    ALTER TABLE [dbo].[CatEstadoSesion] ALTER COLUMN [Codigo] NVARCHAR(50) NOT NULL;
    PRINT '   ✅ Columna Codigo ampliada a 50 caracteres';
END
ELSE
BEGIN
    PRINT '   ⚠️  Columna Codigo ya tiene 50+ caracteres, no es necesario ampliar';
END
GO

-- =============================================
-- AGREGAR ESTADOS A CatEstadoSesion
-- =============================================

-- Estado VEHICULO_CONFIRMAR_DATOS_AI (ID 26)
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'VEHICULO_CONFIRMAR_DATOS_AI')
BEGIN
    PRINT '   [1] Agregando estado VEHICULO_CONFIRMAR_DATOS_AI...';

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON;

    INSERT INTO [dbo].[CatEstadoSesion]
        ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        (26, 'VEHICULO_CONFIRMAR_DATOS_AI', 'Vehículo - Confirmar Datos AI',
         'Esperando confirmación del usuario de los datos detectados por AI Vision en flujo de vehículo.',
         0, 26, 1);

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF;

    PRINT '   ✅ Estado VEHICULO_CONFIRMAR_DATOS_AI agregado con ID: 26';
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado VEHICULO_CONFIRMAR_DATOS_AI ya existe';
END
GO

-- Estado REFRIGERADOR_CONFIRMAR_DATOS_AI (ID 27)
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'REFRIGERADOR_CONFIRMAR_DATOS_AI')
BEGIN
    PRINT '   [2] Agregando estado REFRIGERADOR_CONFIRMAR_DATOS_AI...';

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON;

    INSERT INTO [dbo].[CatEstadoSesion]
        ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        (27, 'REFRIGERADOR_CONFIRMAR_DATOS_AI', 'Refrigerador - Confirmar Datos AI',
         'Esperando confirmación del usuario de los datos detectados por AI Vision en flujo de refrigerador.',
         0, 27, 1);

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF;

    PRINT '   ✅ Estado REFRIGERADOR_CONFIRMAR_DATOS_AI agregado con ID: 27';
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado REFRIGERADOR_CONFIRMAR_DATOS_AI ya existe';
END
GO

-- =============================================
-- VERIFICAR ESTADOS CREADOS
-- =============================================

PRINT '';
PRINT '   📊 Verificando estados:';

DECLARE @EstadoVehiculo INT, @EstadoRefrigerador INT;

SELECT @EstadoVehiculo = [EstadoId]
FROM [dbo].[CatEstadoSesion]
WHERE [Codigo] = 'VEHICULO_CONFIRMAR_DATOS_AI';

SELECT @EstadoRefrigerador = [EstadoId]
FROM [dbo].[CatEstadoSesion]
WHERE [Codigo] = 'REFRIGERADOR_CONFIRMAR_DATOS_AI';

IF @EstadoVehiculo IS NOT NULL AND @EstadoRefrigerador IS NOT NULL
BEGIN
    PRINT '   ✅ Ambos estados de confirmación AI Vision creados correctamente';
    PRINT '';
    PRINT '   Estados creados:';
    SELECT [EstadoId], [Codigo], [Nombre], [EsTerminal], [Orden], [Activo]
    FROM [dbo].[CatEstadoSesion]
    WHERE [Codigo] IN ('VEHICULO_CONFIRMAR_DATOS_AI', 'REFRIGERADOR_CONFIRMAR_DATOS_AI');
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: No se crearon todos los estados';
    RAISERROR('Migración fallida: estados no fueron creados', 16, 1);
END
GO

PRINT '';
PRINT '╔════════════════════════════════════════════════════════════════╗';
PRINT '║              ✅ MIGRACION 006 COMPLETADA                       ║';
PRINT '╚════════════════════════════════════════════════════════════════╝';
PRINT '';
PRINT '📋 Estados agregados:';
PRINT '   - VEHICULO_CONFIRMAR_DATOS_AI (ID: 26)';
PRINT '   - REFRIGERADOR_CONFIRMAR_DATOS_AI (ID: 27)';
PRINT '';
PRINT '📝 Uso:';
PRINT '   - Cuando AI Vision detecta datos de imagen (tipo equipo, problema, etc.)';
PRINT '   - El usuario ve los datos detectados y puede confirmar o rechazar';
PRINT '   - Si confirma: se inicia el flujo con datos pre-llenados';
PRINT '   - Si rechaza: se inicia flujo manual';
PRINT '';
GO
