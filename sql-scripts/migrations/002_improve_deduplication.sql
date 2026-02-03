-- =============================================
-- Migración 002: Mejorar Deduplicación Idempotente
-- Agrega columnas para trackear reintentos y hacer MERGE atómico
-- =============================================

PRINT '=========================================='
PRINT 'MIGRACIÓN 002: Deduplicación Idempotente'
PRINT '=========================================='
PRINT ''

-- 1. Agregar columnas para trackear reintentos
PRINT 'Paso 1: Agregando columnas para trackear reintentos...'

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'Reintentos'
)
BEGIN
    ALTER TABLE MensajesProcessados
    ADD Reintentos INT NOT NULL DEFAULT 0

    PRINT '   ✅ Columna Reintentos agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️ Columna Reintentos ya existe'
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'UltimoReintento'
)
BEGIN
    ALTER TABLE MensajesProcessados
    ADD UltimoReintento DATETIME NULL

    PRINT '   ✅ Columna UltimoReintento agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️ Columna UltimoReintento ya existe'
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'Telefono'
)
BEGIN
    ALTER TABLE MensajesProcessados
    ADD Telefono NVARCHAR(20) NULL

    PRINT '   ✅ Columna Telefono agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️ Columna Telefono ya existe'
END
GO

-- 2. Crear índice para queries por teléfono (útil para debugging)
PRINT ''
PRINT 'Paso 2: Creando índice para Telefono...'

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'IX_MensajesProcessados_Telefono'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_MensajesProcessados_Telefono
    ON MensajesProcessados (Telefono)
    INCLUDE (WhatsAppMessageId, FechaCreacion, Reintentos)

    PRINT '   ✅ Índice IX_MensajesProcessados_Telefono creado'
END
ELSE
BEGIN
    PRINT '   ⚠️ Índice IX_MensajesProcessados_Telefono ya existe'
END
GO

-- 3. Verificar estructura final
PRINT ''
PRINT 'Paso 3: Verificando estructura final...'
GO

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name IN ('Reintentos', 'UltimoReintento', 'Telefono')
    GROUP BY object_id
    HAVING COUNT(*) = 3
)
BEGIN
    PRINT '   ✅ Todas las columnas existen'

    -- Mostrar stats
    DECLARE @TotalMensajes INT
    DECLARE @MensajesHoy INT
    DECLARE @MensajesDuplicados INT

    SELECT @TotalMensajes = COUNT(*) FROM MensajesProcessados
    SELECT @MensajesHoy = COUNT(*) FROM MensajesProcessados WHERE FechaCreacion >= CAST(GETDATE() AS DATE)
    SELECT @MensajesDuplicados = COUNT(*) FROM MensajesProcessados WHERE Reintentos > 0

    PRINT ''
    PRINT '   📊 Estadísticas:'
    PRINT '   - Total mensajes procesados: ' + CAST(@TotalMensajes AS VARCHAR(10))
    PRINT '   - Mensajes procesados hoy: ' + CAST(@MensajesHoy AS VARCHAR(10))
    PRINT '   - Mensajes con reintentos: ' + CAST(@MensajesDuplicados AS VARCHAR(10))
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: Faltan columnas'
    RAISERROR('Migración fallida: columnas no fueron creadas', 16, 1)
END
GO

PRINT ''
PRINT '=========================================='
PRINT '✅ MIGRACIÓN 002 COMPLETADA'
PRINT '=========================================='
PRINT ''
PRINT 'Deduplicación idempotente ahora soporta:'
PRINT '  ✅ Tracking de reintentos'
PRINT '  ✅ Timestamp de último reintento'
PRINT '  ✅ Asociación con teléfono'
PRINT ''
PRINT 'SIGUIENTE PASO: Actualizar código de SesionRepository.registerMessageAtomic()'
PRINT ''
GO
