// Clases compartidas (paleta oficial, ver docs/DISENO.md). Planas: sin sombras de color.

// Botón principal (sage oscuro) — acciones que avanzan.
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-sage-dark px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-sage-deep disabled:opacity-60'
// Botón secundario — acciones neutras.
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-clay-light bg-white px-4 py-2.5 text-sm font-medium text-charcoal transition hover:bg-cream disabled:opacity-60'
// Campo de formulario.
export const fieldCls =
  'w-full rounded-xl border border-clay-light bg-white px-3.5 py-2.5 text-base text-charcoal outline-none transition placeholder:text-faint focus:border-sage-dark focus:ring-4 focus:ring-sage-light'

// Series de los gráficos (paleta oficial). Orden fijo: principal, segunda, tercera.
// Variables CSS: siguen la paleta elegida en Apariencia (usar en `style`, no en atributos SVG).
export const SERIES = { main: 'var(--sage-dark)', second: '#B8956A', third: 'var(--sage-water)' }

// Saludo según la hora (login y banda del Dashboard).
export function greeting(d: Date): string {
  const h = d.getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}
