# Integraciones de publish-property

Edge function que publica/despublica propiedades en Mercado Libre + web propia de Turdo. El código está completo. Falta solo configurar credenciales.

## Mercado Libre — pasos para activar

### 1. Crear app en developers.mercadolibre.com

1. Andá a https://developers.mercadolibre.com.ar/devcenter
2. **+ Crear aplicación**
3. Datos:
   - Nombre: `Turdo CRM Publisher`
   - Descripción: "Publica propiedades inmobiliarias desde el CRM interno"
   - URL Redirect: `https://crm-turdo.vercel.app/oauth/ml-callback` (no existe aún, ver paso 3)
   - Topics: dejar vacío
   - Permisos: `read write offline_access` (ya viene por default)
4. Al terminar te muestra `App ID` y `Secret Key`. Anotá ambos.

### 2. Guardar credenciales en Supabase

```bash
npx supabase secrets set ML_CLIENT_ID=<App_ID> --project-ref dmwtyonwivujybvnopqq
npx supabase secrets set ML_CLIENT_SECRET=<Secret_Key> --project-ref dmwtyonwivujybvnopqq
```

### 3. OAuth flow inicial (1 sola vez por Leti)

1. En tu browser, andá a:
   ```
   https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=<App_ID>&redirect_uri=https://crm-turdo.vercel.app/oauth/ml-callback
   ```
2. Logueate con la cuenta ML de **Turdo** (la que va a publicar)
3. Aceptá los permisos
4. ML te redirige a `crm-turdo.vercel.app/oauth/ml-callback?code=XXXXXXX` — esa página no existe pero la URL contiene el `code` que necesitamos. Copialo
5. Intercambiar el code por tokens:
   ```bash
   curl -X POST https://api.mercadolibre.com/oauth/token \
     -d "grant_type=authorization_code" \
     -d "client_id=<App_ID>" \
     -d "client_secret=<Secret_Key>" \
     -d "code=<el_code_que_copiaste>" \
     -d "redirect_uri=https://crm-turdo.vercel.app/oauth/ml-callback"
   ```
6. La respuesta tiene `refresh_token` y `user_id`. Guardar ambos:
   ```bash
   npx supabase secrets set ML_REFRESH_TOKEN=<refresh_token>
   npx supabase secrets set ML_USER_ID=<user_id>
   ```

### 4. Probar

Al publicar una propiedad desde el CRM, debería sincronizar a ML automáticamente. Si falla, ver los logs de la function `publish-property` en Supabase dashboard.

### Notas importantes

- **Refresh token rota**: cada vez que se usa, ML emite un nuevo refresh_token. Si llegamos a un punto donde la function siempre falla con "invalid refresh token", buscar en function logs el nuevo refresh_token loggeado y actualizar el secret. (TODO: auto-update via Management API)
- **Categorías ML**: el mapeo de tipo de propiedad → categoría ML está hardcoded en `_shared/mercadolibre.ts` (MLA1466 para departamento venta, etc). Si Leti quiere agregar tipos nuevos, editar `ML_CATEGORY_MAP`
- **Listing type**: por default usa `silver` (ahorrador). Para más visibilidad cambiar a `gold` o `gold_pro` (más caro)

---

## Web propia (turdopropiedades.com)

### Lo que recibe la web

Endpoint POST configurado en `TURDO_WEB_WEBHOOK_URL` que recibe:

```json
{
  "event": "property.published" | "property.unpublished",
  "property_id": "uuid",
  "slug": "depto-3-amb-plaza-mitre-145000",
  "internal_code": "TRD-001",
  "property": {
    "title": "Av. Colón 2300",
    "price": 145000,
    "currency": "USD",
    "operation": "venta",
    "type": "departamento",
    "address": "Av. Colón 2300",
    "barrio": "Plaza Mitre",
    "city": "Mar del Plata",
    "province": "Buenos Aires",
    "rooms": 3,
    "bedrooms": 2,
    "bathrooms": 1,
    "surface_m2": 88,
    "description": "...",
    "cover_photo": "https://...",
    "public_url": "https://crm-turdo.vercel.app/p/depto-3-amb-..."
  }
}
```

Si setás `TURDO_WEB_WEBHOOK_SECRET`, se manda en header `X-Webhook-Secret` para que la web valide el origen.

### Pasos para activar

1. La web de Turdo (turdopropiedades.com) tiene que exponer un endpoint que reciba este POST y guarde / actualice / borre la propiedad en su DB
2. Una vez tenga la URL, configurar:
   ```bash
   npx supabase secrets set TURDO_WEB_WEBHOOK_URL=https://turdopropiedades.com.ar/api/properties/webhook
   npx supabase secrets set TURDO_WEB_WEBHOOK_SECRET=<random_string_para_validar>
   ```

### Alternativa sin webhook

Si la web prefiere PULL en vez de PUSH: puede leer directamente de la view `v_published_properties` en Supabase (acceso read-only con anon key). Los datos están siempre frescos. Ver `supabase/migrations/*_properties_v2*.sql` para el schema.
