# AC FixBot - Diagrama ER de Base de Datos

## Descripcion General

La base de datos `db-acfixbot` soporta el sistema de reportes de fallas via WhatsApp.
Incluye gestion de sesiones, reportes de equipos/vehiculos, encuestas de satisfaccion y
sistema de Dead Letter Queue para mensajes fallidos.

## Diagrama Entidad-Relacion

```mermaid
erDiagram
    %% ==========================================
    %% CATALOGOS (Tablas de Referencia)
    %% ==========================================

    CatTipoReporte {
        int TipoReporteId PK
        nvarchar Codigo UK
        nvarchar Nombre
        nvarchar Descripcion
        bit GeneraTicket
        bit Activo
    }

    CatEstadoSesion {
        int EstadoId PK
        nvarchar Codigo UK
        nvarchar Nombre
        bit EsTerminal
        int Orden
        bit Activo
    }

    CatEstadoReporte {
        int EstadoReporteId PK
        nvarchar Codigo UK
        nvarchar Nombre
        nvarchar Emoji
        bit EsFinal
        bit Activo
    }

    CatEstadoEncuesta {
        int EstadoEncuestaId PK
        nvarchar Codigo UK
        nvarchar Nombre
        bit EsFinal
        bit Activo
    }

    CatTipoEncuesta {
        int TipoEncuestaId PK
        nvarchar Codigo UK
        nvarchar Nombre
        int NumeroPreguntas
        bit TienePasoComentario
        nvarchar MensajeInvitacion
        nvarchar MensajeAgradecimiento
    }

    %% ==========================================
    %% ENTIDADES PRINCIPALES
    %% ==========================================

    Clientes {
        int ClienteId PK
        nvarchar Nombre
        nvarchar Direccion
        nvarchar Ciudad
        nvarchar Telefono
        nvarchar Email
        bit Activo
    }

    Equipos {
        int EquipoId PK
        nvarchar CodigoSAP UK
        nvarchar CodigoBarras
        nvarchar NumeroSerie
        nvarchar Modelo
        nvarchar Marca
        nvarchar Ubicacion
        int ClienteId FK
        datetime FechaInstalacion
        bit Activo
    }

    Reportes {
        int ReporteId PK
        nvarchar NumeroTicket UK
        nvarchar TelefonoReportante
        nvarchar Descripcion
        nvarchar ImagenUrl
        int TipoReporteId FK
        int EstadoReporteId FK
        int EquipoId FK
        int ClienteId FK
        nvarchar CodigoSAPVehiculo
        nvarchar NumeroEmpleado
        decimal Latitud
        decimal Longitud
        nvarchar DireccionUbicacion
        datetime FechaCreacion
        datetime FechaResolucion
    }

    SesionesChat {
        int SesionId PK
        nvarchar Telefono UK
        int TipoReporteId FK
        int EstadoId FK
        nvarchar DatosTemp
        int EquipoIdTemp
        datetime UltimaActividad
        int ContadorMensajes
        bit AdvertenciaEnviada
    }

    HistorialSesiones {
        bigint HistorialId PK
        nvarchar Telefono
        nvarchar EstadoAnterior
        nvarchar EstadoNuevo
        nvarchar OrigenAccion
        nvarchar Descripcion
        datetime FechaCambio
    }

    MensajesChat {
        bigint MensajeId PK
        nvarchar Telefono
        nvarchar TipoMensaje
        nvarchar Contenido
        nvarchar TipoContenido
        datetime FechaMensaje
    }

    %% ==========================================
    %% ENCUESTAS DE SATISFACCION (Normalizado)
    %% ==========================================

    PreguntasEncuesta {
        int PreguntaId PK
        int TipoEncuestaId FK
        int NumeroPregunta
        nvarchar TextoPregunta
        nvarchar TextoCorto
        int ValorMinimo
        int ValorMaximo
        nvarchar EtiquetaMinimo
        nvarchar EtiquetaMaximo
        int Orden
    }

    Encuestas {
        int EncuestaId PK
        nvarchar Telefono
        int ReporteId FK
        int TipoEncuestaId FK
        int EstadoEncuestaId FK
        int PreguntaActual
        nvarchar Comentario
        datetime FechaCreacion
        datetime FechaCompletado
    }

    RespuestasEncuesta {
        int RespuestaId PK
        int EncuestaId FK
        int PreguntaId FK
        int Valor
        datetime FechaRespuesta
    }

    %% ==========================================
    %% INFRAESTRUCTURA
    %% ==========================================

    MensajesProcessados {
        int Id PK
        nvarchar WhatsAppMessageId UK
        datetime FechaCreacion
    }

    DeadLetterMessages {
        int DeadLetterId PK
        nvarchar WhatsAppMessageId UK
        nvarchar Telefono
        nvarchar TipoMensaje
        nvarchar Contenido
        nvarchar CorrelationId
        nvarchar ErrorMessage
        nvarchar ErrorStack
        nvarchar ErrorCode
        int RetryCount
        int MaxRetries
        datetime NextRetryAt
        nvarchar Estado
        datetime FechaCreacion
    }

    %% ==========================================
    %% RELACIONES
    %% ==========================================

    %% Clientes y Equipos
    Clientes ||--o{ Equipos : "tiene"

    %% Reportes
    CatTipoReporte ||--o{ Reportes : "clasifica"
    CatEstadoReporte ||--o{ Reportes : "estado"
    Equipos ||--o{ Reportes : "asociado"
    Clientes ||--o{ Reportes : "reporta"

    %% Sesiones
    CatTipoReporte ||--o{ SesionesChat : "tipo"
    CatEstadoSesion ||--o{ SesionesChat : "estado"

    %% Encuestas (Normalizado)
    CatTipoEncuesta ||--o{ PreguntasEncuesta : "define"
    CatTipoEncuesta ||--o{ Encuestas : "tipo"
    CatEstadoEncuesta ||--o{ Encuestas : "estado"
    Reportes ||--o{ Encuestas : "genera"
    Encuestas ||--o{ RespuestasEncuesta : "tiene"
    PreguntasEncuesta ||--o{ RespuestasEncuesta : "responde"
```

## Tablas por Categoria

### Catalogos (Lookup Tables)

| Tabla | Descripcion | Registros Tipicos |
|-------|-------------|-------------------|
| CatTipoReporte | Tipos: REFRIGERADOR, VEHICULO, CONSULTA | 3 |
| CatEstadoSesion | 21 estados del flujo conversacional | 21 |
| CatEstadoReporte | Estados: PENDIENTE, EN_PROCESO, RESUELTO, CANCELADO | 4 |
| CatEstadoEncuesta | Estados: PENDIENTE, EN_PROCESO, COMPLETADA, EXPIRADA | 4 |
| CatTipoEncuesta | Tipos de encuesta configurables | 1 |
| PreguntasEncuesta | Preguntas por tipo de encuesta | 6 |

### Entidades de Negocio

| Tabla | Descripcion | Crecimiento |
|-------|-------------|-------------|
| Clientes | Clientes con equipos instalados | Bajo |
| Equipos | Refrigeradores con codigo SAP | Bajo |
| Reportes | Tickets de falla (100/dia estimado) | Alto |
| SesionesChat | Una por telefono activo | Medio |
| HistorialSesiones | Cambios de estado por sesion | Alto |
| MensajesChat | Mensajes del chat (10/reporte) | Muy Alto |

### Encuestas de Satisfaccion

| Tabla | Descripcion | Crecimiento |
|-------|-------------|-------------|
| Encuestas | Una por reporte resuelto | Alto |
| RespuestasEncuesta | 6 respuestas por encuesta | Alto |

### Infraestructura

| Tabla | Descripcion | Limpieza |
|-------|-------------|----------|
| MensajesProcessados | Deduplicacion de webhooks | 24 horas |
| DeadLetterMessages | Mensajes fallidos para reintento | 7 dias |

## Indices de Optimizacion

### Indices Principales

```sql
-- Busqueda rapida de equipos
IX_Equipos_CodigoSAP

-- Sesiones por estado y actividad
IX_SesionesChat_UltimaActividad_Estado

-- Reportes por ticket y fecha
IX_Reportes_NumeroTicket
IX_Reportes_FechaCreacion

-- Encuestas pendientes
IX_Reportes_FechaResolucion (filtered)
```

### Indices para Dead Letter Queue

```sql
-- Mensajes pendientes de reintento
IX_DeadLetter_PendingRetry (filtered: Estado IN PENDING, RETRYING)

-- Analisis por telefono
IX_DeadLetter_Telefono

-- Limpieza de mensajes antiguos
IX_DeadLetter_Cleanup (filtered: Estado IN PROCESSED, FAILED)
```

## Estados del Flujo Conversacional

```
INICIO
  ├── SELECCION_TIPO
  │     ├── ESPERANDO_CODIGO (Refrigerador)
  │     │     ├── CONFIRMACION_EQUIPO
  │     │     │     └── DESCRIPCION_FALLA
  │     │     │           └── CONFIRMACION_REPORTE
  │     │     │                 └── FINALIZADO
  │     │     └── EQUIPO_NO_ENCONTRADO
  │     │
  │     ├── VEHICULO_* (Flujo vehiculos)
  │     │     ├── VEHICULO_ESPERA_CODIGO
  │     │     ├── VEHICULO_ESPERA_EMPLEADO
  │     │     ├── VEHICULO_ESPERA_UBICACION
  │     │     ├── VEHICULO_DESCRIPCION
  │     │     └── VEHICULO_CONFIRMACION
  │     │
  │     └── ENCUESTA_* (Flujo encuestas)
  │           ├── ENCUESTA_PREGUNTA_1..6
  │           ├── ENCUESTA_COMENTARIO
  │           └── ENCUESTA_COMPLETADA
  │
  ├── TIMEOUT (Terminal)
  └── CANCELADO (Terminal)
```

## Stored Procedures

| Procedimiento | Descripcion |
|---------------|-------------|
| sp_CheckSpam | Detecta spam por telefono |
| sp_GetHistorialTelefono | Historial de un usuario |
| sp_GetMetricasSesiones | Metricas para dashboard |
| sp_GetSesionesNeedingWarning | Sesiones a advertir |
| sp_GetSesionesToClose | Sesiones a cerrar por timeout |
| sp_GetEstadisticasReportes | Stats de reportes |
| sp_GetReportesPendientesEncuesta | Reportes sin encuesta |
| sp_GetEstadisticasEncuestas | Stats de encuestas |
| sp_ExpirarEncuestasSinRespuesta | Expirar encuestas viejas |
| sp_GetDeadLettersForRetry | Mensajes para reintentar |
| sp_CleanOldDeadLetters | Limpieza de dead letters |

## Vistas

| Vista | Descripcion |
|-------|-------------|
| vw_SesionesActivas | Sesiones no terminales |
| vw_Reportes | Reportes con datos relacionados |
| vw_Encuestas | Encuestas con tipo y estado |
| vw_RespuestasEncuesta | Respuestas con texto de pregunta |
