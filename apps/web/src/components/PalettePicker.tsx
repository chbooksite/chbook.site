import { PALETTES, type PaletteKey } from '../lib/preferences'

// Selector del color de la iglesia: al elegir, toda la app cambia al instante.
export default function PalettePicker({ value, onChange }: { value: PaletteKey; onChange: (k: PaletteKey) => void }) {
  return (
    <div role="radiogroup" aria-label="Color de la iglesia" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PALETTES.map((p) => {
        const on = value === p.key
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p.key)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${on ? 'border-charcoal bg-white' : 'border-clay-light bg-white/60 hover:bg-white'}`}
          >
            <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-black/5" aria-hidden>
              <span className="h-full w-1/2" style={{ backgroundColor: p.swatch[0] }} />
              <span className="h-full w-1/2" style={{ backgroundColor: p.swatch[1] }} />
            </span>
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
