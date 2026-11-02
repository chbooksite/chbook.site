// Recuerda en este navegador el último correo con el que se entró y el nombre
// de su iglesia, para saludar y saltar el paso del correo en el login.
// Solo datos no sensibles; nunca la contraseña.

const KEY = 'chbook:recordar'

export interface Remembered {
  email: string
  church: string | null
}

export function readRemembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as Partial<Remembered>) : null
    return v?.email ? { email: v.email, church: v.church ?? null } : null
  } catch {
    return null
  }
}

export function remember(patch: Partial<Remembered>) {
  try {
    const cur = readRemembered() ?? { email: '', church: null }
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {
    // sin almacenamiento (modo privado, bloqueado): no pasa nada
  }
}

export function forget() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ídem
  }
}
