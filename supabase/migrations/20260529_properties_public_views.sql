-- Bug (Tomi 29/05/2026): el link público de una propiedad no abría. La página
-- PropertyPublic consulta properties/property_photos como anon (el comprador no
-- está logueado), pero esas tablas solo permiten SELECT a usuarios autenticados
-- (auth.uid() IS NOT NULL) → 0 filas → "no se puede ingresar".
--
-- No se puede abrir properties a anon directamente: tiene columnas sensibles
-- (owner_name, owner_phone, notes, captador_id, internal_code) que NO deben ser
-- públicas. Solución: vistas con SOLO columnas seguras de propiedades PUBLICADAS,
-- accesibles por anon. security_invoker=off → la vista filtra por su cuenta y la
-- tabla base sigue cerrada al público (no se puede leer properties directo).

CREATE OR REPLACE VIEW public.properties_public AS
SELECT id, address, description, rooms, surface_m2, list_price_usd, status, barrio,
       cover_photo_url, slug, operation_type, property_type, street, street_number,
       floor, apartment_letter, city, province, country, latitude, longitude,
       price_currency, expenses_ars, surface_total_m2, bedrooms, bathrooms, garage,
       age_years, orientation, condition, amenities, is_published, published_at,
       video_url, floor_plan_url, created_at
FROM public.properties
WHERE is_published = true;

ALTER VIEW public.properties_public SET (security_invoker = off);

CREATE OR REPLACE VIEW public.property_photos_public AS
SELECT pp.id, pp.property_id, pp.url, pp.storage_path, pp.order_index, pp.is_cover,
       pp.alt_text, pp.width, pp.height, pp.mime, pp.created_at
FROM public.property_photos pp
JOIN public.properties p ON p.id = pp.property_id
WHERE p.is_published = true;

ALTER VIEW public.property_photos_public SET (security_invoker = off);

GRANT SELECT ON public.properties_public TO anon, authenticated;
GRANT SELECT ON public.property_photos_public TO anon, authenticated;
