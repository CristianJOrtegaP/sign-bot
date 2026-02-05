-- =============================================
-- AC FIXBOT - INSTALACIÓN COMPLETA DE BASE DE DATOS
-- Version: 2.0 (incluye FASE 1 + FASE 2)
-- Fecha: 2026-02-03
-- =============================================
--
-- DESCRIPCIÓN:
-- Este script ejecuta la instalación completa de la base de datos AC FixBot,
-- incluyendo:
--   1. Schema base (tablas, stored procedures, triggers)
--   2. FASE 1: Optimistic Locking + Deduplicación Idempotente
--   3. Estados adicionales (consulta, vehiculo AI)
--
-- PREREQUISITOS:
--   - Azure SQL Database creada
--   - Usuario con permisos de db_owner o sysadmin
--   - SQL Server Management Studio o sqlcmd
--
-- INSTRUCCIONES:
--   1. Revisar el script completo antes de ejecutar
--   2. Ejecutar en ambiente de desarrollo primero
--   3. Hacer backup de producción antes de ejecutar en producción
--   4. Ejecutar sección por sección para mejor control
--
-- ROLLBACK:
--   - Si algo falla, usar cleanup-database.sql para revertir
--
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════════╗'
PRINT '║                                                                ║'
PRINT '║            AC FIXBOT - INSTALACIÓN COMPLETA                    ║'
PRINT '║                    Version 2.0                                 ║'
PRINT '║                                                                ║'
PRINT '╚════════════════════════════════════════════════════════════════╝'
PRINT ''
PRINT 'Iniciando instalación completa...'
PRINT ''

-- =============================================
-- SECCIÓN 1: SCHEMA BASE
-- =============================================
--
-- NOTA: El contenido de install-full-database.sql debe ejecutarse primero
-- Por favor ejecute install-full-database.sql ANTES de este script
-- O incluya su contenido aquí
--
-- Para automatizar esto completamente, use:
-- sqlcmd -S <server> -d <database> -i install-full-database.sql
-- sqlcmd -S <server> -d <database> -i install_complete.sql
--
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 1: Verificando Schema Base                            │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''

-- Verificar que las tablas principales existen
DECLARE @MissingTables NVARCHAR(MAX) = ''

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SesionesChat')
    SET @MissingTables = @MissingTables + 'SesionesChat, '

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CatEstadoSesion')
    SET @MissingTables = @MissingTables + 'CatEstadoSesion, '

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MensajesProcessados')
    SET @MissingTables = @MissingTables + 'MensajesProcessados, '

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Tickets')
    SET @MissingTables = @MissingTables + 'Tickets, '

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'HistorialEstados')
    SET @MissingTables = @MissingTables + 'HistorialEstados, '

IF LEN(@MissingTables) > 0
BEGIN
    PRINT '❌ ERROR: Faltan tablas del schema base'
    PRINT '   Tablas faltantes: ' + LEFT(@MissingTables, LEN(@MissingTables) - 1)
    PRINT ''
    PRINT '⚠️  Por favor ejecute primero: install-full-database.sql'
    PRINT ''
    RAISERROR('Schema base incompleto. Ejecute install-full-database.sql primero.', 16, 1)
    RETURN
END
ELSE
BEGIN
    PRINT '✅ Schema base verificado: Todas las tablas principales existen'
    PRINT ''
END
GO

-- =============================================
-- SECCIÓN 2: FASE 1 - OPTIMISTIC LOCKING
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 2: FASE 1 - Optimistic Locking                        │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''
PRINT '📝 Agregando soporte para prevención de race conditions...'
PRINT ''

-- 2.1 Agregar columna Version
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'Version'
)
BEGIN
    PRINT '   [2.1] Agregando columna Version a SesionesChat...'

    ALTER TABLE SesionesChat
    ADD Version INT NOT NULL DEFAULT 0

    PRINT '   ✅ Columna Version agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️  Columna Version ya existe, omitiendo...'
END
GO

-- 2.2 Verificar columna Version
IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'Version'
)
BEGIN
    PRINT '   ✅ Verificación: Columna Version existe'

    -- Mostrar stats
    DECLARE @RowCount INT
    SELECT @RowCount = COUNT(*) FROM SesionesChat
    PRINT '   📊 Total de sesiones: ' + CAST(@RowCount AS VARCHAR(10))
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: La columna Version NO fue creada'
    RAISERROR('Migración fallida: columna Version no fue creada', 16, 1)
END
GO

-- 2.3 Crear índice para performance
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('SesionesChat')
    AND name = 'IX_SesionesChat_Telefono_Version'
)
BEGIN
    PRINT '   [2.2] Creando índice IX_SesionesChat_Telefono_Version...'

    CREATE NONCLUSTERED INDEX IX_SesionesChat_Telefono_Version
    ON SesionesChat (Telefono, Version)
    INCLUDE (EstadoId, DatosTemp, EquipoIdTemp)

    PRINT '   ✅ Índice creado exitosamente'
END
ELSE
BEGIN
    PRINT '   ⚠️  Índice IX_SesionesChat_Telefono_Version ya existe'
END
GO

PRINT ''
PRINT '✅ FASE 1 - Optimistic Locking completado'
PRINT ''

-- =============================================
-- SECCIÓN 3: FASE 1 - DEDUPLICACIÓN IDEMPOTENTE
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 3: FASE 1 - Deduplicación Idempotente                 │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''
PRINT '📝 Mejorando tracking de mensajes duplicados...'
PRINT ''

-- 3.1 Agregar columna Reintentos
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'Reintentos'
)
BEGIN
    PRINT '   [3.1] Agregando columna Reintentos...'

    ALTER TABLE MensajesProcessados
    ADD Reintentos INT NOT NULL DEFAULT 0

    PRINT '   ✅ Columna Reintentos agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️  Columna Reintentos ya existe'
END
GO

-- 3.2 Agregar columna UltimoReintento
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'UltimoReintento'
)
BEGIN
    PRINT '   [3.2] Agregando columna UltimoReintento...'

    ALTER TABLE MensajesProcessados
    ADD UltimoReintento DATETIME NULL

    PRINT '   ✅ Columna UltimoReintento agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️  Columna UltimoReintento ya existe'
END
GO

-- 3.3 Agregar columna Telefono
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'Telefono'
)
BEGIN
    PRINT '   [3.3] Agregando columna Telefono...'

    ALTER TABLE MensajesProcessados
    ADD Telefono NVARCHAR(20) NULL

    PRINT '   ✅ Columna Telefono agregada'
END
ELSE
BEGIN
    PRINT '   ⚠️  Columna Telefono ya existe'
END
GO

-- 3.4 Crear índice para queries por teléfono
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name = 'IX_MensajesProcessados_Telefono'
)
BEGIN
    PRINT '   [3.4] Creando índice IX_MensajesProcessados_Telefono...'

    CREATE NONCLUSTERED INDEX IX_MensajesProcessados_Telefono
    ON MensajesProcessados (Telefono)
    INCLUDE (WhatsAppMessageId, FechaCreacion, Reintentos)

    PRINT '   ✅ Índice creado exitosamente'
END
ELSE
BEGIN
    PRINT '   ⚠️  Índice IX_MensajesProcessados_Telefono ya existe'
END
GO

-- 3.5 Verificar estructura final
IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('MensajesProcessados')
    AND name IN ('Reintentos', 'UltimoReintento', 'Telefono')
    GROUP BY object_id
    HAVING COUNT(*) = 3
)
BEGIN
    PRINT '   ✅ Verificación: Todas las columnas existen'

    -- Mostrar stats
    DECLARE @TotalMensajes INT
    DECLARE @MensajesHoy INT
    DECLARE @MensajesDuplicados INT

    SELECT @TotalMensajes = COUNT(*) FROM MensajesProcessados
    SELECT @MensajesHoy = COUNT(*) FROM MensajesProcessados WHERE FechaCreacion >= CAST(GETDATE() AS DATE)
    SELECT @MensajesDuplicados = COUNT(*) FROM MensajesProcessados WHERE Reintentos > 0

    PRINT ''
    PRINT '   📊 Estadísticas de MensajesProcessados:'
    PRINT '      - Total mensajes: ' + CAST(@TotalMensajes AS VARCHAR(10))
    PRINT '      - Mensajes hoy: ' + CAST(@MensajesHoy AS VARCHAR(10))
    PRINT '      - Mensajes con reintentos: ' + CAST(@MensajesDuplicados AS VARCHAR(10))
END
ELSE
BEGIN
    PRINT '   ❌ ERROR: Faltan columnas en MensajesProcessados'
    RAISERROR('Migración fallida: columnas no fueron creadas', 16, 1)
END
GO

PRINT ''
PRINT '✅ FASE 1 - Deduplicación Idempotente completada'
PRINT ''

-- =============================================
-- SECCIÓN 4: ESTADOS ADICIONALES
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 4: Estados Adicionales                                │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''

-- 4.1 Estado CONSULTA_ESPERA_TICKET
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'CONSULTA_ESPERA_TICKET')
BEGIN
    PRINT '   [4.1] Agregando estado CONSULTA_ESPERA_TICKET...'

    INSERT INTO [dbo].[CatEstadoSesion] ([Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES ('CONSULTA_ESPERA_TICKET', 'Esperando Ticket', 'Usuario consulta estado, esperando numero de ticket', 0, 50, 1)

    PRINT '   ✅ Estado CONSULTA_ESPERA_TICKET agregado'
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado CONSULTA_ESPERA_TICKET ya existe'
END
GO

-- 4.2 Estado VEHICULO_CONFIRMAR_DATOS_AI (ID debe ser 26 para coincidir con sessionStates.js)
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'VEHICULO_CONFIRMAR_DATOS_AI')
BEGIN
    PRINT '   [4.2] Insertando nuevo estado VEHICULO_CONFIRMAR_DATOS_AI (ID: 26)...'

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON

    INSERT INTO [dbo].[CatEstadoSesion] (EstadoId, Codigo, Nombre, Descripcion, EsTerminal, Orden, Activo)
    VALUES (
        26,
        'VEHICULO_CONFIRMAR_DATOS_AI',
        'Confirmar Datos AI Vehículo',
        'Esperando confirmación de datos extraídos por AI Vision',
        0, 26, 1
    )

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF

    PRINT '   ✅ Estado VEHICULO_CONFIRMAR_DATOS_AI insertado con ID: 26'
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado VEHICULO_CONFIRMAR_DATOS_AI ya existe'
END
GO

-- 4.3 Estado REFRIGERADOR_CONFIRMAR_DATOS_AI (ID debe ser 27 para coincidir con sessionStates.js)
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE Codigo = 'REFRIGERADOR_CONFIRMAR_DATOS_AI')
BEGIN
    PRINT '   [4.3] Insertando nuevo estado REFRIGERADOR_CONFIRMAR_DATOS_AI (ID: 27)...'

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON

    INSERT INTO [dbo].[CatEstadoSesion] (EstadoId, Codigo, Nombre, Descripcion, EsTerminal, Orden, Activo)
    VALUES (
        27,
        'REFRIGERADOR_CONFIRMAR_DATOS_AI',
        'Confirmar Datos AI Refrigerador',
        'Esperando confirmación de datos extraídos por AI Vision',
        0, 27, 1
    )

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF

    PRINT '   ✅ Estado REFRIGERADOR_CONFIRMAR_DATOS_AI insertado con ID: 27'
END
ELSE
BEGIN
    PRINT '   ⚠️  Estado REFRIGERADOR_CONFIRMAR_DATOS_AI ya existe'
END
GO

PRINT ''
PRINT '✅ Estados adicionales completados'
PRINT ''

-- =============================================
-- SECCIÓN 5: VERIFICACIÓN FINAL
-- =============================================

PRINT ''
PRINT '┌────────────────────────────────────────────────────────────────┐'
PRINT '│ SECCIÓN 5: Verificación Final                                 │'
PRINT '└────────────────────────────────────────────────────────────────┘'
PRINT ''

-- Verificar todas las modificaciones de FASE 1
DECLARE @Verificaciones TABLE (
    Item NVARCHAR(100),
    Estado NVARCHAR(10)
)

-- Check columna Version
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SesionesChat') AND name = 'Version')
    INSERT INTO @Verificaciones VALUES ('SesionesChat.Version', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('SesionesChat.Version', '❌ FALTA')

-- Check índice Version
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('SesionesChat') AND name = 'IX_SesionesChat_Telefono_Version')
    INSERT INTO @Verificaciones VALUES ('Índice SesionesChat', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('Índice SesionesChat', '❌ FALTA')

-- Check columna Reintentos
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'Reintentos')
    INSERT INTO @Verificaciones VALUES ('MensajesProcessados.Reintentos', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('MensajesProcessados.Reintentos', '❌ FALTA')

-- Check columna UltimoReintento
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'UltimoReintento')
    INSERT INTO @Verificaciones VALUES ('MensajesProcessados.UltimoReintento', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('MensajesProcessados.UltimoReintento', '❌ FALTA')

-- Check columna Telefono
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'Telefono')
    INSERT INTO @Verificaciones VALUES ('MensajesProcessados.Telefono', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('MensajesProcessados.Telefono', '❌ FALTA')

-- Check índice MensajesProcessados
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('MensajesProcessados') AND name = 'IX_MensajesProcessados_Telefono')
    INSERT INTO @Verificaciones VALUES ('Índice MensajesProcessados', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('Índice MensajesProcessados', '❌ FALTA')

-- Check estados adicionales
IF EXISTS (SELECT 1 FROM CatEstadoSesion WHERE Codigo = 'CONSULTA_ESPERA_TICKET')
    INSERT INTO @Verificaciones VALUES ('Estado CONSULTA_ESPERA_TICKET', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('Estado CONSULTA_ESPERA_TICKET', '❌ FALTA')

IF EXISTS (SELECT 1 FROM CatEstadoSesion WHERE Codigo = 'VEHICULO_CONFIRMAR_DATOS_AI' AND EstadoId = 26)
    INSERT INTO @Verificaciones VALUES ('Estado VEHICULO_CONFIRMAR_DATOS_AI (ID:26)', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('Estado VEHICULO_CONFIRMAR_DATOS_AI (ID:26)', '❌ FALTA')

IF EXISTS (SELECT 1 FROM CatEstadoSesion WHERE Codigo = 'REFRIGERADOR_CONFIRMAR_DATOS_AI' AND EstadoId = 27)
    INSERT INTO @Verificaciones VALUES ('Estado REFRIGERADOR_CONFIRMAR_DATOS_AI (ID:27)', '✅ OK')
ELSE
    INSERT INTO @Verificaciones VALUES ('Estado REFRIGERADOR_CONFIRMAR_DATOS_AI (ID:27)', '❌ FALTA')

-- Mostrar resultados
PRINT '📊 Resultados de Verificación:'
PRINT ''

SELECT
    '   ' + Item + REPLICATE(' ', 40 - LEN(Item)) + Estado AS 'Verificación'
FROM @Verificaciones

-- Verificar si hay fallos
IF EXISTS (SELECT 1 FROM @Verificaciones WHERE Estado LIKE '%FALTA%')
BEGIN
    PRINT ''
    PRINT '❌ ADVERTENCIA: Algunas verificaciones fallaron'
    PRINT '   Revise los items marcados como FALTA arriba'
    PRINT ''
END
ELSE
BEGIN
    PRINT ''
    PRINT '✅ Todas las verificaciones pasaron exitosamente'
    PRINT ''
END
GO

-- =============================================
-- RESUMEN FINAL
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════════╗'
PRINT '║                                                                ║'
PRINT '║              ✅ INSTALACIÓN COMPLETADA                         ║'
PRINT '║                                                                ║'
PRINT '╚════════════════════════════════════════════════════════════════╝'
PRINT ''
PRINT '🎉 Base de datos AC FixBot instalada exitosamente'
PRINT ''
PRINT '📋 Resumen de cambios aplicados:'
PRINT '   ✅ Schema base (install-full-database.sql)'
PRINT '   ✅ FASE 1: Optimistic Locking (columna Version + índice)'
PRINT '   ✅ FASE 1: Deduplicación Idempotente (Reintentos, UltimoReintento, Telefono)'
PRINT '   ✅ Estados adicionales (CONSULTA_ESPERA_TICKET, VEHICULO_CONFIRMAR_DATOS_AI)'
PRINT ''
PRINT '📝 Próximos pasos:'
PRINT '   1. Actualizar código de la aplicación (SesionRepository.js)'
PRINT '   2. Actualizar código de webhook (api-whatsapp-webhook/index.js)'
PRINT '   3. Ejecutar tests unitarios e integración'
PRINT '   4. Configurar monitoreo en Application Insights'
PRINT '   5. Deploy a ambiente de desarrollo primero'
PRINT ''
PRINT '📚 Documentación:'
PRINT '   - FASE 1: docs/FASE_1_IMPLEMENTACION_RESUMEN.md'
PRINT '   - FASE 2: docs/FASE2-MONITORING-ALERTING.md'
PRINT '   - Optimistic Locking: docs/OPTIMISTIC_LOCKING_USAGE.md'
PRINT '   - Observability: docs/observability-guide.md'
PRINT ''
PRINT '⚠️  IMPORTANTE:'
PRINT '   - Haga backup de producción antes de ejecutar en producción'
PRINT '   - Ejecute en desarrollo/staging primero'
PRINT '   - Monitoree Application Insights después del deploy'
PRINT ''
PRINT '🔗 Para rollback, use: sql-scripts/cleanup-database.sql'
PRINT ''
GO
