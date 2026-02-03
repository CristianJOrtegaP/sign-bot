-- ============================================
-- AC FIXBOT - Agregar Estado VEHICULO_CONFIRMAR_DATOS_AI
-- Nuevo estado para confirmar datos extraídos por AI Vision
-- ============================================
-- Fecha: 2026-02-03
-- Estado ID: 22
-- ============================================

PRINT '📝 Agregando nuevo estado VEHICULO_CONFIRMAR_DATOS_AI...'
PRINT ''

-- Verificar si ya existe
IF EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE EstadoId = 22)
BEGIN
    PRINT '⚠️  El estado con ID 22 ya existe. Actualizando...'

    UPDATE [dbo].[CatEstadoSesion]
    SET
        Codigo = 'VEHICULO_CONFIRMAR_DATOS_AI',
        Nombre = 'Confirmar Datos AI Vehículo',
        Descripcion = 'Esperando confirmación de datos extraídos por AI Vision'
    WHERE EstadoId = 22

    PRINT '✅ Estado actualizado'
END
ELSE
BEGIN
    PRINT '➕ Insertando nuevo estado...'

    -- Habilitar IDENTITY_INSERT para insertar ID explícito
    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON

    INSERT INTO [dbo].[CatEstadoSesion] (EstadoId, Codigo, Nombre, Descripcion, FechaCreacion)
    VALUES (
        22,
        'VEHICULO_CONFIRMAR_DATOS_AI',
        'Confirmar Datos AI Vehículo',
        'Esperando confirmación de datos extraídos por AI Vision',
        GETDATE()
    )

    -- Deshabilitar IDENTITY_INSERT
    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF

    PRINT '✅ Estado insertado'
END

PRINT ''
PRINT '📊 Verificando estado actual...'

-- Mostrar todos los estados de vehículo
SELECT
    EstadoId,
    Codigo,
    Descripcion,
    FechaCreacion
FROM [dbo].[CatEstadoSesion]
WHERE Codigo LIKE 'VEHICULO%'
ORDER BY EstadoId

PRINT ''
PRINT '✅ Script completado exitosamente'
