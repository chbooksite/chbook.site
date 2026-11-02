// Invitación de miembros: el QR lleva a /unirse/CHBK-XXXX de esta misma web.
// Se puede apuntar a otro dominio con VITE_JOIN_URL (p. ej. una landing propia).
const JOIN_BASE = (import.meta.env.VITE_JOIN_URL as string | undefined) ?? `${window.location.origin}/unirse/`

export function joinUrl(code: string): string {
  return `${JOIN_BASE.replace(/\/?$/, '/')}${encodeURIComponent(code)}`
}

// Mensaje listo para WhatsApp (sin jerga religiosa, directo).
export function inviteMessage(churchName: string, code: string): string {
  return `Únete a ${churchName} en ChBook: ${joinUrl(code)}\nO ingresa el código ${code} en la app.`
}
