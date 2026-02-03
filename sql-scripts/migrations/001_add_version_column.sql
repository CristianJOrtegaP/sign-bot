-- =============================================
-- Migración 001: Optimistic Locking
-- Agrega columna Version a SesionesChat para prevenir race conditions
-- =============================================

-- 1. Agregar columna Version con valor default 0
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'Version'
)
BEGIN
    PRINT '✅ Agregando columna Version a SesionesChat...'

    ALTER TABLE SesionesChat
    ADD Version INT NOT NULL DEFAULT 0

    PRINT '✅ Columna Version agregada exitosamente'
END
ELSE
BEGIN
    PRINT '⚠️ La columna Version ya existe en SesionesChat'
END
GO

-- 2. Verificar que la columna existe
IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'Version'
)
BEGIN
    PRINT '✅ Verificación exitosa: Columna Version existe'

    -- Mostrar stats
    DECLARE @RowCount INT
    SELECT @RowCount = COUNT(*) FROM SesionesChat
    PRINT '📊 Total de sesiones: ' + CAST(@RowCount AS VARCHAR(10))
    PRINT '📊 Todas las sesiones tienen Version = 0 por default'
END
ELSE
BEGIN
    PRINT '❌ ERROR: La columna Version NO existe'
    RAISERROR('Migración fallida: columna Version no fue creada', 16, 1)
END
GO

-- 3. Crear índice para mejorar performance de queries concurrentes (opcional)
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'IX_SesionesChat_Telefono_Version'
)
BEGIN
    PRINT '✅ Creando índice para Telefono + Version...'

    CREATE NONCLUSTERED INDEX IX_SesionesChat_Telefono_Version
    ON SesionesChat (Telefono, Version)
    INCLUDE (EstadoId, DatosTemp, EquipoIdTemp)

    PRINT '✅ Índice creado exitosamente'
END
ELSE
BEGIN
    PRINT '⚠️ El índice IX_SesionesChat_Telefono_Version ya existe'
END
GO

PRINT ''
PRINT '=========================================='
PRINT '✅ MIGRACIÓN 001 COMPLETADA'
PRINT '=========================================='
PRINT 'Optimistic Locking ahora está habilitado.'
PRINT 'SIGUIENTE PASO: Actualizar código de SesionRepository.updateSession()'
PRINT ''
GO
