import { useState } from 'react'
import { applyPalette, PALETTES, readPalette, type PaletteKey } from '../lib/preferences'

// Selector del color principal: cambia toda la app al instante para comparar tonos.
// `compact`: solo las muestras (menú de cuenta); si no, muestras con nombre.
export default function PalettePicker({ compact = false }: { compact?: boolean }) {
  const [current, setCurrent] = useState<PaletteKey>(readPalette)
  const pick = (k: PaletteKey) => {
    applyPalette(k)
    setCurrent(k)
  }
  return (
    <div role="radiogroup" aria-label="Color principal" className={compact ? 'flex items-center justify-between gap-1.5' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
      {PALETTES.map((p) => {
        const on = current === p.key
        const dot = (
          <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-black/5" aria-hidden>
            <span className="h-full w-1/2" style={{ backgroundColor: p.swatch[0] }} />
            <span className="h-full w-1/2" style={{ backgroundColor: p.swatch[1] }} />
          </span>
        )
        return compact ? (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={on}
            title={`${p.name} · ${p.hint}`}
            aria-label={p.name}
            onClick={() => pick(p.key)}
            className={`rounded-full p-0.5 transition ${on ? 'ring-2 ring-charcoal' : 'hover:scale-110'}`}
          >
            {dot}
          </button>
        ) : (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => pick(p.key)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${on ? 'border-charcoal bg-white' : 'border-clay-light bg-white/60 hover:bg-white'}`}
          >
            {dot}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-charcoal">{p.name}</span>
              <span className="block text-xs text-graysage">{p.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
