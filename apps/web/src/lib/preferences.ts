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

// Paleta del color principal (ver :root[data-paleta] en index.css). Para probar
// tonos sin tocar la marca: se guarda en este navegador.
export const PALETTES = [
  { key: 'salvia', name: 'Salvia', hint: 'El original', swatch: ['#2D5A50', '#6B9E91'] },
  { key: 'eucalipto', name: 'Eucalipto', hint: 'Verde grisáceo', swatch: ['#345857', '#7FA19F'] },
  { key: 'bosque', name: 'Bosque', hint: 'Verde más vivo', swatch: ['#24533F', '#66A083'] },
  { key: 'oliva', name: 'Oliva', hint: 'Verde cálido', swatch: ['#4A5636', '#929F72'] },
  { key: 'petroleo', name: 'Petróleo', hint: 'Azul verdoso', swatch: ['#284C5B', '#6D96A7'] },
  { key: 'pizarra', name: 'Pizarra', hint: 'Gris neutro', swatch: ['#384045', '#85909A'] },
] as const

export type PaletteKey = (typeof PALETTES)[number]['key']
const PALETTE_KEY = 'chbook:paleta'

export function readPalette(): PaletteKey {
  try {
    const v = localStorage.getItem(PALETTE_KEY)
    return PALETTES.some((p) => p.key === v) ? (v as PaletteKey) : 'salvia'
  } catch {
    return 'salvia'
  }
}

export function applyPalette(key: PaletteKey) {
  if (key === 'salvia') delete document.documentElement.dataset.paleta
  else document.documentElement.dataset.paleta = key
  try {
    if (key === 'salvia') localStorage.removeItem(PALETTE_KEY)
    else localStorage.setItem(PALETTE_KEY, key)
  } catch {
    // sin almacenamiento: se aplica solo en esta sesión
  }
}
