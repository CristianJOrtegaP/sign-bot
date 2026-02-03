-- Script de verificación de migraciones FASE 1
-- Ejecutar en Azure SQL Server o local

PRINT '=========================================='
PRINT 'VERIFICACIÓN DE MIGRACIONES - FASE 1'
PRINT '=========================================='
PRINT ''

-- 1. Verificar columna Version en SesionesChat
PRINT '1. Verificando columna Version en SesionesChat...'
IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'Version'
)
BEGIN
    PRINT '   ✅ Columna Version existe'

    -- Mostrar estadísticas
    DECLARE @TotalSesiones INT
    DECLARE @MaxVersion INT

    SELECT @TotalSesiones = COUNT(*), @MaxVersion = MAX(ISNULL(Version, 0))
    FROM SesionesChat

    PRINT '   📊 Total sesiones: ' + CAST(@TotalSesiones AS VARCHAR(10))
    PRINT '   📊 Versión máxima: ' + CAST(@MaxVersion AS VARCHAR(10))
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: Columna Version NO existe'
END
PRINT ''

-- 2. Verificar índice en SesionesChat
PRINT '2. Verificando índice IX_SesionesChat_Telefono_Version...'
IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'IX_SesionesChat_Telefono_Version'
)
BEGIN
    PRINT '   ✅ Índice existe'
END
ELSE
BEGIN
    PRINT '   ⚠️  Índice NO existe (opcional pero recomendado)'
END
PRINT ''

-- 3. Verificar columnas de deduplicación en MensajesProcessados
PRINT '3. Verificando columnas en MensajesProcessados...'
DECLARE @ColReintentos BIT = 0
DECLARE @ColUltimoReintento BIT = 0
DECLARE @ColTelefono BIT = 0

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'Reintentos')
    SET @ColReintentos = 1

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'UltimoReintento')
    SET @ColUltimoReintento = 1

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'Telefono')
    SET @ColTelefono = 1

IF (@ColReintentos = 1 AND @ColUltimoReintento = 1 AND @ColTelefono = 1)
BEGIN
    PRINT '   ✅ Todas las columnas existen'

    -- Mostrar estadísticas de reintentos
    DECLARE @TotalMensajes INT
    DECLARE @MensajesDuplicados INT
    DECLARE @MaxReintentos INT

    SELECT
        @TotalMensajes = COUNT(*),
        @MensajesDuplicados = SUM(CASE WHEN Reintentos > 0 THEN 1 ELSE 0 END),
        @MaxReintentos = MAX(Reintentos)
    FROM MensajesProcessados

    PRINT '   📊 Total mensajes procesados: ' + CAST(@TotalMensajes AS VARCHAR(10))
    PRINT '   📊 Mensajes con reintentos: ' + CAST(ISNULL(@MensajesDuplicados, 0) AS VARCHAR(10))
    PRINT '   📊 Máximo de reintentos: ' + CAST(ISNULL(@MaxReintentos, 0) AS VARCHAR(10))
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: Faltan columnas:'
    IF @ColReintentos = 0 PRINT '      - Reintentos'
    IF @ColUltimoReintento = 0 PRINT '      - UltimoReintento'
    IF @ColTelefono = 0 PRINT '      - Telefono'
END
PRINT ''

-- 4. Verificar índice en MensajesProcessados
PRINT '4. Verificando índice IX_MensajesProcessados_Telefono...'
IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'IX_MensajesProcessados_Telefono'
)
BEGIN
    PRINT '   ✅ Índice existe'
END
ELSE
BEGIN
    PRINT '   ⚠️  Índice NO existe (opcional pero recomendado)'
END
PRINT ''

-- 5. Test de lectura con optimistic locking
PRINT '5. Test de lectura con optimistic locking...'
DECLARE @TestTelefono NVARCHAR(20) = '+5215512345678'

-- Intentar leer sesión con versión
SELECT TOP 1
    Telefono,
    ISNULL(Version, 0) AS Version,
    es.Codigo AS Estado
FROM SesionesChat s
INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
WHERE Telefono = @TestTelefono
OR Telefono IS NOT NULL -- Obtener cualquier sesión para test

IF @@ROWCOUNT > 0
    PRINT '   ✅ Lectura con ISNULL(Version, 0) funciona correctamente'
ELSE
    PRINT '   ℹ️  No hay sesiones en BD para test'

PRINT ''
PRINT '=========================================='
PRINT '✅ VERIFICACIÓN COMPLETADA'
PRINT '=========================================='
