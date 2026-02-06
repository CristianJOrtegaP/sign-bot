-- =============================================
-- AC FIXBOT - Script de Instalacion Completa
-- Base de Datos: db-acfixbot
-- Version: 5.4 (Centros de Servicio integrados)
-- Fecha: 2026-01-27
-- =============================================
--
-- DESCRIPCION:
-- Script unificado para instalacion completa de la base de datos.
-- Incluye todas las tablas, catalogos, indices, stored procedures y vistas.
-- Incluye modulo de encuestas NORMALIZADO con catalogos dinamicos.
-- Incluye Dead Letter Queue para mensajes fallidos.
-- Incluye Centros de Servicio para tiempos de llegada estimados.
-- Diseñado para despliegue en Azure SQL Database.
--
-- NOVEDADES v5.4:
-- - CentrosServicio: Tabla para centros de servicio con coordenadas geograficas
-- - sp_GetCentroServicioMasCercano: Buscar centro mas cercano usando Haversine
-- - sp_GetCentrosServicioActivos: Listar centros activos
-- - Nuevos campos en Reportes: CentroServicioId, TiempoEstimadoMinutos, DistanciaCentroKm
-- - 4 centros de prueba: MTY, CDMX, GDL, QRO
--
-- NOVEDADES v5.3:
-- - DeadLetterMessages: Tabla para mensajes que fallaron durante procesamiento
-- - sp_GetDeadLettersForRetry: Obtener mensajes pendientes de reintento
-- - sp_CleanOldDeadLetters: Limpieza de mensajes antiguos procesados
--
-- NOVEDADES v5.2:
-- - 6 indices de optimizacion para queries frecuentes (spam, sesiones, equipos)
-- - Covering indexes para reducir lookups
--
-- NOVEDADES v5.1:
-- - Campos de ubicacion en Reportes: Latitud, Longitud, DireccionUbicacion
-- - Nuevo estado VEHICULO_ESPERA_UBICACION para flujo de vehiculos
-- - Indice IX_Reportes_Ubicacion para consultas geograficas
--
-- NOVEDADES v5.0:
-- - CatEstadoEncuesta: Estados de encuesta normalizados (FK en lugar de CHECK)
-- - CatTipoEncuesta: Tipos de encuesta configurables
-- - PreguntasEncuesta: Preguntas dinamicas por tipo de encuesta
-- - RespuestasEncuesta: Respuestas normalizadas
-- - Encuestas con TipoEncuestaId y EstadoEncuestaId (FKs)
-- - Vistas y SPs actualizados para estructura normalizada
--
-- ADVERTENCIA:
-- Este script ELIMINARA todas las tablas existentes y sus datos.
-- Solo ejecutar en instalacion inicial o ambientes de desarrollo/prueba.
--
-- INSTRUCCIONES:
-- 1. Conectarse a Azure SQL Database
-- 2. Crear la base de datos si no existe: CREATE DATABASE [db-acfixbot]
-- 3. Ejecutar este script completo
--
-- DATOS DE CONEXION (ejemplo):
-- Servidor: sql-acfixbot.database.windows.net
-- Base de datos: db-acfixbot
-- Puerto: 1433
--
-- =============================================

USE [db-acfixbot];
GO

-- =============================================
-- PASO 1: ELIMINAR OBJETOS EXISTENTES
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  AC FIXBOT - INSTALACION COMPLETA DE BASE DE DATOS';
PRINT '  Version 5.4 - Centros de Servicio Integrados';
PRINT '===============================================================';
PRINT '';
PRINT 'Paso 1: Eliminando objetos existentes...';
GO

-- Eliminar vistas
DROP VIEW IF EXISTS [dbo].[vw_Reportes];
DROP VIEW IF EXISTS [dbo].[vw_SesionesActivas];
DROP VIEW IF EXISTS [dbo].[vw_Encuestas];
DROP VIEW IF EXISTS [dbo].[vw_RespuestasEncuesta];
GO

-- Eliminar stored procedures
DROP PROCEDURE IF EXISTS [dbo].[sp_CheckSpam];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetHistorialTelefono];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetMetricasSesiones];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetSesionesNeedingWarning];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetSesionesToClose];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetEstadisticasReportes];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetReportesPendientesEncuesta];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetEstadisticasEncuestas];
DROP PROCEDURE IF EXISTS [dbo].[sp_ExpirarEncuestasSinRespuesta];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetDeadLettersForRetry];
DROP PROCEDURE IF EXISTS [dbo].[sp_CleanOldDeadLetters];
GO

-- Eliminar stored procedures de CentrosServicio
DROP PROCEDURE IF EXISTS [dbo].[sp_GetCentroServicioMasCercano];
DROP PROCEDURE IF EXISTS [dbo].[sp_GetCentrosServicioActivos];

-- Eliminar tablas en orden inverso por dependencias de foreign keys
DROP TABLE IF EXISTS [dbo].[DeadLetterMessages];
DROP TABLE IF EXISTS [dbo].[MensajesProcessados];
DROP TABLE IF EXISTS [dbo].[CentrosServicio];
DROP TABLE IF EXISTS [dbo].[MensajesChat];
DROP TABLE IF EXISTS [dbo].[HistorialSesiones];
DROP TABLE IF EXISTS [dbo].[RespuestasEncuesta];
DROP TABLE IF EXISTS [dbo].[Encuestas];
DROP TABLE IF EXISTS [dbo].[PreguntasEncuesta];
DROP TABLE IF EXISTS [dbo].[CatTipoEncuesta];
DROP TABLE IF EXISTS [dbo].[CatEstadoEncuesta];
DROP TABLE IF EXISTS [dbo].[Reportes];
DROP TABLE IF EXISTS [dbo].[SesionesChat];
DROP TABLE IF EXISTS [dbo].[Equipos];
DROP TABLE IF EXISTS [dbo].[Clientes];
DROP TABLE IF EXISTS [dbo].[CatEstadoReporte];
DROP TABLE IF EXISTS [dbo].[CatEstadoSesion];
DROP TABLE IF EXISTS [dbo].[CatTipoReporte];
GO

PRINT '   Objetos eliminados correctamente';
GO

-- =============================================
-- PASO 2: CREAR TABLAS CATALOGO
-- =============================================

PRINT '';
PRINT 'Paso 2: Creando tablas catalogo...';
GO

-- Catalogo de Tipos de Reporte
CREATE TABLE [dbo].[CatTipoReporte] (
    [TipoReporteId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(20) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(50) NOT NULL,
    [Descripcion] NVARCHAR(200) NULL,
    [GeneraTicket] BIT DEFAULT 1,
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE()
);

PRINT '   CatTipoReporte creada';
GO

-- Catalogo de Estados de Sesion
CREATE TABLE [dbo].[CatEstadoSesion] (
    [EstadoId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(30) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(50) NOT NULL,
    [Descripcion] NVARCHAR(200) NULL,
    [EsTerminal] BIT DEFAULT 0,
    [Orden] INT DEFAULT 0,
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE()
);

PRINT '   CatEstadoSesion creada';
GO

-- Catalogo de Estados de Reporte
CREATE TABLE [dbo].[CatEstadoReporte] (
    [EstadoReporteId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(20) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(50) NOT NULL,
    [Descripcion] NVARCHAR(200) NULL,
    [Emoji] NVARCHAR(10) NULL,
    [Orden] INT DEFAULT 0,
    [EsFinal] BIT DEFAULT 0,
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE()
);

PRINT '   CatEstadoReporte creada';
GO

-- Catalogo de Estados de Encuesta (NORMALIZADO)
CREATE TABLE [dbo].[CatEstadoEncuesta] (
    [EstadoEncuestaId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(20) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(50) NOT NULL,
    [Descripcion] NVARCHAR(200) NULL,
    [EsFinal] BIT DEFAULT 0,
    [Orden] INT DEFAULT 0,
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE()
);

PRINT '   CatEstadoEncuesta creada';
GO

-- Catalogo de Tipos de Encuesta (NORMALIZADO)
CREATE TABLE [dbo].[CatTipoEncuesta] (
    [TipoEncuestaId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(30) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(100) NOT NULL,
    [Descripcion] NVARCHAR(500) NULL,
    [NumeroPreguntas] INT NOT NULL DEFAULT 6,
    [TienePasoComentario] BIT DEFAULT 1,
    [MensajeInvitacion] NVARCHAR(500) NULL,
    [MensajeAgradecimiento] NVARCHAR(500) NULL,
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE()
);

PRINT '   CatTipoEncuesta creada';
GO

-- Catalogo de Preguntas de Encuesta (NORMALIZADO)
CREATE TABLE [dbo].[PreguntasEncuesta] (
    [PreguntaId] INT IDENTITY(1,1) PRIMARY KEY,
    [TipoEncuestaId] INT NOT NULL,
    [NumeroPregunta] INT NOT NULL,
    [TextoPregunta] NVARCHAR(500) NOT NULL,
    [TextoCorto] NVARCHAR(50) NOT NULL,
    [ValorMinimo] INT DEFAULT 1,
    [ValorMaximo] INT DEFAULT 5,
    [EtiquetaMinimo] NVARCHAR(50) DEFAULT 'Muy insatisfecho',
    [EtiquetaMaximo] NVARCHAR(50) DEFAULT 'Muy satisfecho',
    [Orden] INT NOT NULL,
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [FK_PreguntasEncuesta_Tipo] FOREIGN KEY ([TipoEncuestaId])
        REFERENCES [dbo].[CatTipoEncuesta] ([TipoEncuestaId]),

    CONSTRAINT [UQ_PreguntasEncuesta_TipoNumero] UNIQUE ([TipoEncuestaId], [NumeroPregunta])
);

CREATE NONCLUSTERED INDEX [IX_PreguntasEncuesta_Tipo]
ON [dbo].[PreguntasEncuesta] ([TipoEncuestaId], [Orden])
INCLUDE ([TextoPregunta], [TextoCorto], [Activo]);

PRINT '   PreguntasEncuesta creada';
GO

-- =============================================
-- PASO 2B: CREAR TABLA CENTROS DE SERVICIO
-- =============================================

PRINT '';
PRINT 'Paso 2B: Creando tabla CentrosServicio...';
GO

CREATE TABLE [dbo].[CentrosServicio] (
    [CentroServicioId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(20) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(100) NOT NULL,
    [Direccion] NVARCHAR(500) NULL,
    [Ciudad] NVARCHAR(100) NULL,
    [Estado] NVARCHAR(100) NULL,
    [CodigoPostal] NVARCHAR(10) NULL,

    -- Coordenadas geograficas
    [Latitud] DECIMAL(10, 8) NOT NULL,
    [Longitud] DECIMAL(11, 8) NOT NULL,

    -- Datos de contacto
    [Telefono] NVARCHAR(20) NULL,
    [Email] NVARCHAR(100) NULL,

    -- Horario de atencion (opcional)
    [HorarioApertura] TIME NULL,
    [HorarioCierre] TIME NULL,
    [DiasOperacion] NVARCHAR(50) NULL,  -- Ej: 'L-V', 'L-S', 'L-D'

    -- Metadata
    [Activo] BIT DEFAULT 1,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [FechaActualizacion] DATETIME DEFAULT GETDATE()
);

-- Indice para busquedas geograficas
CREATE NONCLUSTERED INDEX [IX_CentrosServicio_Ubicacion]
ON [dbo].[CentrosServicio] ([Latitud], [Longitud])
WHERE [Activo] = 1;

-- Indice para busquedas por codigo
CREATE NONCLUSTERED INDEX [IX_CentrosServicio_Codigo]
ON [dbo].[CentrosServicio] ([Codigo])
INCLUDE ([Nombre], [Latitud], [Longitud], [Activo]);

PRINT '   CentrosServicio creada';
GO

-- =============================================
-- PASO 3: CREAR TABLA CLIENTES
-- =============================================

PRINT '';
PRINT 'Paso 3: Creando tabla Clientes...';
GO

CREATE TABLE [dbo].[Clientes] (
    [ClienteId] INT IDENTITY(1,1) PRIMARY KEY,
    [Nombre] NVARCHAR(200) NOT NULL,
    [Direccion] NVARCHAR(500) NULL,
    [Ciudad] NVARCHAR(100) NULL,
    [Telefono] NVARCHAR(20) NULL,
    [Email] NVARCHAR(100) NULL,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [Activo] BIT DEFAULT 1
);

PRINT '   Clientes creada';
GO

-- =============================================
-- PASO 4: CREAR TABLA EQUIPOS (REFRIGERADORES)
-- =============================================

PRINT '';
PRINT 'Paso 4: Creando tabla Equipos...';
GO

CREATE TABLE [dbo].[Equipos] (
    [EquipoId] INT IDENTITY(1,1) PRIMARY KEY,
    [CodigoSAP] NVARCHAR(50) NOT NULL UNIQUE,
    [CodigoBarras] NVARCHAR(100) NULL,
    [NumeroSerie] NVARCHAR(100) NULL,
    [Modelo] NVARCHAR(100) NULL,
    [Marca] NVARCHAR(100) NULL,
    [Descripcion] NVARCHAR(500) NULL,
    [Ubicacion] NVARCHAR(200) NULL,
    [ClienteId] INT NOT NULL,
    [FechaInstalacion] DATETIME NULL,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [Activo] BIT DEFAULT 1,
    CONSTRAINT [FK_Equipos_Clientes] FOREIGN KEY ([ClienteId])
        REFERENCES [dbo].[Clientes] ([ClienteId])
);

CREATE NONCLUSTERED INDEX [IX_Equipos_CodigoSAP] ON [dbo].[Equipos] ([CodigoSAP]);
CREATE NONCLUSTERED INDEX [IX_Equipos_ClienteId] ON [dbo].[Equipos] ([ClienteId]);

PRINT '   Equipos creada';
GO

-- =============================================
-- PASO 5: CREAR TABLA REPORTES (NORMALIZADA)
-- =============================================

PRINT '';
PRINT 'Paso 5: Creando tabla Reportes...';
GO

CREATE TABLE [dbo].[Reportes] (
    [ReporteId] INT IDENTITY(1,1) PRIMARY KEY,
    [NumeroTicket] NVARCHAR(50) NOT NULL UNIQUE,
    [TelefonoReportante] NVARCHAR(20) NOT NULL,
    [Descripcion] NVARCHAR(MAX) NULL,
    [ImagenUrl] NVARCHAR(500) NULL,

    -- FK a catalogos
    [TipoReporteId] INT NOT NULL,
    [EstadoReporteId] INT NOT NULL,

    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [FechaActualizacion] DATETIME DEFAULT GETDATE(),
    [FechaResolucion] DATETIME NULL,  -- Para encuestas de satisfaccion

    -- Campos para reportes de REFRIGERADOR
    [EquipoId] INT NULL,
    [ClienteId] INT NULL,

    -- Campos para reportes de VEHICULO
    [CodigoSAPVehiculo] NVARCHAR(50) NULL,
    [NumeroEmpleado] NVARCHAR(50) NULL,

    -- Campos de ubicacion (para vehiculos)
    [Latitud] DECIMAL(10, 8) NULL,
    [Longitud] DECIMAL(11, 8) NULL,
    [DireccionUbicacion] NVARCHAR(500) NULL,

    -- Campos de Centro de Servicio (para tiempo estimado de llegada)
    [CentroServicioId] INT NULL,
    [TiempoEstimadoMinutos] INT NULL,
    [DistanciaCentroKm] DECIMAL(10, 2) NULL,

    -- Foreign Keys
    CONSTRAINT [FK_Reportes_TipoReporte] FOREIGN KEY ([TipoReporteId])
        REFERENCES [dbo].[CatTipoReporte] ([TipoReporteId]),
    CONSTRAINT [FK_Reportes_EstadoReporte] FOREIGN KEY ([EstadoReporteId])
        REFERENCES [dbo].[CatEstadoReporte] ([EstadoReporteId]),
    CONSTRAINT [FK_Reportes_Equipos] FOREIGN KEY ([EquipoId])
        REFERENCES [dbo].[Equipos] ([EquipoId]),
    CONSTRAINT [FK_Reportes_Clientes] FOREIGN KEY ([ClienteId])
        REFERENCES [dbo].[Clientes] ([ClienteId]),
    CONSTRAINT [FK_Reportes_CentroServicio] FOREIGN KEY ([CentroServicioId])
        REFERENCES [dbo].[CentrosServicio] ([CentroServicioId])
);

CREATE NONCLUSTERED INDEX [IX_Reportes_NumeroTicket] ON [dbo].[Reportes] ([NumeroTicket]);
CREATE NONCLUSTERED INDEX [IX_Reportes_TipoReporteId] ON [dbo].[Reportes] ([TipoReporteId]);
CREATE NONCLUSTERED INDEX [IX_Reportes_EstadoReporteId] ON [dbo].[Reportes] ([EstadoReporteId]);
CREATE NONCLUSTERED INDEX [IX_Reportes_EquipoId] ON [dbo].[Reportes] ([EquipoId]);
CREATE NONCLUSTERED INDEX [IX_Reportes_FechaCreacion] ON [dbo].[Reportes] ([FechaCreacion]);
CREATE NONCLUSTERED INDEX [IX_Reportes_TelefonoReportante] ON [dbo].[Reportes] ([TelefonoReportante]);

-- Filtered indexes requieren QUOTED_IDENTIFIER ON
SET QUOTED_IDENTIFIER ON;
CREATE NONCLUSTERED INDEX [IX_Reportes_FechaResolucion] ON [dbo].[Reportes] ([FechaResolucion], [EstadoReporteId])
    WHERE FechaResolucion IS NOT NULL;

-- Indice para consultas por ubicacion
CREATE NONCLUSTERED INDEX [IX_Reportes_Ubicacion] ON [dbo].[Reportes] ([Latitud], [Longitud])
    WHERE Latitud IS NOT NULL AND Longitud IS NOT NULL;

PRINT '   Reportes creada (incluye ubicacion y FechaResolucion)';
GO

-- =============================================
-- PASO 6: CREAR TABLA SESIONES DE CHAT
-- =============================================

PRINT '';
PRINT 'Paso 6: Creando tabla SesionesChat...';
GO

CREATE TABLE [dbo].[SesionesChat] (
    [SesionId] INT IDENTITY(1,1) PRIMARY KEY,
    [Telefono] NVARCHAR(20) NOT NULL UNIQUE,

    -- FKs a catalogos
    [TipoReporteId] INT NULL,
    [EstadoId] INT NOT NULL,

    [DatosTemp] NVARCHAR(MAX) NULL,
    [EquipoIdTemp] INT NULL,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [UltimaActividad] DATETIME DEFAULT GETDATE(),

    -- Control de spam
    [ContadorMensajes] INT DEFAULT 0,
    [UltimoResetContador] DATETIME DEFAULT GETDATE(),

    -- Control de advertencia de timeout
    [AdvertenciaEnviada] BIT DEFAULT 0 NOT NULL,
    [FechaAdvertencia] DATETIME NULL,

    -- Optimistic Locking (previene race conditions)
    [Version] INT NOT NULL DEFAULT 0,

    -- Nombre de usuario de WhatsApp
    [NombreUsuario] NVARCHAR(200) NULL,

    -- Soporte para Handoff a agente humano
    [AgenteId] NVARCHAR(100) NULL,
    [AgenteNombre] NVARCHAR(200) NULL,
    [FechaTomaAgente] DATETIME NULL,

    CONSTRAINT [FK_SesionesChat_TipoReporte] FOREIGN KEY ([TipoReporteId])
        REFERENCES [dbo].[CatTipoReporte] ([TipoReporteId]),
    CONSTRAINT [FK_SesionesChat_Estado] FOREIGN KEY ([EstadoId])
        REFERENCES [dbo].[CatEstadoSesion] ([EstadoId])
);

-- NOTA: IX_SesionesChat_Telefono eliminado por redundante
-- Los indices IX_SesionesChat_Telefono_Estado_Full y IX_SesionesChat_Telefono_Version ya cubren busquedas por Telefono
CREATE NONCLUSTERED INDEX [IX_SesionesChat_EstadoId] ON [dbo].[SesionesChat] ([EstadoId]);
CREATE NONCLUSTERED INDEX [IX_SesionesChat_UltimaActividad] ON [dbo].[SesionesChat] ([UltimaActividad]);
CREATE NONCLUSTERED INDEX [IX_SesionesChat_UltimaActividad_Estado]
    ON [dbo].[SesionesChat] ([UltimaActividad], [EstadoId])
    INCLUDE ([Telefono], [SesionId]);

-- Indice para optimistic locking
CREATE NONCLUSTERED INDEX [IX_SesionesChat_Telefono_Version]
    ON [dbo].[SesionesChat] ([Telefono], [Version])
    INCLUDE ([EstadoId], [DatosTemp], [EquipoIdTemp]);

-- Indice para buscar sesiones con agente
CREATE NONCLUSTERED INDEX [IX_SesionesChat_AgenteId]
    ON [dbo].[SesionesChat] ([AgenteId])
    WHERE [AgenteId] IS NOT NULL;

PRINT '   SesionesChat creada (incluye Version, NombreUsuario, Agente)';
GO

-- =============================================
-- PASO 7: CREAR TABLA HISTORIAL DE SESIONES
-- =============================================

PRINT '';
PRINT 'Paso 7: Creando tabla HistorialSesiones...';
GO

CREATE TABLE [dbo].[HistorialSesiones] (
    [HistorialId] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [Telefono] NVARCHAR(20) NOT NULL,

    [TipoReporteId] INT NULL,
    [EstadoAnteriorId] INT NULL,
    [EstadoNuevoId] INT NOT NULL,

    [OrigenAccion] NVARCHAR(20) NOT NULL,
    [Descripcion] NVARCHAR(200) NULL,
    [DatosExtra] NVARCHAR(MAX) NULL,
    [ReporteId] INT NULL,

    [FechaAccion] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [FK_HistorialSesiones_TipoReporte] FOREIGN KEY ([TipoReporteId])
        REFERENCES [dbo].[CatTipoReporte] ([TipoReporteId]),
    CONSTRAINT [FK_HistorialSesiones_EstadoAnterior] FOREIGN KEY ([EstadoAnteriorId])
        REFERENCES [dbo].[CatEstadoSesion] ([EstadoId]),
    CONSTRAINT [FK_HistorialSesiones_EstadoNuevo] FOREIGN KEY ([EstadoNuevoId])
        REFERENCES [dbo].[CatEstadoSesion] ([EstadoId])
);

CREATE NONCLUSTERED INDEX [IX_HistorialSesiones_Telefono] ON [dbo].[HistorialSesiones] ([Telefono], [FechaAccion]);
CREATE NONCLUSTERED INDEX [IX_HistorialSesiones_Fecha] ON [dbo].[HistorialSesiones] ([FechaAccion]);
CREATE NONCLUSTERED INDEX [IX_HistorialSesiones_OrigenAccion] ON [dbo].[HistorialSesiones] ([OrigenAccion], [FechaAccion]);

PRINT '   HistorialSesiones creada';
GO

-- =============================================
-- PASO 8: CREAR TABLA MENSAJES DE CHAT
-- =============================================

PRINT '';
PRINT 'Paso 8: Creando tabla MensajesChat...';
GO

CREATE TABLE [dbo].[MensajesChat] (
    [MensajeId] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [SesionId] INT NOT NULL,
    [Telefono] NVARCHAR(20) NOT NULL,

    [Tipo] CHAR(1) NOT NULL,
    [Contenido] NVARCHAR(2000) NULL,
    [TipoContenido] NVARCHAR(20) DEFAULT 'TEXTO',

    [IntencionDetectada] NVARCHAR(50) NULL,
    [ConfianzaIA] DECIMAL(5,4) NULL,

    -- Soporte para mensajes de agente humano (Tipo='A')
    [AgenteId] NVARCHAR(100) NULL,

    [FechaCreacion] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [FK_MensajesChat_Sesion] FOREIGN KEY ([SesionId])
        REFERENCES [dbo].[SesionesChat] ([SesionId])
);

CREATE NONCLUSTERED INDEX [IX_MensajesChat_Telefono] ON [dbo].[MensajesChat] ([Telefono], [FechaCreacion]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_SesionId] ON [dbo].[MensajesChat] ([SesionId]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_FechaCreacion] ON [dbo].[MensajesChat] ([FechaCreacion]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_Tipo] ON [dbo].[MensajesChat] ([Tipo], [FechaCreacion]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_AgenteId] ON [dbo].[MensajesChat] ([AgenteId]) WHERE [AgenteId] IS NOT NULL;

PRINT '   MensajesChat creada';
GO

-- =============================================
-- PASO 8B: CREAR TABLA MENSAJES PROCESADOS (DEDUPLICACION)
-- =============================================

PRINT '';
PRINT 'Paso 8B: Creando tabla MensajesProcessados...';
GO

-- Tabla para deduplicacion de mensajes de WhatsApp
-- Previene procesar el mismo mensaje multiples veces (reintentos de webhook)
CREATE TABLE [dbo].[MensajesProcessados] (
    [Id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [WhatsAppMessageId] NVARCHAR(100) NOT NULL,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [UQ_MensajesProcessados_MessageId] UNIQUE ([WhatsAppMessageId])
);

-- Indice para limpieza de registros antiguos
CREATE NONCLUSTERED INDEX [IX_MensajesProcessados_FechaCreacion] ON [dbo].[MensajesProcessados] ([FechaCreacion]);

PRINT '   MensajesProcessados creada (deduplicacion de webhooks)';
GO

-- =============================================
-- PASO 8B2: CREAR TABLA DEAD LETTER (MENSAJES FALLIDOS)
-- =============================================

PRINT '';
PRINT 'Paso 8B2: Creando tabla DeadLetterMessages...';
GO

-- Tabla para almacenar mensajes que fallaron durante el procesamiento
-- Permite reintentos manuales o automaticos y analisis de errores
CREATE TABLE [dbo].[DeadLetterMessages] (
    [DeadLetterId] INT IDENTITY(1,1) PRIMARY KEY,

    -- Datos del mensaje original
    [WhatsAppMessageId] NVARCHAR(100) NOT NULL,
    [Telefono] NVARCHAR(20) NOT NULL,
    [TipoMensaje] NVARCHAR(20) NOT NULL,  -- 'text', 'image', 'interactive', 'location'
    [Contenido] NVARCHAR(MAX) NULL,        -- Mensaje de texto o datos JSON
    [CorrelationId] NVARCHAR(50) NULL,     -- Para tracing

    -- Datos del error
    [ErrorMessage] NVARCHAR(1000) NOT NULL,
    [ErrorStack] NVARCHAR(MAX) NULL,
    [ErrorCode] NVARCHAR(50) NULL,

    -- Control de reintentos
    [RetryCount] INT DEFAULT 0,
    [MaxRetries] INT DEFAULT 3,
    [NextRetryAt] DATETIME NULL,
    [LastRetryAt] DATETIME NULL,

    -- Estado: PENDING, RETRYING, PROCESSED, FAILED, SKIPPED
    [Estado] NVARCHAR(20) DEFAULT 'PENDING',
    [ProcessedAt] DATETIME NULL,

    -- Metadata
    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [FechaActualizacion] DATETIME DEFAULT GETDATE(),

    -- Evitar duplicados en la misma ventana
    CONSTRAINT [UQ_DeadLetter_MessageId] UNIQUE ([WhatsAppMessageId])
);

-- Indice para buscar mensajes pendientes de reintento
CREATE NONCLUSTERED INDEX [IX_DeadLetter_PendingRetry]
ON [dbo].[DeadLetterMessages] ([Estado], [NextRetryAt])
WHERE [Estado] IN ('PENDING', 'RETRYING')
INCLUDE ([Telefono], [TipoMensaje], [RetryCount]);

-- Indice para buscar por telefono (analisis de usuarios con problemas)
CREATE NONCLUSTERED INDEX [IX_DeadLetter_Telefono]
ON [dbo].[DeadLetterMessages] ([Telefono], [FechaCreacion] DESC)
INCLUDE ([TipoMensaje], [Estado], [ErrorMessage]);

-- Indice para limpieza de mensajes antiguos
CREATE NONCLUSTERED INDEX [IX_DeadLetter_Cleanup]
ON [dbo].[DeadLetterMessages] ([Estado], [FechaCreacion])
WHERE [Estado] IN ('PROCESSED', 'FAILED', 'SKIPPED');

PRINT '   DeadLetterMessages creada (mensajes fallidos para reintento)';
GO

-- =============================================
-- PASO 8C: CREAR TABLA ENCUESTAS DE SATISFACCION (NORMALIZADA)
-- =============================================

PRINT '';
PRINT 'Paso 8C: Creando tabla Encuestas (normalizada)...';
GO

CREATE TABLE [dbo].[Encuestas] (
    [EncuestaId] INT IDENTITY(1,1) PRIMARY KEY,
    [ReporteId] INT NOT NULL,
    [TelefonoEncuestado] NVARCHAR(20) NOT NULL,

    -- FK a catalogos normalizados
    [TipoEncuestaId] INT NOT NULL,
    [EstadoEncuestaId] INT NOT NULL,

    -- Control de envio
    [FechaEnvio] DATETIME DEFAULT GETDATE(),
    [FechaInicio] DATETIME NULL,          -- Cuando el usuario acepta
    [FechaFinalizacion] DATETIME NULL,    -- Cuando termina

    -- Estado: ENVIADA, EN_PROCESO, COMPLETADA, RECHAZADA, EXPIRADA (retrocompat)
    [Estado] NVARCHAR(20) NOT NULL DEFAULT 'ENVIADA',

    -- Respuestas legacy (1-5, NULL si no respondio) - se mantienen para retrocompatibilidad
    [Pregunta1] TINYINT NULL,
    [Pregunta2] TINYINT NULL,
    [Pregunta3] TINYINT NULL,
    [Pregunta4] TINYINT NULL,
    [Pregunta5] TINYINT NULL,
    [Pregunta6] TINYINT NULL,

    -- Comentario opcional
    [TieneComentario] BIT DEFAULT 0,
    [Comentario] NVARCHAR(1000) NULL,

    -- Metadatos
    [PreguntaActual] TINYINT DEFAULT 0,   -- 0=no iniciada, 1-N=pregunta, N+1=comentario
    [FechaCreacion] DATETIME DEFAULT GETDATE(),
    [FechaActualizacion] DATETIME DEFAULT GETDATE(),

    -- Foreign Keys
    CONSTRAINT [FK_Encuestas_Reportes] FOREIGN KEY ([ReporteId])
        REFERENCES [dbo].[Reportes] ([ReporteId]),
    CONSTRAINT [FK_Encuestas_TipoEncuesta] FOREIGN KEY ([TipoEncuestaId])
        REFERENCES [dbo].[CatTipoEncuesta] ([TipoEncuestaId]),
    CONSTRAINT [FK_Encuestas_EstadoEncuesta] FOREIGN KEY ([EstadoEncuestaId])
        REFERENCES [dbo].[CatEstadoEncuesta] ([EstadoEncuestaId]),

    -- Validacion de respuestas legacy 1-5
    CONSTRAINT [CK_Encuestas_Pregunta1] CHECK (Pregunta1 IS NULL OR Pregunta1 BETWEEN 1 AND 5),
    CONSTRAINT [CK_Encuestas_Pregunta2] CHECK (Pregunta2 IS NULL OR Pregunta2 BETWEEN 1 AND 5),
    CONSTRAINT [CK_Encuestas_Pregunta3] CHECK (Pregunta3 IS NULL OR Pregunta3 BETWEEN 1 AND 5),
    CONSTRAINT [CK_Encuestas_Pregunta4] CHECK (Pregunta4 IS NULL OR Pregunta4 BETWEEN 1 AND 5),
    CONSTRAINT [CK_Encuestas_Pregunta5] CHECK (Pregunta5 IS NULL OR Pregunta5 BETWEEN 1 AND 5),
    CONSTRAINT [CK_Encuestas_Pregunta6] CHECK (Pregunta6 IS NULL OR Pregunta6 BETWEEN 1 AND 5)
);

-- Indices para Encuestas
CREATE NONCLUSTERED INDEX [IX_Encuestas_Estado]
ON [dbo].[Encuestas] ([EstadoEncuestaId])
INCLUDE ([TelefonoEncuestado], [FechaEnvio]);

CREATE NONCLUSTERED INDEX [IX_Encuestas_Telefono]
ON [dbo].[Encuestas] ([TelefonoEncuestado], [EstadoEncuestaId])
INCLUDE ([EncuestaId], [ReporteId], [PreguntaActual], [TipoEncuestaId]);

CREATE NONCLUSTERED INDEX [IX_Encuestas_ReporteId]
ON [dbo].[Encuestas] ([ReporteId]);

CREATE NONCLUSTERED INDEX [IX_Encuestas_TipoEncuestaId]
ON [dbo].[Encuestas] ([TipoEncuestaId]);

CREATE NONCLUSTERED INDEX [IX_Encuestas_EstadoEncuestaId]
ON [dbo].[Encuestas] ([EstadoEncuestaId]);

PRINT '   Encuestas creada (normalizada con FKs a catalogos)';
GO

-- =============================================
-- PASO 8D: CREAR TABLA RESPUESTAS DE ENCUESTA (NORMALIZADA)
-- =============================================

PRINT '';
PRINT 'Paso 8D: Creando tabla RespuestasEncuesta...';
GO

CREATE TABLE [dbo].[RespuestasEncuesta] (
    [RespuestaId] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [EncuestaId] INT NOT NULL,
    [PreguntaId] INT NOT NULL,
    [Valor] TINYINT NOT NULL,
    [FechaRespuesta] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [FK_RespuestasEncuesta_Encuesta] FOREIGN KEY ([EncuestaId])
        REFERENCES [dbo].[Encuestas] ([EncuestaId]),
    CONSTRAINT [FK_RespuestasEncuesta_Pregunta] FOREIGN KEY ([PreguntaId])
        REFERENCES [dbo].[PreguntasEncuesta] ([PreguntaId]),

    -- Una sola respuesta por encuesta-pregunta
    CONSTRAINT [UQ_RespuestasEncuesta_EncuestaPregunta] UNIQUE ([EncuestaId], [PreguntaId]),

    -- Validacion de valor
    CONSTRAINT [CK_RespuestasEncuesta_Valor] CHECK (Valor BETWEEN 1 AND 5)
);

-- Indice para obtener todas las respuestas de una encuesta
CREATE NONCLUSTERED INDEX [IX_RespuestasEncuesta_Encuesta]
ON [dbo].[RespuestasEncuesta] ([EncuestaId])
INCLUDE ([PreguntaId], [Valor], [FechaRespuesta]);

PRINT '   RespuestasEncuesta creada';
GO

-- =============================================
-- PASO 9: INSERTAR DATOS EN CATALOGOS
-- =============================================

PRINT '';
PRINT 'Paso 9: Insertando datos en catalogos...';
GO

-- Tipos de Reporte
INSERT INTO [dbo].[CatTipoReporte] ([Codigo], [Nombre], [Descripcion], [GeneraTicket], [Activo]) VALUES
('REFRIGERADOR', 'Reporte de Refrigerador', 'Reporte de falla en equipo de refrigeracion', 1, 1),
('VEHICULO', 'Reporte de Vehiculo', 'Reporte de falla en vehiculo de flota', 1, 1),
('CONSULTA', 'Consulta de Estado', 'Consulta del estado de un ticket existente', 0, 1);

PRINT '   CatTipoReporte: 3 registros';
GO

-- Estados de Sesion (incluye estados de encuesta)
INSERT INTO [dbo].[CatEstadoSesion] ([Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo]) VALUES
-- Estados base
('INICIO', 'Inicio', 'Sesion nueva o reactivada, esperando seleccion de flujo', 1, 0, 1),
('CANCELADO', 'Cancelado', 'Sesion cancelada explicitamente por el usuario', 1, 100, 1),
('FINALIZADO', 'Finalizado', 'Flujo completado exitosamente, reporte creado', 1, 101, 1),
('TIMEOUT', 'Timeout', 'Sesion cerrada por inactividad', 1, 102, 1),
-- Estados de Refrigerador
('REFRI_ESPERA_SAP', 'Esperando SAP Refrigerador', 'Esperando codigo SAP del refrigerador', 0, 10, 1),
('REFRI_CONFIRMAR_EQUIPO', 'Confirmar Equipo', 'Esperando confirmacion de datos del equipo', 0, 11, 1),
('REFRI_ESPERA_DESCRIPCION', 'Esperando Descripcion Refrigerador', 'Esperando descripcion del problema', 0, 12, 1),
-- Estados de Vehiculo
('VEHICULO_ESPERA_EMPLEADO', 'Esperando Numero Empleado', 'Esperando numero de empleado', 0, 20, 1),
('VEHICULO_ESPERA_SAP', 'Esperando SAP Vehiculo', 'Esperando codigo SAP del vehiculo', 0, 21, 1),
('VEHICULO_ESPERA_DESCRIPCION', 'Esperando Descripcion Vehiculo', 'Esperando descripcion del problema', 0, 22, 1),
('VEHICULO_ESPERA_UBICACION', 'Esperando Ubicacion Vehiculo', 'Esperando ubicacion del vehiculo para el reporte', 0, 23, 1),
-- Estados de Consulta
('CONSULTA_ESPERA_TICKET', 'Esperando Ticket', 'Usuario consulta estado, esperando numero de ticket', 0, 30, 1),
-- Estados de Encuesta de Satisfaccion
('ENCUESTA_INVITACION', 'Invitacion Encuesta', 'Esperando aceptar/rechazar encuesta', 0, 40, 1),
('ENCUESTA_PREGUNTA_1', 'Encuesta Pregunta 1', 'Pregunta: Atencion al reportar', 0, 41, 1),
('ENCUESTA_PREGUNTA_2', 'Encuesta Pregunta 2', 'Pregunta: Tiempo de reparacion', 0, 42, 1),
('ENCUESTA_PREGUNTA_3', 'Encuesta Pregunta 3', 'Pregunta: Fecha compromiso', 0, 43, 1),
('ENCUESTA_PREGUNTA_4', 'Encuesta Pregunta 4', 'Pregunta: Unidad limpia', 0, 44, 1),
('ENCUESTA_PREGUNTA_5', 'Encuesta Pregunta 5', 'Pregunta: Informacion reparacion', 0, 45, 1),
('ENCUESTA_PREGUNTA_6', 'Encuesta Pregunta 6', 'Pregunta: Falla corregida', 0, 46, 1),
('ENCUESTA_COMENTARIO', 'Encuesta Comentario', 'Pregunta si desea dejar comentario', 0, 47, 1),
('ENCUESTA_ESPERA_COMENTARIO', 'Esperando Comentario', 'Esperando texto de comentario', 0, 48, 1),
-- Estados Flexibles (FASE 2b) - IA Vision
('REFRI_ACTIVO', 'Refrigerador Activo', 'Flujo flexible de refrigerador en progreso', 0, 50, 1),
('VEHICULO_ACTIVO', 'Vehiculo Activo', 'Flujo flexible de vehiculo en progreso', 0, 51, 1),
('AI_CONFIRMAR', 'Confirmar IA', 'Esperando confirmacion de datos extraidos por IA', 0, 52, 1),
('AI_VISION_CONFIRMAR', 'Confirmar Vision IA', 'Esperando confirmacion de codigo SAP extraido por OCR', 0, 53, 1),
('CONFIRMAR_DATOS', 'Confirmar Datos', 'Mostrando resumen de datos para confirmacion final', 0, 54, 1),
-- Estado de Handoff a Agente Humano
('AGENTE_ACTIVO', 'Atencion por Agente', 'Conversacion tomada por un agente humano', 0, 60, 1);

PRINT '   CatEstadoSesion: 28 registros (base + consulta + encuesta + flexibles + agente)';
GO

-- Estados de Reporte
INSERT INTO [dbo].[CatEstadoReporte] ([Codigo], [Nombre], [Descripcion], [Emoji], [Orden], [EsFinal], [Activo]) VALUES
('PENDIENTE', 'Pendiente', 'Reporte en cola, esperando asignacion de tecnico', N'🟡', 1, 0, 1),
('EN_PROCESO', 'En Proceso', 'Tecnico asignado y trabajando en el reporte', N'🔵', 2, 0, 1),
('RESUELTO', 'Resuelto', 'Reporte completado exitosamente', N'🟢', 3, 1, 1),
('CANCELADO', 'Cancelado', 'Reporte cancelado por el usuario o el sistema', N'🔴', 4, 1, 1);

PRINT '   CatEstadoReporte: 4 registros';
GO

-- Estados de Encuesta (normalizados)
INSERT INTO [dbo].[CatEstadoEncuesta] ([Codigo], [Nombre], [Descripcion], [EsFinal], [Orden]) VALUES
('ENVIADA', 'Enviada', 'Encuesta enviada, esperando respuesta del usuario', 0, 1),
('EN_PROCESO', 'En Proceso', 'Usuario respondiendo la encuesta', 0, 2),
('COMPLETADA', 'Completada', 'Encuesta finalizada exitosamente', 1, 3),
('RECHAZADA', 'Rechazada', 'Usuario rechazo participar en la encuesta', 1, 4),
('EXPIRADA', 'Expirada', 'Encuesta expiro sin respuesta', 1, 5);

PRINT '   CatEstadoEncuesta: 5 registros';
GO

-- Tipos de Encuesta
INSERT INTO [dbo].[CatTipoEncuesta]
    ([Codigo], [Nombre], [Descripcion], [NumeroPreguntas], [TienePasoComentario], [MensajeInvitacion], [MensajeAgradecimiento])
VALUES
(
    'SATISFACCION_SERVICIO',
    'Encuesta de Satisfaccion del Servicio',
    'Encuesta estandar de 6 preguntas para evaluar la calidad del servicio de reparacion',
    6,
    1,
    N'¡Hola! Queremos conocer tu opinion sobre el servicio que recibiste para tu ticket {TICKET}. ¿Podrias ayudarnos con una breve encuesta?',
    N'¡Gracias por completar nuestra encuesta! Tu opinion nos ayuda a mejorar.'
);

PRINT '   CatTipoEncuesta: 1 registro (SATISFACCION_SERVICIO)';
GO

-- Preguntas de Encuesta
DECLARE @TipoSatisfaccionId INT;
SELECT @TipoSatisfaccionId = TipoEncuestaId FROM [dbo].[CatTipoEncuesta] WHERE Codigo = 'SATISFACCION_SERVICIO';

INSERT INTO [dbo].[PreguntasEncuesta]
    ([TipoEncuestaId], [NumeroPregunta], [TextoPregunta], [TextoCorto], [Orden])
VALUES
(@TipoSatisfaccionId, 1, N'¿Como califica la atencion recibida al momento de reportar la falla?', 'Atencion al reportar', 1),
(@TipoSatisfaccionId, 2, N'¿El tiempo de reparacion fue adecuado?', 'Tiempo de reparacion', 2),
(@TipoSatisfaccionId, 3, N'¿Se cumplio con la fecha compromiso de reparacion?', 'Fecha compromiso', 3),
(@TipoSatisfaccionId, 4, N'¿La unidad fue entregada limpia despues de la reparacion?', 'Unidad limpia', 4),
(@TipoSatisfaccionId, 5, N'¿Le proporcionaron informacion sobre la reparacion realizada?', 'Info reparacion', 5),
(@TipoSatisfaccionId, 6, N'¿La falla reportada quedo corregida?', 'Falla corregida', 6);

PRINT '   PreguntasEncuesta: 6 registros';
GO

-- =============================================
-- PASO 10: INSERTAR DATOS DE PRUEBA - CLIENTES
-- =============================================

PRINT '';
PRINT 'Paso 10: Insertando datos de prueba en Clientes...';
GO

SET IDENTITY_INSERT [dbo].[Clientes] ON;

INSERT INTO [dbo].[Clientes] ([ClienteId], [Nombre], [Direccion], [Ciudad], [Telefono], [Email], [Activo]) VALUES
(1, 'OXXO Sucursal Centro', 'Av. Juarez #123, Centro', 'Monterrey', '8181234567', 'oxxo.centro@ejemplo.com', 1),
(2, 'OXXO Sucursal San Pedro', 'Av. Constitucion #456, San Pedro', 'San Pedro Garza Garcia', '8187654321', 'oxxo.sanpedro@ejemplo.com', 1),
(3, 'Extra Super Norte', 'Blvd. Bernardo Reyes #789', 'Monterrey', '8183456789', 'extra.norte@ejemplo.com', 1),
(4, 'Extra Super Sur', 'Av. Insurgentes #321', 'Monterrey', '8189876543', 'extra.sur@ejemplo.com', 1),
(5, 'Bodega Aurrera Apodaca', 'Carr. Miguel Aleman Km 24', 'Apodaca', '8182345678', 'bodega.apodaca@ejemplo.com', 1),
(6, 'Soriana Hiper Valle', 'Av. Eugenio Garza Sada #2411', 'Monterrey', '8186789012', 'soriana.valle@ejemplo.com', 1),
(7, 'HEB Lincoln', 'Av. Abraham Lincoln #500', 'Monterrey', '8185432109', 'heb.lincoln@ejemplo.com', 1),
(8, 'Walmart Cumbres', 'Av. Paseo de los Leones #1000', 'Monterrey', '8184567890', 'walmart.cumbres@ejemplo.com', 1);

SET IDENTITY_INSERT [dbo].[Clientes] OFF;

PRINT '   Clientes: 8 registros';
GO

-- =============================================
-- PASO 11: INSERTAR DATOS DE PRUEBA - EQUIPOS
-- =============================================

PRINT '';
PRINT 'Paso 11: Insertando datos de prueba en Equipos...';
GO

SET IDENTITY_INSERT [dbo].[Equipos] ON;

INSERT INTO [dbo].[Equipos] ([EquipoId], [CodigoSAP], [CodigoBarras], [NumeroSerie], [Modelo], [Marca], [Descripcion], [Ubicacion], [ClienteId], [FechaInstalacion], [Activo]) VALUES
(1, 'REF001', 'BARR001', 'SN-2024-001', 'VR-350', 'Imbera', 'Refrigerador vertical de 350L', 'Area de bebidas principal', 1, '2024-01-15', 1),
(2, 'REF002', 'BARR002', 'SN-2024-002', 'VR-500', 'Imbera', 'Refrigerador vertical de 500L', 'Entrada principal', 1, '2024-02-20', 1),
(3, 'REF003', 'BARR003', 'SN-2024-003', 'VR-350', 'Metalfrio', 'Refrigerador vertical de 350L', 'Pasillo central', 2, '2024-01-10', 1),
(4, 'REF004', 'BARR004', 'SN-2024-004', 'VR-450', 'Torrey', 'Refrigerador vertical de 450L', 'Zona de lacteos', 2, '2024-03-05', 1),
(5, 'REF005', 'BARR005', 'SN-2024-005', 'HZ-600', 'Imbera', 'Refrigerador horizontal de 600L', 'Area de congelados', 3, '2024-01-20', 1),
(6, 'REF006', 'BARR006', 'SN-2024-006', 'VR-350', 'Metalfrio', 'Refrigerador vertical de 350L', 'Entrada tienda', 3, '2024-02-15', 1),
(7, 'REF007', 'BARR007', 'SN-2024-007', 'VR-500', 'Imbera', 'Refrigerador vertical de 500L', 'Pasillo bebidas', 4, '2024-03-10', 1),
(8, 'REF008', 'BARR008', 'SN-2024-008', 'VR-400', 'Torrey', 'Refrigerador vertical de 400L', 'Zona productos frescos', 4, '2024-01-25', 1),
(9, 'REF009', 'BARR009', 'SN-2024-009', 'VR-350', 'Imbera', 'Refrigerador vertical de 350L', 'Entrada lateral', 5, '2024-02-01', 1),
(10, 'REF010', 'BARR010', 'SN-2024-010', 'HZ-800', 'Metalfrio', 'Refrigerador horizontal de 800L', 'Area de helados', 5, '2024-03-15', 1),
(11, 'REF011', 'BARR011', 'SN-2024-011', 'VR-450', 'Imbera', 'Refrigerador vertical de 450L', 'Pasillo central', 6, '2024-01-30', 1),
(12, 'REF012', 'BARR012', 'SN-2024-012', 'VR-350', 'Torrey', 'Refrigerador vertical de 350L', 'Zona bebidas', 6, '2024-02-10', 1),
(13, 'REF013', 'BARR013', 'SN-2024-013', 'VR-500', 'Metalfrio', 'Refrigerador vertical de 500L', 'Entrada principal', 7, '2024-03-20', 1),
(14, 'REF014', 'BARR014', 'SN-2024-014', 'VR-400', 'Imbera', 'Refrigerador vertical de 400L', 'Pasillo lacteos', 7, '2024-01-12', 1),
(15, 'REF015', 'BARR015', 'SN-2024-015', 'VR-350', 'Torrey', 'Refrigerador vertical de 350L', 'Area de refrescos', 8, '2024-02-25', 1),
(16, '4045101', 'BARR016', 'SN-2024-016', 'VR-450', 'Imbera', 'Refrigerador vertical de 450L', 'Zona de bebidas frias', 1, '2024-03-01', 1);

SET IDENTITY_INSERT [dbo].[Equipos] OFF;

PRINT '   Equipos: 16 registros';
GO

-- =============================================
-- PASO 11B: INSERTAR DATOS DE PRUEBA - CENTROS DE SERVICIO
-- =============================================

PRINT '';
PRINT 'Paso 11B: Insertando datos de prueba en CentrosServicio...';
GO

INSERT INTO [dbo].[CentrosServicio]
    ([Codigo], [Nombre], [Direccion], [Ciudad], [Estado], [CodigoPostal], [Latitud], [Longitud], [Telefono], [HorarioApertura], [HorarioCierre], [DiasOperacion])
VALUES
-- Centro de Monterrey
(
    'CS-MTY',
    'Centro de Servicio Monterrey',
    'Av. Eugenio Garza Sada 2501, Tecnologico',
    'Monterrey',
    'Nuevo Leon',
    '64849',
    25.6514,      -- Latitud Monterrey (cerca del Tec)
    -100.2895,    -- Longitud Monterrey
    '8181234567',
    '08:00',
    '18:00',
    'L-S'
),
-- Centro de CDMX
(
    'CS-CDMX',
    'Centro de Servicio CDMX',
    'Av. Insurgentes Sur 1602, Credito Constructor',
    'Ciudad de Mexico',
    'CDMX',
    '03940',
    19.3910,      -- Latitud CDMX (zona sur)
    -99.1737,     -- Longitud CDMX
    '5551234567',
    '08:00',
    '18:00',
    'L-S'
),
-- Centro de Guadalajara
(
    'CS-GDL',
    'Centro de Servicio Guadalajara',
    'Av. Vallarta 3233, Vallarta Poniente',
    'Guadalajara',
    'Jalisco',
    '44110',
    20.6767,      -- Latitud Guadalajara
    -103.3825,    -- Longitud Guadalajara
    '3331234567',
    '08:00',
    '18:00',
    'L-S'
),
-- Centro de Queretaro
(
    'CS-QRO',
    'Centro de Servicio Queretaro',
    'Blvd. Bernardo Quintana 4100, Alamos 3a Seccion',
    'Queretaro',
    'Queretaro',
    '76160',
    20.5888,      -- Latitud Queretaro
    -100.3899,    -- Longitud Queretaro
    '4421234567',
    '08:00',
    '18:00',
    'L-V'
);

PRINT '   CentrosServicio: 4 registros (MTY, CDMX, GDL, QRO)';
GO

-- =============================================
-- PASO 12: INSERTAR DATOS DE PRUEBA - REPORTES
-- =============================================

PRINT '';
PRINT 'Paso 12: Insertando datos de prueba en Reportes...';
GO

-- Obtener IDs de estados de reporte
DECLARE @EstadoPendiente INT, @EstadoEnProceso INT, @EstadoResuelto INT;
SELECT @EstadoPendiente = EstadoReporteId FROM CatEstadoReporte WHERE Codigo = 'PENDIENTE';
SELECT @EstadoEnProceso = EstadoReporteId FROM CatEstadoReporte WHERE Codigo = 'EN_PROCESO';
SELECT @EstadoResuelto = EstadoReporteId FROM CatEstadoReporte WHERE Codigo = 'RESUELTO';

SET IDENTITY_INSERT [dbo].[Reportes] ON;

INSERT INTO [dbo].[Reportes] ([ReporteId], [NumeroTicket], [TelefonoReportante], [Descripcion], [ImagenUrl], [TipoReporteId], [EstadoReporteId], [FechaCreacion], [FechaActualizacion], [FechaResolucion], [EquipoId], [ClienteId], [CodigoSAPVehiculo], [NumeroEmpleado]) VALUES
-- Reportes de Refrigeradores (TipoReporteId = 1)
(1, 'TKT1737470001', '5218112345001', 'El refrigerador no enfria adecuadamente, temperatura interna de 15C', 'https://stacfixbot.blob.core.windows.net/imagenes/ref001_temp.jpg', 1, @EstadoPendiente, DATEADD(day, -5, GETDATE()), DATEADD(day, -5, GETDATE()), NULL, 1, 1, NULL, NULL),
(2, 'TKT1737470002', '5218112345002', 'Puerta no cierra correctamente, sello danado', 'https://stacfixbot.blob.core.windows.net/imagenes/ref002_puerta.jpg', 1, @EstadoEnProceso, DATEADD(day, -4, GETDATE()), DATEADD(day, -3, GETDATE()), NULL, 2, 1, NULL, NULL),
(3, 'TKT1737470003', '5218112345003', 'Luz interior no funciona', NULL, 1, @EstadoResuelto, DATEADD(day, -10, GETDATE()), DATEADD(day, -8, GETDATE()), DATEADD(day, -8, GETDATE()), 3, 2, NULL, NULL),
(4, 'TKT1737470004', '5218112345004', 'Ruido excesivo del compresor', 'https://stacfixbot.blob.core.windows.net/imagenes/ref004_ruido.jpg', 1, @EstadoPendiente, DATEADD(day, -2, GETDATE()), DATEADD(day, -2, GETDATE()), NULL, 4, 2, NULL, NULL),
(5, 'TKT1737470005', '5218112345005', 'Formacion excesiva de hielo en el evaporador', 'https://stacfixbot.blob.core.windows.net/imagenes/ref005_hielo.jpg', 1, @EstadoPendiente, DATEADD(day, -1, GETDATE()), DATEADD(day, -1, GETDATE()), NULL, 5, 3, NULL, NULL),
-- Reportes de Vehiculos (TipoReporteId = 2)
(6, 'TKT1737470006', '5218198765001', 'Fuga de aceite en el motor', 'https://stacfixbot.blob.core.windows.net/imagenes/veh001_fuga.jpg', 2, @EstadoPendiente, DATEADD(day, -3, GETDATE()), DATEADD(day, -3, GETDATE()), NULL, NULL, NULL, 'VEH-MTY-001', 'EMP001'),
(7, 'TKT1737470007', '5218198765002', 'Llanta ponchada delantera derecha', 'https://stacfixbot.blob.core.windows.net/imagenes/veh002_llanta.jpg', 2, @EstadoEnProceso, DATEADD(day, -2, GETDATE()), DATEADD(day, -1, GETDATE()), NULL, NULL, NULL, 'VEH-MTY-002', 'EMP002'),
(8, 'TKT1737470008', '5218198765003', 'Bateria descargada, no enciende', NULL, 2, @EstadoResuelto, DATEADD(day, -7, GETDATE()), DATEADD(day, -6, GETDATE()), DATEADD(day, -6, GETDATE()), NULL, NULL, 'VEH-MTY-003', 'EMP003'),
(9, 'TKT1737470009', '5218198765004', 'Sistema de refrigeracion con falla, sobrecalentamiento', 'https://stacfixbot.blob.core.windows.net/imagenes/veh004_temp.jpg', 2, @EstadoPendiente, DATEADD(day, -1, GETDATE()), DATEADD(day, -1, GETDATE()), NULL, NULL, NULL, 'VEH-MTY-004', 'EMP004'),
(10, 'TKT1737470010', '5218198765005', 'Frenos hacen ruido al frenar', 'https://stacfixbot.blob.core.windows.net/imagenes/veh005_frenos.jpg', 2, @EstadoPendiente, GETDATE(), GETDATE(), NULL, NULL, NULL, 'VEH-MTY-005', 'EMP005');

SET IDENTITY_INSERT [dbo].[Reportes] OFF;

PRINT '   Reportes: 10 registros (2 resueltos con FechaResolucion para pruebas de encuestas)';
GO

-- =============================================
-- PASO 13: INSERTAR DATOS DE PRUEBA - SESIONES
-- =============================================

PRINT '';
PRINT 'Paso 13: Insertando datos de prueba en SesionesChat...';
GO

DECLARE @EstadoInicioId INT;
SELECT @EstadoInicioId = EstadoId FROM CatEstadoSesion WHERE Codigo = 'INICIO';

SET IDENTITY_INSERT [dbo].[SesionesChat] ON;

INSERT INTO [dbo].[SesionesChat] ([SesionId], [Telefono], [TipoReporteId], [EstadoId], [DatosTemp], [EquipoIdTemp], [FechaCreacion], [UltimaActividad], [ContadorMensajes], [AdvertenciaEnviada]) VALUES
(1, '5218112345001', NULL, @EstadoInicioId, NULL, NULL, DATEADD(day, -5, GETDATE()), DATEADD(day, -5, GETDATE()), 0, 0),
(2, '5218112345002', NULL, @EstadoInicioId, NULL, NULL, DATEADD(day, -4, GETDATE()), DATEADD(day, -3, GETDATE()), 0, 0),
(3, '5218198765001', NULL, @EstadoInicioId, NULL, NULL, DATEADD(day, -3, GETDATE()), DATEADD(day, -3, GETDATE()), 0, 0),
(4, '5218198765002', NULL, @EstadoInicioId, NULL, NULL, DATEADD(day, -2, GETDATE()), DATEADD(day, -1, GETDATE()), 0, 0);

SET IDENTITY_INSERT [dbo].[SesionesChat] OFF;

PRINT '   SesionesChat: 4 registros';
GO

-- =============================================
-- PASO 14: CREAR STORED PROCEDURES
-- =============================================

PRINT '';
PRINT 'Paso 14: Creando Stored Procedures...';
GO

-- SP para detectar spam
CREATE OR ALTER PROCEDURE [dbo].[sp_CheckSpam]
    @Telefono NVARCHAR(20),
    @UmbralMensajesPorHora INT = 30,
    @EsSpam BIT OUTPUT,
    @TotalMensajes INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT @TotalMensajes = COUNT(*)
    FROM MensajesChat
    WHERE Telefono = @Telefono
      AND Tipo = 'U'
      AND FechaCreacion > DATEADD(HOUR, -1, GETDATE());

    SET @EsSpam = CASE WHEN @TotalMensajes >= @UmbralMensajesPorHora THEN 1 ELSE 0 END;
END;
GO

-- SP para historial de telefono
CREATE OR ALTER PROCEDURE [dbo].[sp_GetHistorialTelefono]
    @Telefono NVARCHAR(20),
    @TopN INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@TopN)
        h.HistorialId,
        h.FechaAccion,
        tr.Codigo AS TipoReporte,
        ea.Codigo AS EstadoAnterior,
        en.Codigo AS EstadoNuevo,
        h.OrigenAccion,
        h.Descripcion,
        h.ReporteId
    FROM HistorialSesiones h
    LEFT JOIN CatTipoReporte tr ON h.TipoReporteId = tr.TipoReporteId
    LEFT JOIN CatEstadoSesion ea ON h.EstadoAnteriorId = ea.EstadoId
    INNER JOIN CatEstadoSesion en ON h.EstadoNuevoId = en.EstadoId
    WHERE h.Telefono = @Telefono
    ORDER BY h.FechaAccion DESC;
END;
GO

-- SP para metricas de sesiones
CREATE OR ALTER PROCEDURE [dbo].[sp_GetMetricasSesiones]
    @FechaInicio DATETIME = NULL,
    @FechaFin DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @FechaInicio IS NULL SET @FechaInicio = DATEADD(DAY, -30, GETDATE());
    IF @FechaFin IS NULL SET @FechaFin = GETDATE();

    -- Resumen por estado final
    SELECT
        en.Codigo AS EstadoFinal,
        COUNT(*) AS Total
    FROM HistorialSesiones h
    INNER JOIN CatEstadoSesion en ON h.EstadoNuevoId = en.EstadoId
    WHERE h.FechaAccion BETWEEN @FechaInicio AND @FechaFin
      AND en.EsTerminal = 1
    GROUP BY en.Codigo
    ORDER BY Total DESC;

    -- Resumen por tipo de reporte
    SELECT
        ISNULL(tr.Codigo, 'SIN_TIPO') AS TipoReporte,
        COUNT(*) AS TotalSesiones
    FROM HistorialSesiones h
    LEFT JOIN CatTipoReporte tr ON h.TipoReporteId = tr.TipoReporteId
    WHERE h.FechaAccion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY tr.Codigo
    ORDER BY TotalSesiones DESC;

    -- Sesiones por dia
    SELECT
        CAST(FechaAccion AS DATE) AS Fecha,
        COUNT(DISTINCT Telefono) AS UsuariosUnicos,
        COUNT(*) AS TotalAcciones
    FROM HistorialSesiones
    WHERE FechaAccion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY CAST(FechaAccion AS DATE)
    ORDER BY Fecha;
END;
GO

-- SP para sesiones que necesitan warning
CREATE OR ALTER PROCEDURE [dbo].[sp_GetSesionesNeedingWarning]
    @MinutosInactividad INT = 10
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        s.SesionId,
        s.Telefono,
        tr.Codigo AS TipoReporte,
        es.Codigo AS Estado,
        s.UltimaActividad,
        DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
    FROM SesionesChat s
    INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
    LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
    WHERE es.EsTerminal = 0
      AND s.AdvertenciaEnviada = 0
      AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @MinutosInactividad
      AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) < (@MinutosInactividad + 5);
END;
GO

-- SP para sesiones a cerrar por timeout
CREATE OR ALTER PROCEDURE [dbo].[sp_GetSesionesToClose]
    @MinutosTimeout INT = 15
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        s.SesionId,
        s.Telefono,
        tr.Codigo AS TipoReporte,
        es.Codigo AS Estado,
        s.UltimaActividad,
        DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
    FROM SesionesChat s
    INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
    LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId
    WHERE es.EsTerminal = 0
      AND s.AdvertenciaEnviada = 1
      AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @MinutosTimeout;
END;
GO

-- SP para estadisticas de reportes
CREATE OR ALTER PROCEDURE [dbo].[sp_GetEstadisticasReportes]
    @FechaInicio DATETIME = NULL,
    @FechaFin DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @FechaInicio IS NULL SET @FechaInicio = DATEADD(DAY, -30, GETDATE());
    IF @FechaFin IS NULL SET @FechaFin = GETDATE();

    -- Resumen por estado
    SELECT
        e.Codigo AS Estado,
        e.Nombre AS EstadoNombre,
        e.Emoji,
        COUNT(*) AS Total
    FROM Reportes r
    INNER JOIN CatEstadoReporte e ON r.EstadoReporteId = e.EstadoReporteId
    WHERE r.FechaCreacion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY e.Codigo, e.Nombre, e.Emoji, e.Orden
    ORDER BY e.Orden;

    -- Resumen por tipo de reporte
    SELECT
        tr.Codigo AS TipoReporte,
        tr.Nombre AS TipoReporteNombre,
        COUNT(*) AS Total
    FROM Reportes r
    INNER JOIN CatTipoReporte tr ON r.TipoReporteId = tr.TipoReporteId
    WHERE r.FechaCreacion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY tr.Codigo, tr.Nombre
    ORDER BY Total DESC;

    -- Reportes por dia
    SELECT
        CAST(FechaCreacion AS DATE) AS Fecha,
        COUNT(*) AS TotalReportes
    FROM Reportes
    WHERE FechaCreacion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY CAST(FechaCreacion AS DATE)
    ORDER BY Fecha;
END;
GO

PRINT '   6 Stored Procedures base creados';
GO

-- =============================================
-- PASO 14B: CREAR STORED PROCEDURES DE ENCUESTAS
-- =============================================

PRINT '';
PRINT 'Paso 14B: Creando Stored Procedures de Encuestas...';
GO

-- SP: Obtener reportes pendientes de encuesta
CREATE OR ALTER PROCEDURE [dbo].[sp_GetReportesPendientesEncuesta]
    @MinutosMinimasResolucion INT = 1440,  -- Esperar al menos X minutos desde resolucion (default 24h)
    @CooldownHorasPorTelefono INT = 24     -- No enviar mas de 1 encuesta por telefono en X horas
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        r.ReporteId,
        r.NumeroTicket,
        r.TelefonoReportante,
        r.FechaResolucion,
        r.Descripcion,
        tr.Codigo AS TipoReporte,
        -- Nombre del cliente para refrigeradores
        CASE
            WHEN tr.Codigo = 'REFRIGERADOR' THEN c.Nombre
            ELSE NULL
        END AS NombreCliente,
        -- Datos adicionales del equipo
        e.CodigoSAP,
        e.Modelo
    FROM Reportes r
    INNER JOIN CatEstadoReporte er ON r.EstadoReporteId = er.EstadoReporteId
    INNER JOIN CatTipoReporte tr ON r.TipoReporteId = tr.TipoReporteId
    LEFT JOIN Clientes c ON r.ClienteId = c.ClienteId
    LEFT JOIN Equipos e ON r.EquipoId = e.EquipoId
    WHERE er.Codigo = 'RESUELTO'
      AND r.FechaResolucion IS NOT NULL
      AND DATEDIFF(MINUTE, r.FechaResolucion, GETDATE()) >= @MinutosMinimasResolucion
      -- No tiene encuesta creada para este reporte
      AND NOT EXISTS (
          SELECT 1 FROM Encuestas enc
          WHERE enc.ReporteId = r.ReporteId
      )
      -- Cooldown: no enviar si ya se envio una encuesta a este telefono recientemente
      AND NOT EXISTS (
          SELECT 1 FROM Encuestas enc2
          WHERE enc2.TelefonoEncuestado = r.TelefonoReportante
            AND enc2.FechaEnvio >= DATEADD(HOUR, -@CooldownHorasPorTelefono, GETDATE())
      )
      -- No enviar si el usuario tiene una sesion activa (no terminal)
      AND NOT EXISTS (
          SELECT 1 FROM SesionesChat sc
          INNER JOIN CatEstadoSesion ces ON sc.EstadoId = ces.EstadoSesionId
          WHERE sc.Telefono = r.TelefonoReportante
            AND ces.EsTerminal = 0
      )
    ORDER BY r.FechaResolucion ASC;
END;
GO

PRINT '   sp_GetReportesPendientesEncuesta creado';
GO

-- SP: Obtener estadisticas de encuestas (VERSION NORMALIZADA)
CREATE OR ALTER PROCEDURE [dbo].[sp_GetEstadisticasEncuestas]
    @FechaInicio DATETIME = NULL,
    @FechaFin DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Valores por defecto: ultimos 30 dias
    IF @FechaInicio IS NULL SET @FechaInicio = DATEADD(DAY, -30, GETDATE());
    IF @FechaFin IS NULL SET @FechaFin = GETDATE();

    -- Resumen general por estado (usando catalogo)
    SELECT
        ce.Codigo AS Estado,
        ce.Nombre AS EstadoNombre,
        COUNT(e.EncuestaId) AS Total,
        ce.EsFinal
    FROM [dbo].[CatEstadoEncuesta] ce
    LEFT JOIN [dbo].[Encuestas] e ON ce.EstadoEncuestaId = e.EstadoEncuestaId
        AND e.FechaEnvio BETWEEN @FechaInicio AND @FechaFin
    WHERE ce.Activo = 1
    GROUP BY ce.Codigo, ce.Nombre, ce.EsFinal, ce.Orden
    ORDER BY ce.Orden;

    -- Tasa de completado
    SELECT
        COUNT(*) AS TotalEncuestas,
        SUM(CASE WHEN ce.Codigo = 'COMPLETADA' THEN 1 ELSE 0 END) AS Completadas,
        CAST(
            SUM(CASE WHEN ce.Codigo = 'COMPLETADA' THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(COUNT(*), 0)
        AS DECIMAL(5,2)) AS TasaCompletado
    FROM [dbo].[Encuestas] e
    INNER JOIN [dbo].[CatEstadoEncuesta] ce ON e.EstadoEncuestaId = ce.EstadoEncuestaId
    WHERE e.FechaEnvio BETWEEN @FechaInicio AND @FechaFin;

    -- Promedios por pregunta (usando catalogo de preguntas)
    SELECT
        p.NumeroPregunta,
        p.TextoCorto AS Pregunta,
        p.TextoPregunta AS PreguntaCompleta,
        AVG(CAST(r.Valor AS DECIMAL(5,2))) AS Promedio,
        COUNT(r.RespuestaId) AS TotalRespuestas
    FROM [dbo].[PreguntasEncuesta] p
    LEFT JOIN [dbo].[RespuestasEncuesta] r ON p.PreguntaId = r.PreguntaId
    LEFT JOIN [dbo].[Encuestas] e ON r.EncuestaId = e.EncuestaId
        AND e.FechaEnvio BETWEEN @FechaInicio AND @FechaFin
    INNER JOIN [dbo].[CatEstadoEncuesta] ce ON e.EstadoEncuestaId = ce.EstadoEncuestaId
        AND ce.Codigo = 'COMPLETADA'
    WHERE p.Activo = 1
    GROUP BY p.NumeroPregunta, p.TextoCorto, p.TextoPregunta, p.Orden
    ORDER BY p.Orden;

    -- Promedio general de satisfaccion
    SELECT
        CAST(AVG(CAST(r.Valor AS DECIMAL(5,2))) AS DECIMAL(5,2)) AS PromedioGeneral
    FROM [dbo].[RespuestasEncuesta] r
    INNER JOIN [dbo].[Encuestas] e ON r.EncuestaId = e.EncuestaId
    INNER JOIN [dbo].[CatEstadoEncuesta] ce ON e.EstadoEncuestaId = ce.EstadoEncuestaId
    WHERE ce.Codigo = 'COMPLETADA'
      AND e.FechaEnvio BETWEEN @FechaInicio AND @FechaFin;
END;
GO

PRINT '   sp_GetEstadisticasEncuestas creado (normalizado)';
GO

-- SP: Expirar encuestas sin respuesta (VERSION NORMALIZADA)
CREATE OR ALTER PROCEDURE [dbo].[sp_ExpirarEncuestasSinRespuesta]
    @HorasExpiracion INT = 72  -- Expirar despues de 72 horas sin respuesta
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @EstadoEnviadaId INT, @EstadoExpiradaId INT;
    SELECT @EstadoEnviadaId = EstadoEncuestaId FROM [dbo].[CatEstadoEncuesta] WHERE Codigo = 'ENVIADA';
    SELECT @EstadoExpiradaId = EstadoEncuestaId FROM [dbo].[CatEstadoEncuesta] WHERE Codigo = 'EXPIRADA';

    UPDATE [dbo].[Encuestas]
    SET EstadoEncuestaId = @EstadoExpiradaId,
        Estado = 'EXPIRADA',  -- Mantener retrocompatibilidad temporal
        FechaActualizacion = GETDATE()
    WHERE EstadoEncuestaId = @EstadoEnviadaId
      AND DATEDIFF(HOUR, FechaEnvio, GETDATE()) >= @HorasExpiracion;

    SELECT @@ROWCOUNT AS EncuestasExpiradas;
END;
GO

PRINT '   sp_ExpirarEncuestasSinRespuesta creado (normalizado)';
GO

-- =============================================
-- PASO 14C: CREAR STORED PROCEDURES DE DEAD LETTER
-- =============================================

PRINT '';
PRINT 'Paso 14C: Creando Stored Procedures de Dead Letter...';
GO

-- SP: Obtener mensajes para reintentar
CREATE OR ALTER PROCEDURE [dbo].[sp_GetDeadLettersForRetry]
    @MaxMessages INT = 10
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@MaxMessages)
        DeadLetterId,
        WhatsAppMessageId,
        Telefono,
        TipoMensaje,
        Contenido,
        CorrelationId,
        RetryCount,
        MaxRetries
    FROM DeadLetterMessages
    WHERE Estado IN ('PENDING', 'RETRYING')
      AND (NextRetryAt IS NULL OR NextRetryAt <= GETDATE())
      AND RetryCount < MaxRetries
    ORDER BY FechaCreacion ASC;
END;
GO

PRINT '   sp_GetDeadLettersForRetry creado';
GO

-- SP: Limpiar mensajes antiguos procesados
CREATE OR ALTER PROCEDURE [dbo].[sp_CleanOldDeadLetters]
    @DaysToKeep INT = 7
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @DeletedCount INT;

    DELETE FROM DeadLetterMessages
    WHERE FechaCreacion < DATEADD(DAY, -@DaysToKeep, GETDATE())
      AND Estado IN ('PROCESSED', 'FAILED', 'SKIPPED');

    SET @DeletedCount = @@ROWCOUNT;

    SELECT @DeletedCount AS DeletedCount;
END;
GO

PRINT '   sp_CleanOldDeadLetters creado';
GO

-- =============================================
-- PASO 14D: CREAR STORED PROCEDURES DE CENTROS DE SERVICIO
-- =============================================

PRINT '';
PRINT 'Paso 14D: Creando Stored Procedures de Centros de Servicio...';
GO

-- SP: Buscar centro de servicio mas cercano
CREATE OR ALTER PROCEDURE [dbo].[sp_GetCentroServicioMasCercano]
    @Latitud DECIMAL(10, 8),
    @Longitud DECIMAL(11, 8)
AS
BEGIN
    SET NOCOUNT ON;

    -- Formula Haversine simplificada para calcular distancia aproximada
    -- Devuelve el centro activo mas cercano con distancia en km
    SELECT TOP 1
        cs.CentroServicioId,
        cs.Codigo,
        cs.Nombre,
        cs.Direccion,
        cs.Ciudad,
        cs.Estado,
        cs.Latitud,
        cs.Longitud,
        cs.Telefono,
        -- Distancia aproximada usando Haversine (en km)
        6371 * ACOS(
            COS(RADIANS(@Latitud)) * COS(RADIANS(cs.Latitud)) *
            COS(RADIANS(cs.Longitud) - RADIANS(@Longitud)) +
            SIN(RADIANS(@Latitud)) * SIN(RADIANS(cs.Latitud))
        ) AS DistanciaKm
    FROM [dbo].[CentrosServicio] cs
    WHERE cs.Activo = 1
    ORDER BY
        -- Ordenar por distancia (menor primero)
        6371 * ACOS(
            COS(RADIANS(@Latitud)) * COS(RADIANS(cs.Latitud)) *
            COS(RADIANS(cs.Longitud) - RADIANS(@Longitud)) +
            SIN(RADIANS(@Latitud)) * SIN(RADIANS(cs.Latitud))
        );
END;
GO

PRINT '   sp_GetCentroServicioMasCercano creado';
GO

-- SP: Listar todos los centros activos
CREATE OR ALTER PROCEDURE [dbo].[sp_GetCentrosServicioActivos]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CentroServicioId,
        Codigo,
        Nombre,
        Direccion,
        Ciudad,
        Estado,
        CodigoPostal,
        Latitud,
        Longitud,
        Telefono,
        Email,
        HorarioApertura,
        HorarioCierre,
        DiasOperacion
    FROM [dbo].[CentrosServicio]
    WHERE Activo = 1
    ORDER BY Nombre;
END;
GO

PRINT '   sp_GetCentrosServicioActivos creado';
GO

-- =============================================
-- PASO 15: CREAR VISTAS
-- =============================================

PRINT '';
PRINT 'Paso 15: Creando vistas...';
GO

-- Vista de sesiones activas
CREATE OR ALTER VIEW [dbo].[vw_SesionesActivas]
AS
SELECT
    s.SesionId,
    s.Telefono,
    tr.Codigo AS TipoReporte,
    tr.Nombre AS TipoReporteNombre,
    es.Codigo AS Estado,
    es.Nombre AS EstadoNombre,
    es.EsTerminal,
    s.DatosTemp,
    s.EquipoIdTemp,
    s.ContadorMensajes,
    s.AdvertenciaEnviada,
    s.FechaAdvertencia,
    s.FechaCreacion,
    s.UltimaActividad,
    DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
FROM SesionesChat s
INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
LEFT JOIN CatTipoReporte tr ON s.TipoReporteId = tr.TipoReporteId;
GO

-- Vista de reportes
CREATE OR ALTER VIEW [dbo].[vw_Reportes]
AS
SELECT
    r.ReporteId,
    r.NumeroTicket,
    r.TelefonoReportante,
    r.Descripcion,
    r.ImagenUrl,
    tr.Codigo AS TipoReporte,
    tr.Nombre AS TipoReporteNombre,
    e.Codigo AS Estado,
    e.Nombre AS EstadoNombre,
    e.Emoji AS EstadoEmoji,
    e.EsFinal AS EstadoEsFinal,
    r.EquipoId,
    eq.CodigoSAP,
    eq.Modelo,
    r.ClienteId,
    c.Nombre AS NombreCliente,
    r.CodigoSAPVehiculo,
    r.NumeroEmpleado,
    r.FechaCreacion,
    r.FechaActualizacion,
    r.FechaResolucion
FROM Reportes r
INNER JOIN CatTipoReporte tr ON r.TipoReporteId = tr.TipoReporteId
INNER JOIN CatEstadoReporte e ON r.EstadoReporteId = e.EstadoReporteId
LEFT JOIN Equipos eq ON r.EquipoId = eq.EquipoId
LEFT JOIN Clientes c ON r.ClienteId = c.ClienteId;
GO

-- Vista de encuestas (VERSION NORMALIZADA)
CREATE OR ALTER VIEW [dbo].[vw_Encuestas]
AS
SELECT
    e.EncuestaId,
    e.ReporteId,
    r.NumeroTicket,
    e.TelefonoEncuestado,
    -- Estado normalizado
    ce.Codigo AS Estado,
    ce.Nombre AS EstadoNombre,
    ce.EsFinal AS EstadoEsFinal,
    -- Tipo de encuesta
    te.Codigo AS TipoEncuesta,
    te.Nombre AS TipoEncuestaNombre,
    te.NumeroPreguntas,
    -- Fechas
    e.FechaEnvio,
    e.FechaInicio,
    e.FechaFinalizacion,
    -- Progreso
    e.PreguntaActual,
    (SELECT COUNT(*) FROM RespuestasEncuesta re WHERE re.EncuestaId = e.EncuestaId) AS PreguntasRespondidas,
    -- Promedio de respuestas (de tabla normalizada)
    (SELECT AVG(CAST(re.Valor AS DECIMAL(5,2))) FROM RespuestasEncuesta re WHERE re.EncuestaId = e.EncuestaId) AS PromedioRespuestas,
    -- Comentario
    e.TieneComentario,
    e.Comentario,
    -- Datos del reporte
    tr.Codigo AS TipoReporte,
    r.Descripcion AS DescripcionReporte,
    r.FechaCreacion AS FechaReporte,
    r.FechaResolucion,
    -- Tiempo de respuesta (en horas)
    CASE
        WHEN e.FechaFinalizacion IS NOT NULL
        THEN DATEDIFF(HOUR, e.FechaEnvio, e.FechaFinalizacion)
        ELSE NULL
    END AS HorasRespuesta
FROM [dbo].[Encuestas] e
INNER JOIN [dbo].[CatEstadoEncuesta] ce ON e.EstadoEncuestaId = ce.EstadoEncuestaId
INNER JOIN [dbo].[CatTipoEncuesta] te ON e.TipoEncuestaId = te.TipoEncuestaId
INNER JOIN [dbo].[Reportes] r ON e.ReporteId = r.ReporteId
INNER JOIN [dbo].[CatTipoReporte] tr ON r.TipoReporteId = tr.TipoReporteId;
GO

-- Vista de respuestas de encuesta (NUEVA - NORMALIZADA)
CREATE OR ALTER VIEW [dbo].[vw_RespuestasEncuesta]
AS
SELECT
    r.RespuestaId,
    r.EncuestaId,
    e.TelefonoEncuestado,
    rep.NumeroTicket,
    -- Pregunta
    p.NumeroPregunta,
    p.TextoCorto AS Pregunta,
    p.TextoPregunta AS PreguntaCompleta,
    -- Respuesta
    r.Valor,
    r.FechaRespuesta,
    -- Contexto
    te.Codigo AS TipoEncuesta,
    ce.Codigo AS EstadoEncuesta
FROM [dbo].[RespuestasEncuesta] r
INNER JOIN [dbo].[PreguntasEncuesta] p ON r.PreguntaId = p.PreguntaId
INNER JOIN [dbo].[Encuestas] e ON r.EncuestaId = e.EncuestaId
INNER JOIN [dbo].[CatTipoEncuesta] te ON e.TipoEncuestaId = te.TipoEncuestaId
INNER JOIN [dbo].[CatEstadoEncuesta] ce ON e.EstadoEncuestaId = ce.EstadoEncuestaId
INNER JOIN [dbo].[Reportes] rep ON e.ReporteId = rep.ReporteId;
GO

PRINT '   4 Vistas creadas (vw_Encuestas y vw_RespuestasEncuesta normalizadas)';
GO

-- =============================================
-- PASO 16: INDICES DE OPTIMIZACION
-- =============================================

PRINT '';
PRINT 'Paso 16: Creando indices de optimizacion...';
GO

-- Indice para spam check (query optimizada con CASE)
CREATE NONCLUSTERED INDEX [IX_MensajesChat_Spam_Check]
ON [dbo].[MensajesChat] ([Telefono], [Tipo], [FechaCreacion] DESC)
INCLUDE ([MensajeId]);

PRINT '   IX_MensajesChat_Spam_Check creado';
GO

-- Indice para getSession y queries de estado (covering index)
-- Incluye Version para evitar key lookup en optimistic locking
CREATE NONCLUSTERED INDEX [IX_SesionesChat_Telefono_Estado_Full]
ON [dbo].[SesionesChat] ([Telefono], [EstadoId])
INCLUDE ([SesionId], [UltimaActividad], [DatosTemp], [TipoReporteId], [AdvertenciaEnviada], [Version], [EquipoIdTemp]);

PRINT '   IX_SesionesChat_Telefono_Estado_Full creado';
GO

-- Indice para busqueda de equipos por CodigoSAP (covering index)
CREATE NONCLUSTERED INDEX [IX_Equipos_CodigoSAP_Activo_Full]
ON [dbo].[Equipos] ([CodigoSAP], [Activo])
INCLUDE ([EquipoId], [Modelo], [Marca], [Descripcion], [ClienteId]);

PRINT '   IX_Equipos_CodigoSAP_Activo_Full creado';
GO

-- Indice para getEncuestaByTelefono (covering index)
CREATE NONCLUSTERED INDEX [IX_Encuestas_Telefono_Estado_Full]
ON [dbo].[Encuestas] ([TelefonoEncuestado], [EstadoEncuestaId])
INCLUDE ([EncuestaId], [ReporteId], [PreguntaActual], [TipoEncuestaId], [FechaEnvio]);

PRINT '   IX_Encuestas_Telefono_Estado_Full creado';
GO

-- Indice para historial de sesiones (auditoria)
-- Incluye ReporteId para rastrear reportes creados
CREATE NONCLUSTERED INDEX [IX_HistorialSesiones_Telefono_Fecha_Full]
ON [dbo].[HistorialSesiones] ([Telefono], [FechaAccion] DESC)
INCLUDE ([EstadoAnteriorId], [EstadoNuevoId], [OrigenAccion], [Descripcion], [ReporteId]);

PRINT '   IX_HistorialSesiones_Telefono_Fecha_Full creado';
GO

-- Indice para reportes pendientes de encuesta (filtered index)
SET QUOTED_IDENTIFIER ON;
CREATE NONCLUSTERED INDEX [IX_Reportes_Encuestas_Pendientes]
ON [dbo].[Reportes] ([EstadoReporteId], [FechaResolucion])
INCLUDE ([ReporteId], [NumeroTicket], [TelefonoReportante], [TipoReporteId], [ClienteId])
WHERE [FechaResolucion] IS NOT NULL;

PRINT '   IX_Reportes_Encuestas_Pendientes creado';
PRINT '   6 indices de optimizacion creados (IX_SesionesChat_Telefono redundante eliminado)';
GO

-- =============================================
-- VERIFICACION FINAL
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  INSTALACION COMPLETADA';
PRINT '===============================================================';
PRINT '';
GO

-- Resumen de tablas
SELECT 'CatTipoReporte' AS Tabla, COUNT(*) AS Registros FROM [dbo].[CatTipoReporte]
UNION ALL SELECT 'CatEstadoSesion', COUNT(*) FROM [dbo].[CatEstadoSesion]
UNION ALL SELECT 'CatEstadoReporte', COUNT(*) FROM [dbo].[CatEstadoReporte]
UNION ALL SELECT 'CatEstadoEncuesta', COUNT(*) FROM [dbo].[CatEstadoEncuesta]
UNION ALL SELECT 'CatTipoEncuesta', COUNT(*) FROM [dbo].[CatTipoEncuesta]
UNION ALL SELECT 'PreguntasEncuesta', COUNT(*) FROM [dbo].[PreguntasEncuesta]
UNION ALL SELECT 'Clientes', COUNT(*) FROM [dbo].[Clientes]
UNION ALL SELECT 'Equipos', COUNT(*) FROM [dbo].[Equipos]
UNION ALL SELECT 'Reportes', COUNT(*) FROM [dbo].[Reportes]
UNION ALL SELECT 'SesionesChat', COUNT(*) FROM [dbo].[SesionesChat]
UNION ALL SELECT 'HistorialSesiones', COUNT(*) FROM [dbo].[HistorialSesiones]
UNION ALL SELECT 'MensajesChat', COUNT(*) FROM [dbo].[MensajesChat]
UNION ALL SELECT 'MensajesProcessados', COUNT(*) FROM [dbo].[MensajesProcessados]
UNION ALL SELECT 'DeadLetterMessages', COUNT(*) FROM [dbo].[DeadLetterMessages]
UNION ALL SELECT 'Encuestas', COUNT(*) FROM [dbo].[Encuestas]
UNION ALL SELECT 'RespuestasEncuesta', COUNT(*) FROM [dbo].[RespuestasEncuesta]
UNION ALL SELECT 'CentrosServicio', COUNT(*) FROM [dbo].[CentrosServicio];
GO

PRINT '';
PRINT 'Catalogos Base:';
PRINT '   - CatTipoReporte: REFRIGERADOR, VEHICULO, CONSULTA';
PRINT '   - CatEstadoSesion: 21 estados (12 base + 9 encuesta, incluye VEHICULO_ESPERA_UBICACION)';
PRINT '   - CatEstadoReporte: PENDIENTE, EN_PROCESO, RESUELTO, CANCELADO';
PRINT '';
PRINT 'Catalogos de Encuestas (NORMALIZADOS):';
PRINT '   - CatEstadoEncuesta: 5 estados (ENVIADA, EN_PROCESO, COMPLETADA, RECHAZADA, EXPIRADA)';
PRINT '   - CatTipoEncuesta: 1 tipo (SATISFACCION_SERVICIO)';
PRINT '   - PreguntasEncuesta: 6 preguntas dinamicas';
PRINT '';
PRINT 'Tablas de datos:';
PRINT '   - Clientes: 8 registros de prueba';
PRINT '   - Equipos: 16 refrigeradores de prueba';
PRINT '   - CentrosServicio: 4 centros de prueba (MTY, CDMX, GDL, QRO)';
PRINT '   - Reportes: 10 reportes de prueba (2 con FechaResolucion)';
PRINT '   - SesionesChat: 4 sesiones de prueba';
PRINT '   - HistorialSesiones: vacia';
PRINT '   - MensajesChat: vacia';
PRINT '   - MensajesProcessados: vacia (deduplicacion)';
PRINT '   - DeadLetterMessages: vacia (mensajes fallidos para reintento)';
PRINT '   - Encuestas: vacia (normalizada con TipoEncuestaId y EstadoEncuestaId)';
PRINT '   - RespuestasEncuesta: vacia (respuestas normalizadas)';
PRINT '';
PRINT 'Stored Procedures:';
PRINT '   Base:';
PRINT '   - sp_CheckSpam';
PRINT '   - sp_GetHistorialTelefono';
PRINT '   - sp_GetMetricasSesiones';
PRINT '   - sp_GetSesionesNeedingWarning';
PRINT '   - sp_GetSesionesToClose';
PRINT '   - sp_GetEstadisticasReportes';
PRINT '   Encuestas (normalizados):';
PRINT '   - sp_GetReportesPendientesEncuesta';
PRINT '   - sp_GetEstadisticasEncuestas (usa catalogos)';
PRINT '   - sp_ExpirarEncuestasSinRespuesta (usa catalogos)';
PRINT '   Dead Letter:';
PRINT '   - sp_GetDeadLettersForRetry (obtener mensajes para reintento)';
PRINT '   - sp_CleanOldDeadLetters (limpieza de mensajes antiguos)';
PRINT '   Centros de Servicio:';
PRINT '   - sp_GetCentroServicioMasCercano (buscar centro mas cercano por coordenadas)';
PRINT '   - sp_GetCentrosServicioActivos (listar todos los centros activos)';
PRINT '';
PRINT 'Vistas:';
PRINT '   - vw_SesionesActivas';
PRINT '   - vw_Reportes';
PRINT '   - vw_Encuestas (normalizada)';
PRINT '   - vw_RespuestasEncuesta (nueva)';
PRINT '';
PRINT 'Indices de Optimizacion:';
PRINT '   - IX_MensajesChat_Spam_Check (spam detection)';
PRINT '   - IX_SesionesChat_Telefono_Estado_Full (covering)';
PRINT '   - IX_Equipos_CodigoSAP_Activo_Full (covering)';
PRINT '   - IX_Encuestas_Telefono_Estado_Full (covering)';
PRINT '   - IX_HistorialSesiones_Telefono_Fecha_Full (auditoria)';
PRINT '   - IX_Reportes_Encuestas_Pendientes (filtered)';
PRINT '';
PRINT 'Codigos SAP de prueba:';
PRINT '   - Refrigeradores: REF001 a REF015, 4045101';
PRINT '   - Vehiculos: VEH-MTY-001 a VEH-MTY-005';
PRINT '   - Empleados: EMP001 a EMP005';
PRINT '';
PRINT 'Centros de Servicio de prueba:';
PRINT '   - CS-MTY: Monterrey, NL (25.6514, -100.2895)';
PRINT '   - CS-CDMX: Ciudad de Mexico (19.3910, -99.1737)';
PRINT '   - CS-GDL: Guadalajara, JAL (20.6767, -103.3825)';
PRINT '   - CS-QRO: Queretaro, QRO (20.5888, -100.3899)';
PRINT '';
PRINT 'NOTAS v5.0 - ENCUESTAS NORMALIZADAS:';
PRINT '   - Encuestas ahora usa TipoEncuestaId (FK) en lugar de preguntas hardcoded';
PRINT '   - Encuestas ahora usa EstadoEncuestaId (FK) en lugar de CHECK constraint';
PRINT '   - Columnas Pregunta1-6 se mantienen para retrocompatibilidad';
PRINT '   - Respuestas se guardan en RespuestasEncuesta (normalizada)';
PRINT '   - Para agregar nuevos tipos de encuesta, insertar en CatTipoEncuesta y PreguntasEncuesta';
PRINT '';
PRINT 'NOTAS v5.4 - CENTROS DE SERVICIO:';
PRINT '   - CentrosServicio contiene ubicaciones geograficas de centros de atencion';
PRINT '   - Reportes tiene nuevos campos: CentroServicioId, TiempoEstimadoMinutos, DistanciaCentroKm';
PRINT '   - sp_GetCentroServicioMasCercano usa formula Haversine para calcular distancias';
PRINT '   - Para agregar nuevos centros, insertar en CentrosServicio con coordenadas';
PRINT '';
PRINT '===============================================================';
GO
