# Meta App Review Pack — Capability `instagram_manage_messages`

**Para:** Leti / Turdo Estudio Inmobiliario
**App de Meta:** TurdoManejoDeADS.com
**Fecha:** 26/05/2026

---

## ⏱ Tiempo estimado de tu parte: ~50 minutos en total

Dividido en bloques que podés hacer separados:

| Bloque | Tiempo | Cuándo |
|---|---|---|
| 1. Completar placeholders en Privacy + Terms | 10 min | Apenas tengas Razón Social, CUIT, Email, Domicilio a mano |
| 2. Verificar Business Manager | 5 min | Cuando puedas entrar a business.facebook.com |
| 3. Grabar video de demo | 15 min | Cuando tengas tiempo tranquilo |
| 4. Llenar formulario de App Review | 20 min | Al final, una vez que tengas todo lo demás |

---

## 🟢 BLOQUE 1: Completar placeholders en Privacy + Terms

Hay 4 placeholders en los archivos `src/pages/Privacy.tsx` y `src/pages/Terms.tsx`. Buscalos con Ctrl+F y reemplazalos:

| Placeholder | Reemplazar con |
|---|---|
| `{{LETI_CUIT}}` | Tu CUIT/CUIL (ej: 27-12345678-9) |
| `{{DOMICILIO_CORRIENTES}}` | Dirección de la sucursal Corrientes (ej: "Av. Corrientes 1234, piso 2, oficina B") |
| `{{EMAIL_PRIVACIDAD}}` | Email donde recibís consultas de privacidad (ej: `privacidad@turdopropiedades.com`, o `leticia@turdopropiedades.com`, o lo que tengas activo) |

Una vez los reemplaces, decime "listo" y yo pusheo el cambio. Los textos van a quedar publicados en:
- **https://crm-turdo.vercel.app/privacy**
- **https://crm-turdo.vercel.app/terms**

Estos son los URLs que vas a usar en el formulario de Meta.

---

## 🟢 BLOQUE 2: Business Manager verificado

Meta solo aprueba apps de Business Manager **verificados**. Verificar:

1. Andá a https://business.facebook.com/settings/security
2. Mirá la sección **"Verificación del negocio"**
3. Si dice "Verificado" ✅ → seguís al bloque 3
4. Si NO está verificado, hacé click en **"Iniciar verificación"** y completá con:
   - Razón social: tu nombre completo (Leticia Turdo) si es CUIT personal
   - CUIT/CUIL: el mismo del bloque 1
   - Dirección comercial: la misma de Corrientes
   - Subir constancia de inscripción de AFIP (constancia de CUIT/Monotributo, descargable de afip.gob.ar)
   - Subir un servicio (factura de luz/gas) a nombre tuyo con esa dirección

**Esto tarda 1-3 días hábiles.** Avanzá igual con los bloques 3 y 4 mientras se procesa.

---

## 🟢 BLOQUE 3: Video de demo (lo más importante)

Meta REQUIERE un screencast mostrando cómo se usa la capability en la app. Sin este video la review se rechaza al toque.

### Especificaciones del video:
- **Duración:** 60-90 segundos
- **Idioma del audio:** español (Meta acepta cualquier idioma, no hace falta inglés)
- **Resolución:** HD (1080p) o lo que dé tu celular
- **Formato:** mp4 o mov
- **Sin música de fondo** — solo voz tuya o nada
- **Pantalla:** podés grabar desde el celular apuntando a la PC, o usar herramientas tipo Loom/QuickTime

### Guion exacto (leelo tal cual mientras grabás):

```
[Pantalla 1: home del CRM — https://crm-turdo.vercel.app, ya logueada]
"Soy Leticia Turdo, dueña de Turdo Estudio Inmobiliario en Mar del Plata.
Este es nuestro CRM interno donde gestionamos las consultas de clientes."

[Click en 'Bandeja' del menú lateral]
"Acá centralizamos todas las consultas que recibimos por WhatsApp,
Instagram y Facebook Messenger."

[Filtrar por 'Instagram' arriba]
"Estos son los DMs de Instagram. Cuando un cliente nos escribe por
Instagram preguntando por una propiedad, aparece acá."

[Click en una conversación de Instagram]
"Cada conversación muestra los mensajes históricos del cliente. Esto
nos permite que cualquier vendedor del equipo le responda con contexto."

[Escribir un mensaje en la caja de texto]
"Cuando respondemos desde acá..."

[Click en Enviar]
"...la respuesta sale por Instagram y le llega al cliente como un DM
normal a su cuenta."

[Mostrar Instagram en el celular con el mensaje recibido]
"Acá lo recibe el cliente."

[Volver al CRM]
"Sin esta capability, nuestros vendedores tendrían que abrir Instagram
manualmente cada vez, perdiendo contexto del cliente. El CRM les permite
atender hasta 5 veces más rápido."
```

### Tips para grabar bien:
- Si te trabás, parás y volvés a empezar. Cortás en edición.
- El video NO necesita ser perfecto, solo que se entienda lo que mostrás.
- Si querés algo automático, herramientas: **Loom** (loom.com — gratis, graba pantalla + tu voz) o **QuickTime** (Mac) o **OBS** (todas las plataformas, free).

---

## 🟢 BLOQUE 4: Llenar el formulario de App Review

1. Andá a https://developers.facebook.com/apps
2. Seleccioná tu app (TurdoManejoDeADS.com)
3. En el menú izquierdo: **App Review → Permissions and Features**
4. Buscá **`instagram_manage_messages`** y click en **"Request Advanced Access"**
5. Vas a ver un formulario con los siguientes campos. Pegá EXACTO lo que está abajo:

### Campo 1: "How will your app use this permission?"

Pegá este texto (en inglés, Meta lo pide así):

```
Turdo Estudio Inmobiliario operates a real estate agency in Mar del Plata, Argentina, that receives sales inquiries through Instagram Direct Messages. Our internal CRM platform integrates with the Instagram Graph API to enable our authorized sales agents to view incoming DMs in a unified inbox and respond to prospects from within the CRM dashboard.

Specifically, we use `instagram_manage_messages` to:

1. Receive incoming DMs from prospects via the Instagram webhook subscription, so that customer inquiries are not lost when sales agents are not actively monitoring the Instagram app.

2. Respond to those DMs from the CRM interface, allowing any agent on the team (with the prospect assigned to them) to continue the conversation with full historical context from previous interactions, including conversations the same person had through other channels.

3. Maintain conversation continuity: if a prospect first contacts us via Instagram and later via WhatsApp (or vice versa), our CRM matches them by identifiers we already have and shows a single unified history.

Without this capability, our agents would have to switch between Instagram and our CRM manually, losing conversation context and increasing response time, which is critical in the real estate sales cycle.

All data is stored securely (encrypted at rest in Supabase, transmitted over HTTPS) and is used exclusively for the business relationship with the inquiring prospect. We do not share Instagram data with third parties, do not use it for unsolicited marketing to other audiences, and respect Instagram's 24-hour messaging window policy.

Our privacy policy is available at https://crm-turdo.vercel.app/privacy and our terms of service at https://crm-turdo.vercel.app/terms.
```

### Campo 2: "Provide step-by-step instructions to test"

Pegá esto:

```
Test environment: https://crm-turdo.vercel.app

Test credentials (login):
- Email: review@turdopropiedades.com
- Password: TurdoReview2026!

Steps to test the integration:

1. Go to https://crm-turdo.vercel.app and log in with the credentials above.
2. From the main menu, click "Bandeja" (Inbox).
3. Filter by "Instagram" at the top of the inbox to see only Instagram conversations.
4. Click on any conversation in the list to open it.
5. You will see the full message history from that Instagram user.
6. Type a test message in the textarea at the bottom and click "Enviar" (Send).
7. The message will be delivered via the Instagram Graph API to the prospect's Instagram DM.
8. The reply that the prospect sends back will appear in real-time in the same conversation.

The integration relies on the `instagram_manage_messages` permission to (a) receive the inbound DM events via webhook subscription and (b) send replies on behalf of the Instagram Business Account connected to the Turdo Estudio Inmobiliario page.

A demo video showing this exact flow is attached.
```

### Campo 3: Upload del video
Subí el video que grabaste en el Bloque 3.

### Campo 4: "Platform"
Seleccioná: **Web**

### Campo 5: Privacy Policy URL
Pegá: `https://crm-turdo.vercel.app/privacy`

### Campo 6: Terms of Service URL
Pegá: `https://crm-turdo.vercel.app/terms`

### Campo 7: App Icon (si no está cargado)
Subí el logo de Turdo (al menos 1024x1024 px, fondo no transparente). Si no tenés uno fresco, decime y armo uno.

### Campo 8: Submit
Click en **Submit for Review**. Vas a recibir un email confirmando que la solicitud entró.

---

## ⏳ Qué pasa después

- Meta confirma recibo en 24h
- Review queue: 5-15 días hábiles
- Resultado: aprobado, rechazado con feedback (podés re-submitir), o pedido de más info
- Si rechazan, Meta SIEMPRE explica por qué — leo el feedback y armamos la respuesta juntos

## 📝 Test user que necesito crear para Meta

Antes de submitir el bloque 4, voy a crear un usuario `review@turdopropiedades.com` con permisos de admin solo de lectura en el CRM. Es para que los reviewers de Meta puedan probar la integración sin que vean datos reales sensibles ni puedan modificar nada.

Avisame cuando completes el Bloque 1 (placeholders) y yo:
1. Pusheo el cambio (deploya en Vercel automáticamente)
2. Creo el usuario `review@turdopropiedades.com`
3. Te confirmo que todo está listo para que arranques con el Bloque 2/3/4

---

## 🚨 Errores comunes que rechazan el review (para que los evites)

| Error | Cómo prevenirlo |
|---|---|
| Privacy policy con texto genérico de plantilla | El que armé es específico para Turdo, no genérico ✓ |
| Video muestra otra app o no muestra la capability en uso | El guion que armé muestra justo la capability ✓ |
| Test credentials que no funcionan | Voy a crear el usuario y testear antes de que submitas |
| Business Manager sin verificar | Bloque 2 es justo eso |
| URLs de privacy/terms con 404 | Una vez deployadas en Vercel, las testeo antes |
| Justification genérica ("para mejorar el servicio") | El texto en Campo 1 es específico ✓ |
