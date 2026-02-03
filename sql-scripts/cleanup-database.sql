-- ============================================
-- AC FIXBOT - Script de Limpieza Completa
-- Elimina datos transaccionales manteniendo catálogos
-- ============================================
-- ADVERTENCIA: Este script elimina TODOS los datos de prueba
-- Fecha: 2026-02-03
-- ============================================
-- NOTA: Asegúrate de estar conectado a la base de datos 'acfixbot'
--       antes de ejecutar este script (Azure SQL no permite USE)
-- ============================================

PRINT '🧹 Iniciando limpieza completa de base de datos...'
PRINT ''

-- ============================================
-- 1. LIMPIAR RESPUESTAS DE ENCUESTAS
-- ============================================
PRINT '📋 Limpiando respuestas de encuestas...'
DELETE FROM [dbo].[RespuestasEncuesta]
PRINT '✅ Respuestas de encuestas eliminadas: ' + CAST(@@ROWCOUNT AS VARCHAR)

-- ============================================
-- 2. LIMPIAR ENCUESTAS
-- ============================================
PRINT '📊 Limpiando encuestas...'
DELETE FROM [dbo].[Encuestas]
PRINT '✅ Encuestas eliminadas: ' + CAST(@@ROWCOUNT AS VARCHAR)

-- ============================================
-- 3. LIMPIAR REPORTES/TICKETS
-- ============================================
PRINT '🎫 Limpiando reportes/tickets...'
DELETE FROM [dbo].[Reportes]
PRINT '✅ Reportes eliminados: ' + CAST(@@ROWCOUNT AS VARCHAR)

-- ============================================
-- 4. LIMPIAR MENSAJES
-- ============================================
PRINT '💬 Limpiando mensajes...'
DELETE FROM [dbo].[MensajesChat]
PRINT '✅ Mensajes eliminados: ' + CAST(@@ROWCOUNT AS VARCHAR)

-- ============================================
-- 5. LIMPIAR HISTORIAL DE SESIONES
-- ============================================
PRINT '📜 Limpiando historial de sesiones...'
DELETE FROM [dbo].[HistorialSesiones]
PRINT '✅ Historial eliminado: ' + CAST(@@ROWCOUNT AS VARCHAR)

-- ============================================
-- 6. REINICIAR SESIONES A ESTADO INICIO
-- ============================================
PRINT '🔄 Reiniciando sesiones activas a INICIO...'
UPDATE [dbo].[SesionesChat]
SET
    EstadoId = 1, -- INICIO
    DatosTemp = NULL,
    EquipoIdTemp = NULL,
    TipoReporteId = NULL,
    UltimaActividad = GETDATE()
PRINT '✅ Sesiones reiniciadas: ' + CAST(@@ROWCOUNT AS VARCHAR)

-- ALTERNATIVA: Si prefieres eliminar todas las sesiones (se recrearán automáticamente)
-- DELETE FROM [dbo].[SesionesChat]
-- PRINT '✅ Sesiones eliminadas: ' + CAST(@@ROWCOUNT AS VARCHAR)

PRINT ''
PRINT '✅ ¡Limpieza completa exitosa!'
PRINT ''
PRINT '📊 Verificando estado actual de tablas...'

-- Mostrar conteos finales
SELECT 'CatEstadoSesion' AS Tabla, COUNT(*) AS Registros, 'Catálogo' AS Tipo FROM [dbo].[CatEstadoSesion]
UNION ALL
SELECT 'CatTipoReporte', COUNT(*), 'Catálogo' FROM [dbo].[CatTipoReporte]
UNION ALL
SELECT 'CatEstadoReporte', COUNT(*), 'Catálogo' FROM [dbo].[CatEstadoReporte]
UNION ALL
SELECT 'SesionesChat', COUNT(*), 'Datos' FROM [dbo].[SesionesChat]
UNION ALL
SELECT 'MensajesChat', COUNT(*), 'Datos' FROM [dbo].[MensajesChat]
UNION ALL
SELECT 'Reportes', COUNT(*), 'Datos' FROM [dbo].[Reportes]
UNION ALL
SELECT 'Encuestas', COUNT(*), 'Datos' FROM [dbo].[Encuestas]
UNION ALL
SELECT 'RespuestasEncuesta', COUNT(*), 'Datos' FROM [dbo].[RespuestasEncuesta]
ORDER BY Tipo DESC, Tabla

PRINT ''
PRINT '🎯 La base de datos está lista para usar'
