"""
Aplica CORS lockdown a edge functions llamadas desde frontend.
Reemplaza el patron CORS hardcoded con whitelist de origenes.
"""
import re
import sys
from pathlib import Path

CORS_HELPER = """// CORS lockdown: solo dominios permitidos pueden invocar esta edge function.
const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const isPreviewVercel = (o: string) =>
  /^https:\\/\\/crm-turdo-[a-z0-9]+-jipisacane-5891s-projects\\.vercel\\.app$/.test(o);

function buildCors(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isPreviewVercel(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
"""

# Patron 1: const CORS_HEADERS = { ... };
# Patron 2: const CORS = { ... };
PATTERN_BLOCK = re.compile(
    r"const\s+(CORS_HEADERS|CORS)\s*=\s*\{\s*"
    r"'Access-Control-Allow-Origin':\s*'\*',\s*"
    r"'Access-Control-Allow-Headers':\s*'[^']+',\s*"
    r"'Access-Control-Allow-Methods':\s*'[^']+',?\s*"
    r"\};",
    re.DOTALL
)

# Reemplaza al inicio del handler para inyectar validacion
HANDLER_PATTERN = re.compile(
    r"Deno\.serve\(async\s*\(req(?::\s*Request)?\)\s*=>\s*\{",
)

FILES = [
    'suggest-reply',
    'appraise-property',
    'update-appraisal',
    'create-client-portal',
    'send-push',
    'analyze-fallouts',
    'publish-property',
    'qualify-lead',
    'infer-lead-preferences',
]

def patch_file(name):
    path = Path(f'C:/turdo/CRM_TURDO/supabase/functions/{name}/index.ts')
    src = path.read_text(encoding='utf-8')

    match = PATTERN_BLOCK.search(src)
    if not match:
        print(f'  SKIP {name}: no se encontro bloque CORS hardcoded')
        return False

    var_name = match.group(1)  # CORS_HEADERS o CORS
    # Reemplazar el bloque CORS con el helper
    new_src = PATTERN_BLOCK.sub(CORS_HELPER.rstrip(), src, count=1)

    # Inyectar validacion al inicio del handler
    # Insertamos: const VAR = buildCors(req); if (!VAR) return ...;
    injection = (
        f"\n  const {var_name} = buildCors(req);\n"
        f"  if (!{var_name}) return new Response('Forbidden origin', {{ status: 403 }});"
    )

    handler_match = HANDLER_PATTERN.search(new_src)
    if not handler_match:
        print(f'  ERROR {name}: no se encontro Deno.serve handler')
        return False

    insert_pos = handler_match.end()
    new_src = new_src[:insert_pos] + injection + new_src[insert_pos:]

    path.write_text(new_src, encoding='utf-8')
    print(f'  OK {name} (var={var_name})')
    return True

count = 0
for name in FILES:
    if patch_file(name):
        count += 1

print(f'\nTotal patched: {count}/{len(FILES)}')
