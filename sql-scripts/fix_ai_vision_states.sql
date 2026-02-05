-- =============================================
-- FIX: Agregar estados de confirmación AI Vision
-- Ejecutar este script si los estados no existen en la BD
-- =============================================

PRINT '============================================='
PRINT '  FIX: Estados AI Vision Confirmation'
PRINT '============================================='
PRINT ''

-- Primero, eliminar estados con IDs incorrectos si existen
IF EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'VEHICULO_CONFIRMAR_DATOS_AI' AND EstadoId != 26)
BEGIN
    PRINT '⚠️  Eliminando estado VEHICULO_CONFIRMAR_DATOS_AI con ID incorrecto...'
    DELETE FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'VEHICULO_CONFIRMAR_DATOS_AI'
END

IF EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'REFRIGERADOR_CONFIRMAR_DATOS_AI' AND EstadoId != 27)
BEGIN
    PRINT '⚠️  Eliminando estado REFRIGERADOR_CONFIRMAR_DATOS_AI con ID incorrecto...'
    DELETE FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'REFRIGERADOR_CONFIRMAR_DATOS_AI'
END
GO

-- Agregar VEHICULO_CONFIRMAR_DATOS_AI con ID 26
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'VEHICULO_CONFIRMAR_DATOS_AI')
BEGIN
    PRINT '➕ Insertando estado VEHICULO_CONFIRMAR_DATOS_AI (ID: 26)...'

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON

    INSERT INTO [dbo].[CatEstadoSesion]
        ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        (26, 'VEHICULO_CONFIRMAR_DATOS_AI', 'Vehículo - Confirmar Datos AI',
         'Esperando confirmación del usuario de los datos detectados por AI Vision en flujo de vehículo.',
         0, 26, 1)

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF

    PRINT '✅ Estado VEHICULO_CONFIRMAR_DATOS_AI creado con ID: 26'
END
ELSE
BEGIN
    PRINT '✅ Estado VEHICULO_CONFIRMAR_DATOS_AI ya existe con ID correcto'
END
GO

-- Agregar REFRIGERADOR_CONFIRMAR_DATOS_AI con ID 27
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'REFRIGERADOR_CONFIRMAR_DATOS_AI')
BEGIN
    PRINT '➕ Insertando estado REFRIGERADOR_CONFIRMAR_DATOS_AI (ID: 27)...'

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON

    INSERT INTO [dbo].[CatEstadoSesion]
        ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        (27, 'REFRIGERADOR_CONFIRMAR_DATOS_AI', 'Refrigerador - Confirmar Datos AI',
         'Esperando confirmación del usuario de los datos detectados por AI Vision en flujo de refrigerador.',
         0, 27, 1)

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF

    PRINT '✅ Estado REFRIGERADOR_CONFIRMAR_DATOS_AI creado con ID: 27'
END
ELSE
BEGIN
    PRINT '✅ Estado REFRIGERADOR_CONFIRMAR_DATOS_AI ya existe con ID correcto'
END
GO

-- Verificación final
PRINT ''
PRINT '📊 Verificación de estados AI Vision:'
SELECT EstadoId, Codigo, Nombre, EsTerminal, Activo
FROM [dbo].[CatEstadoSesion]
WHERE Codigo IN ('VEHICULO_CONFIRMAR_DATOS_AI', 'REFRIGERADOR_CONFIRMAR_DATOS_AI')
ORDER BY EstadoId

PRINT ''
PRINT '============================================='
PRINT '  ✅ FIX COMPLETADO'
PRINT '============================================='
GO
