/**
 * AC FIXBOT - Shared Type Definitions
 * Tipos compartidos para la migracion incremental a TypeScript.
 * Nuevos archivos .ts pueden importar estos tipos directamente.
 */

// ==============================================================
// Azure Functions
// ==============================================================

export interface AzureFunctionContext {
  log: AzureLogger;
  bindings: Record<string, unknown>;
  res?: HttpResponse;
  correlationId?: string;
}

export interface AzureLogger {
  (...args: unknown[]): void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  verbose: (...args: unknown[]) => void;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  rawBody?: string;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

// ==============================================================
// WhatsApp / Meta Graph API v22.0
// ==============================================================

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type:
    | 'text'
    | 'image'
    | 'interactive'
    | 'location'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | 'contacts'
    | 'reaction';
  text?: { body: string };
  image?: {
    id: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title?: string };
    list_reply?: { id: string; title?: string };
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  audio?: { id: string; mime_type?: string };
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: WhatsAppContact[];
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
      field: 'messages';
    }>;
  }>;
}

// ==============================================================
// Dominio
// ==============================================================

export interface Session {
  SesionId: number;
  Telefono: string;
  Estado: string;
  TipoReporteId?: number;
  EquipoIdTemp?: number;
  DatosTemp?: string;
  ContadorMensajes: number;
  UltimaActividad: Date;
  FechaCreacion: Date;
  Version: number;
}

export type TipoReporte = 'REFRIGERADOR' | 'VEHICULO';

export interface Reporte {
  ReporteId: number;
  TicketId: string;
  Telefono: string;
  TipoReporteId: number;
  CodigoSAP?: string;
  Descripcion: string;
  Estado: string;
  ImagenUrl?: string;
  Latitud?: number;
  Longitud?: number;
  FechaCreacion: Date;
}

export interface Equipo {
  EquipoId: number;
  CodigoSAP: string;
  Tipo: string;
  Marca?: string;
  Modelo?: string;
  ClienteId?: number;
}

export interface CentroServicio {
  CentroServicioId: number;
  Nombre: string;
  Latitud: number;
  Longitud: number;
  Activo: boolean;
}

// ==============================================================
// Flow Engine
// ==============================================================

export interface FlowDefinition {
  nombre: string;
  estados: string[];
  botones?: Record<string, string | { handler: string; params?: Record<string, unknown> }>;
  procesar: (
    ctx: unknown,
    mensaje: string,
    session: Session,
    azureContext: AzureFunctionContext
  ) => Promise<void>;
}

export interface CampoRequerido {
  valor: unknown;
  completo: boolean;
  fuente?: string;
  confianza?: number;
  timestamp?: number;
}

export interface DatosTemp {
  tipoReporte?: TipoReporte;
  equipoIdTemp?: number;
  datosEquipo?: Record<string, unknown>;
  camposRequeridos?: Record<string, CampoRequerido>;
  centroServicio?: {
    centroServicioId: number;
    nombre: string;
    distanciaDirectaKm: number;
  };
  tiempoLlegada?: {
    tiempoEstimadoMin: number;
    distanciaKm: number;
    centroNombre: string;
  };
}

// ==============================================================
// Health Check
// ==============================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'skipped' | 'warning';

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  responseTimeMs?: number;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  version: string;
  environment: string;
  responseTimeMs: number;
  checks: Record<string, HealthCheckResult>;
}

// ==============================================================
// Configuracion
// ==============================================================

export interface DatabaseConfig {
  connectionString: string;
  connectionTimeout: number;
  requestTimeout: number;
  pool: {
    min: number;
    max: number;
    idleTimeoutMillis: number;
    acquireTimeoutMillis: number;
  };
  retry: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
}

export interface BlobConfig {
  connectionString: string;
  containerName: string;
  sasExpiryHours: number;
  maxImageSizeMB: number;
  maxAudioSizeMB: number;
}

export interface WhatsAppConfig {
  apiUrl: string;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

export interface AIConfig {
  enabled: boolean;
  provider: 'gemini' | 'azure-openai';
}

export interface SessionConfig {
  timeoutMinutes: number;
  warningMinutes: number;
}

export interface RedisConfig {
  enabled: boolean;
  host?: string;
  port: number;
  password?: string;
  tls: boolean;
}

export interface ServiceBusConfig {
  enabled: boolean;
  connectionString?: string;
  queueName: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  blob: BlobConfig;
  whatsapp: WhatsAppConfig;
  ai: AIConfig;
  session: SessionConfig;
  redis: RedisConfig;
  serviceBus: ServiceBusConfig;
}
