// Sanitiza PII en logs (Ley 25.326).
// Reemplaza phones/emails/DNIs por hashes parciales antes de loguear.

export function safeLog(prefix: string, obj: unknown, maxLen = 200): void {
  let s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  // Mascarar teléfonos (+54xxxxxxxxxx, 11+ dígitos)
  s = s.replace(/(\+?54)?\s*9?\s*\d{2,4}[-\s]?\d{6,8}/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 6 ? `<phone:***${digits.slice(-4)}>` : m;
  });
  // Mascarar emails (deja primera letra + dominio truncado)
  s = s.replace(/([a-zA-Z0-9._-])[a-zA-Z0-9._-]*@([a-zA-Z0-9-]+)\.[a-zA-Z0-9.-]+/g, '$1***@$2.***');
  // Mascarar DNIs (7-8 dígitos seguidos, no después de + o dentro de phone)
  s = s.replace(/(?<![+\d])\b\d{7,8}\b(?!\d)/g, '<dni:***>');
  console.log(prefix, s.slice(0, maxLen));
}
