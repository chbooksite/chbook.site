// Preferencias de este navegador (no se sincronizan): por ahora, "letra grande".
// Se aplica como clase en <html> (ver html.letra-grande en index.css).

const KEY = 'chbook:letra-grande'

export function readLargeText(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function applyLargeText(on: boolean) {
  document.documentElement.classList.toggle('letra-grande', on)
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // sin almacenamiento: se aplica solo en esta sesión
  }
}
