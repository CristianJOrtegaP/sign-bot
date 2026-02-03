# Guia de Personalizacion - AC FixBot

Esta guia explica como personalizar mensajes, flujos de conversacion y comportamientos del chatbot.

---

## Indice

1. [Personalizar Mensajes](#1-personalizar-mensajes)
2. [Personalizar Botones](#2-personalizar-botones)
3. [Personalizar Encuestas](#3-personalizar-encuestas)
4. [Agregar Nuevos Flujos](#4-agregar-nuevos-flujos)
5. [Personalizar Deteccion de Intenciones](#5-personalizar-deteccion-de-intenciones)
6. [Personalizar Validaciones](#6-personalizar-validaciones)
7. [Personalizar Configuracion](#7-personalizar-configuracion)

---

## 1. Personalizar Mensajes

### Ubicacion de Mensajes

Todos los mensajes estan centralizados en:

```
bot/constants/messages.js
```

### Estructura

```javascript
// MENSAJES GENERALES
const GENERAL = {
    BOT_NAME: 'AC FixBot',
    COMPANY: 'Arca Continental',
    GREETING: '¡Hola! Soy *AC FixBot*',
    WELCOME_BODY: '¿Qué equipo necesitas reportar?',
    GOODBYE: '¡Hasta pronto! Escríbeme cuando necesites ayuda.',
    CANCELLED: '❌ Reporte cancelado.\n\nEscríbeme cuando necesites ayuda.'
};

// MENSAJES DE REFRIGERADOR
const REFRIGERADOR = {
    REQUEST_SAP: '❄️ *Refrigerador*\n\n' +
        'Ingresa el *Número SAP* del refrigerador.\n\n' +
        'Está en la etiqueta del equipo.\n\n' +
        'También puedes enviar *foto del código de barras*.',

    // Mensaje dinamico con datos del equipo
    equipoInfo: (equipo) =>
        `*SAP:* ${equipo.CodigoSAP}\n` +
        `*Modelo:* ${equipo.Modelo}\n` +
        `*Cliente:* ${equipo.NombreCliente}\n\n` +
        '¿Es correcto?',
};
```

### Ejemplo: Cambiar Mensaje de Bienvenida

```javascript
// bot/constants/messages.js

const GENERAL = {
    BOT_NAME: 'MiBot',  // Cambia el nombre
    COMPANY: 'Mi Empresa',
    GREETING: '¡Bienvenido! Soy *MiBot* 🤖',  // Personaliza saludo
    WELCOME_BODY: '¿Como te puedo ayudar hoy?',  // Cambia pregunta inicial
    // ...
};
```

### Formato de Texto WhatsApp

WhatsApp soporta formato basico:

| Formato | Sintaxis | Resultado |
|---------|----------|-----------|
| Negrita | `*texto*` | **texto** |
| Italica | `_texto_` | *texto* |
| Tachado | `~texto~` | ~~texto~~ |
| Monospace | ``` `texto` ``` | `texto` |

### Emojis

Se recomienda usar emojis al inicio de mensajes para claridad visual:

```javascript
'❄️ *Refrigerador*'      // Refrigerador
'🚗 *Vehículo*'          // Vehiculo
'✅ *Confirmado*'        // Confirmacion
'❌ *Error*'             // Error
'📍 *Ubicación*'         // Ubicacion
'📋 *Datos detectados*'  // Informacion
```

---

## 2. Personalizar Botones

### Ubicacion

```
bot/constants/messages.js → BUTTONS, BUTTONS_ENCUESTA
```

### Estructura de Botones

```javascript
const BUTTONS = {
    TIPO_REFRIGERADOR: { id: 'btn_tipo_refrigerador', title: '❄️ Refrigerador' },
    TIPO_VEHICULO: { id: 'btn_tipo_vehiculo', title: '🚗 Vehículo' },
    CONFIRMAR_EQUIPO: { id: 'btn_confirmar_equipo', title: '✅ Sí' },
    CORREGIR_EQUIPO: { id: 'btn_corregir_equipo', title: '❌ No, corregir' },
    CANCELAR: { id: 'btn_cancelar', title: '🚫 Cancelar' }
};
```

### Limitaciones de WhatsApp

- **Maximo 3 botones** por mensaje
- **Maximo 20 caracteres** en titulo de boton
- IDs deben ser unicos

### Agregar Nuevo Tipo de Equipo

1. **Agregar boton:**
```javascript
const BUTTONS = {
    // ... existentes
    TIPO_MAQUINA_VENTA: { id: 'btn_tipo_maquina', title: '🥤 Máquina Venta' }
};
```

2. **Manejar en FlowManager:**
```javascript
// bot/controllers/flows/FlowManager.js
case 'btn_tipo_maquina':
    return await maquinaVentaFlow.handleStart(telefono, messageId, context);
```

---

## 3. Personalizar Encuestas

### Preguntas de Encuesta

Las 6 preguntas estan en:

```javascript
// bot/constants/messages.js → ENCUESTA

const ENCUESTA = {
    PREGUNTA_1: '*Pregunta 1 de 6:*\n\n' +
        '¿Como calificarias la atencion recibida al momento de reportar la falla?',

    PREGUNTA_2: '*Pregunta 2 de 6:*\n\n' +
        '¿Consideras que el tiempo de reparacion de tu unidad fue el adecuado?',

    PREGUNTA_3: '*Pregunta 3 de 6:*\n\n' +
        '¿Se cumplio la fecha compromiso de entrega?',

    PREGUNTA_4: '*Pregunta 4 de 6:*\n\n' +
        '¿Recibiste la unidad limpia?',

    PREGUNTA_5: '*Pregunta 5 de 6:*\n\n' +
        '¿Te informaron sobre la reparacion realizada?',

    PREGUNTA_6: '*Pregunta 6 de 6:*\n\n' +
        '¿Se corrigio la falla reportada?'
};
```

### Cambiar Numero de Preguntas

1. Modificar constantes en `messages.js`
2. Actualizar logica en `encuestaFlow.js`:

```javascript
// bot/controllers/flows/encuestaFlow.js
const TOTAL_PREGUNTAS = 6;  // Cambiar segun necesidad

// En handleRating:
if (preguntaActual >= TOTAL_PREGUNTAS) {
    // Pasar a comentario final
}
```

### Escala de Calificacion

Por defecto es 1-5. Para cambiar:

```javascript
// messages.js
INSTRUCCIONES:
    '*Instrucciones:*\n' +
    'Indica tecleando un numero del *1 al 10* como consideras...\n\n' +
    '10 = Excelente\n' +
    // ...

// encuestaFlow.js - ajustar validacion
if (rating < 1 || rating > 10) {
    // Respuesta invalida
}
```

---

## 4. Agregar Nuevos Flujos

### Estructura de un Flujo

Cada flujo maneja un tipo de reporte. Ubicacion:

```
bot/controllers/flows/
├── FlowManager.js        # Router principal
├── refrigeradorFlow.js   # Flujo refrigerador
├── vehiculoFlow.js       # Flujo vehiculo
├── encuestaFlow.js       # Flujo encuesta
└── consultaEstadoFlow.js # Flujo consulta
```

### Crear Nuevo Flujo: Maquina de Venta

1. **Crear archivo del flujo:**

```javascript
// bot/controllers/flows/maquinaVentaFlow.js

const whatsapp = require('../../../core/services/external/whatsappService');
const { SesionRepository, EquipoRepository, ReporteRepository } = require('../../repositories');
const { VALIDACION } = require('../../constants/messages');

const MAQUINA_VENTA = {
    REQUEST_SAP: '🥤 *Máquina de Venta*\n\n' +
        'Ingresa el *Número SAP* del equipo:',

    CONFIRMED: '✅ *Máquina confirmada*\n\n' +
        'Describe el problema:',

    reporteCreado: (ticket, equipo, descripcion) =>
        `✅ *Reporte creado*\n\n` +
        `*Ticket:* ${ticket}\n` +
        `*Equipo:* ${equipo.Modelo}\n` +
        `*Problema:* ${descripcion}`
};

async function handleStart(telefono, messageId, context) {
    const sesionRepo = new SesionRepository(context);

    await sesionRepo.updateState(telefono, 'MAQUINA_ESPERA_SAP', {
        tipoReporte: 'MAQUINA_VENTA'
    });

    await whatsapp.sendMessage(telefono, MAQUINA_VENTA.REQUEST_SAP);
}

async function handleSAP(telefono, codigoSAP, messageId, context) {
    const equipoRepo = new EquipoRepository(context);
    const sesionRepo = new SesionRepository(context);

    // Buscar equipo
    const equipo = await equipoRepo.findBySAP(codigoSAP);

    if (!equipo) {
        await whatsapp.sendMessage(telefono, VALIDACION.CODIGO_INVALIDO);
        return;
    }

    await sesionRepo.updateState(telefono, 'MAQUINA_ESPERA_DESCRIPCION', {
        equipoId: equipo.EquipoId,
        codigoSAP
    });

    await whatsapp.sendMessage(telefono, MAQUINA_VENTA.CONFIRMED);
}

async function handleDescripcion(telefono, descripcion, messageId, context) {
    const sesionRepo = new SesionRepository(context);
    const reporteRepo = new ReporteRepository(context);
    const equipoRepo = new EquipoRepository(context);

    const sesion = await sesionRepo.findByTelefono(telefono);
    const equipo = await equipoRepo.findById(sesion.EquipoId);

    // Crear reporte
    const ticket = await reporteRepo.create({
        telefono,
        tipoReporte: 'MAQUINA_VENTA',
        equipoId: sesion.EquipoId,
        descripcion
    });

    await sesionRepo.updateState(telefono, 'INICIO');

    await whatsapp.sendMessage(
        telefono,
        MAQUINA_VENTA.reporteCreado(ticket, equipo, descripcion)
    );
}

module.exports = {
    handleStart,
    handleSAP,
    handleDescripcion
};
```

2. **Registrar en FlowManager:**

```javascript
// bot/controllers/flows/FlowManager.js

const maquinaVentaFlow = require('./maquinaVentaFlow');

// En handleButton:
case 'btn_tipo_maquina':
    return await maquinaVentaFlow.handleStart(telefono, messageId, context);

// En routeByState:
case 'MAQUINA_ESPERA_SAP':
    return await maquinaVentaFlow.handleSAP(telefono, texto, messageId, context);

case 'MAQUINA_ESPERA_DESCRIPCION':
    return await maquinaVentaFlow.handleDescripcion(telefono, texto, messageId, context);
```

3. **Agregar estados a catalogo:**

```sql
INSERT INTO CatEstadoSesion (Codigo, Nombre) VALUES
('MAQUINA_ESPERA_SAP', 'Máquina - Espera SAP'),
('MAQUINA_ESPERA_DESCRIPCION', 'Máquina - Espera Descripción');
```

4. **Agregar tipo de reporte:**

```sql
INSERT INTO CatTipoReporte (Codigo, Nombre) VALUES
('MAQUINA_VENTA', 'Máquina de Venta');
```

---

## 5. Personalizar Deteccion de Intenciones

### Patrones Regex

Para deteccion sin IA, los patrones estan en:

```javascript
// core/services/ai/intentService.js

const REFRIGERADOR_PATTERNS = [
    /refri(gerador)?/i,
    /enfriador/i,
    /cooler/i,
    /no\s*(enfria|congela)/i,
    /gotea/i,
    /hielo/i
];

const VEHICULO_PATTERNS = [
    /vehiculo/i,
    /camion/i,
    /carro/i,
    /auto/i,
    /no\s*arranca/i,
    /frenos/i
];
```

### Agregar Nuevos Patrones

```javascript
const MAQUINA_PATTERNS = [
    /maquina/i,
    /vending/i,
    /expendedora/i,
    /no\s*despacha/i,
    /atasco/i
];
```

### Prompts de IA

Los prompts para Gemini/Azure OpenAI estan en:

```javascript
// core/services/ai/providers/prompts.js

const INTENT_PROMPT = `
Eres un asistente que clasifica mensajes de usuarios...

Intenciones posibles:
- REFRIGERADOR: Problema con refrigerador, enfriador, cooler
- VEHICULO: Problema con vehiculo, camion, auto
- MAQUINA_VENTA: Problema con maquina expendedora  // Agregar nuevo
- SALUDO: Saludo general
- DESPEDIDA: Despedida
- OTRO: No clasificable

Responde SOLO con JSON:
{
    "intent": "REFRIGERADOR|VEHICULO|MAQUINA_VENTA|...",
    "confidence": 0.0-1.0,
    "problema": "descripcion extraida"
}
`;
```

---

## 6. Personalizar Validaciones

### Validacion con Zod

Los esquemas de validacion estan en:

```javascript
// bot/schemas/reportePayload.js

const reporteSchema = z.object({
    telefono: z.string()
        .regex(/^\d{10,15}$/, 'Telefono debe tener 10-15 digitos'),

    tipoReporte: z.enum(['REFRIGERADOR', 'VEHICULO', 'MAQUINA_VENTA']),

    codigoSAP: z.string()
        .regex(/^\d{7}$/, 'SAP debe tener 7 digitos')
        .optional(),

    descripcion: z.string()
        .min(5, 'Descripcion muy corta')
        .max(500, 'Descripcion muy larga')
});
```

### Agregar Validacion Personalizada

```javascript
// Validar numero de empleado con formato especifico
const empleadoSchema = z.string()
    .regex(/^EMP\d{5}$/, 'Formato: EMP + 5 digitos');

// Validar ubicacion
const ubicacionSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
});
```

---

## 7. Personalizar Configuracion

### Archivo de Configuracion Central

```javascript
// core/config/index.js

// Umbrales de confianza de IA
ai: {
    confidence: {
        high: 0.9,      // Confianza alta
        medium: 0.7,    // Umbral minimo para usar IA
        low: 0.5        // Fallback a regex
    }
}

// Rate limiting
rateLimiting: {
    messages: {
        maxPerMinute: 20,  // Ajustar segun necesidad
        maxPerHour: 100
    }
}

// Tipos de equipo
equipmentTypes: {
    REFRIGERADOR: 'REFRIGERADOR',
    VEHICULO: 'VEHICULO',
    MAQUINA_VENTA: 'MAQUINA_VENTA'  // Agregar nuevo
}
```

---

## Mejores Practicas

### 1. Mantener Mensajes Cortos

Los usuarios de WhatsApp prefieren mensajes breves:

```javascript
// Malo
'Por favor, ingrese el numero SAP que se encuentra en la etiqueta
del refrigerador. Este numero tiene 7 digitos y puede encontrarlo
en la parte inferior derecha de la etiqueta.'

// Bueno
'Ingresa el *Número SAP* (7 dígitos).\n\nEstá en la etiqueta del equipo.'
```

### 2. Usar Confirmaciones Visuales

```javascript
'✅ Reporte creado'     // Exito
'❌ Codigo invalido'    // Error
'⚠️ Espera un momento'  // Warning
```

### 3. Proporcionar Ejemplos

```javascript
'Describe el problema:\n_Ejemplo: No enfría, gotea, hace ruido_'
```

### 4. Tests para Cambios

Siempre crear tests para nuevos flujos:

```javascript
// tests/flows/maquinaVentaFlow.test.js
describe('Maquina Venta Flow', () => {
    it('should request SAP on start', async () => {
        // ...
    });
});
```

---

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
