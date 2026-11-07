import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { ASSET_MAX_MB, ASSET_TYPES, clearChurchAsset, setBrand, suggestPalette, uploadChurchAsset, type Brand, type Focus, type LogoStyle } from '../lib/brand'
import { PALETTES, type PaletteKey } from '../lib/preferences'
import { LogoMark } from './Logo'
import ChurchLogo from './ChurchLogo'

// Ajustes → Identidad: logo y foto del templo de la iglesia, con vista previa
// del encabezado y la banda de Inicio. En la vista previa se arrastra la foto
// para elegir qué parte se ve, y si el logo tiene un color claro se sugiere la
// paleta que combina con él.
export default function BrandEditor({
  churchId,
  brand,
  onSettings,
  onPalette,
}: {
  churchId: string
  brand: Brand
  onSettings: (patch: Record<string, unknown>) => void // guarda en churches.settings
  onPalette: (k: PaletteKey) => void
}) {
  const [busy, setBusy] = useState<'logo' | 'cover' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const upload = async (kind: 'logo' | 'cover', f: File) => {
    setBusy(kind)
    setMsg(null)
    const r = await uploadChurchAsset(churchId, kind, f)
    setBusy(null)
    setMsg(r.error)
    if (r.logo) onSettings(r.logo)
    if (kind === 'cover' && !r.error) onSettings({ cover_focus: null })
  }
  const clear = async (kind: 'logo' | 'cover') => {
    setBusy(kind)
    setMsg(await clearChurchAsset(churchId, kind))
    setBusy(null)
  }
  const setStyle = (s: LogoStyle) => {
    setBrand({ logoStyle: s })
    onSettings({ logo_style: s })
  }

  const suggested = brand.logoUrl ? suggestPalette(brand.logoColor) : null
  const current = brand.palette ?? 'salvia'
  const sugInfo = suggested && suggested !== current ? PALETTES.find((p) => p.key === suggested) : null

  return (
    <section className="tarjeta p-5 sm:p-6">
      <h2 className="font-serif text-lg font-bold text-charcoal">Identidad de la iglesia</h2>
      <p className="mt-0.5 mb-5 text-sm text-graysage">Tu logo y la foto de tu templo reemplazan a los de ChBook en el panel. Los ve todo tu equipo.</p>

      <Preview brand={brand} onFocus={(f) => onSettings({ cover_focus: f })} />

      {sugInfo && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-clay-light bg-white/70 px-4 py-3">
          <span className="flex items-center gap-1.5" aria-hidden>
            <span className="h-6 w-6 rounded-full ring-1 ring-black/5" style={{ backgroundColor: brand.logoColor ?? '#888' }} />
            <span className="text-faint">→</span>
            <span className="flex h-6 w-6 overflow-hidden rounded-full ring-1 ring-black/5">
              <span className="h-full w-1/2" style={{ backgroundColor: sugInfo.swatch[0] }} />
              <span className="h-full w-1/2" style={{ backgroundColor: sugInfo.swatch[1] }} />
            </span>
          </span>
          <p className="min-w-0 flex-1 text-sm text-charcoal">
            La paleta <b>{sugInfo.name}</b> combina con el color de tu logo.
          </p>
          <button type="button" onClick={() => onPalette(sugInfo.key)} className="rounded-lg bg-sage-dark px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-sage-deep">
            Usar {sugInfo.name}
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <AssetField
          title="Logo"
          hint="Cuadrado (PNG o SVG). Puede tener su propio fondo o ser transparente."
          preview={brand.logoUrl ? <ChurchLogo src={brand.logoUrl} style={brand.logoStyle} size={64} className="ring-1 ring-clay-light" /> : <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-clay-light text-xs text-faint">Sin logo</span>}
          busy={busy === 'logo'}
          has={!!brand.logoUrl}
          onFile={(f) => upload('logo', f)}
          onClear={() => clear('logo')}
          extra={
            brand.logoUrl && (
              <div role="radiogroup" aria-label="Cómo se muestra el logo" className="mt-2 inline-flex rounded-lg bg-white p-0.5 text-xs">
                {([['full', 'Sin marco'], ['transparent', 'Con placa blanca']] as const).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={brand.logoStyle === k} onClick={() => setStyle(k)} className={`rounded-md px-2.5 py-1 font-medium transition ${brand.logoStyle === k ? 'bg-sage-dark text-paper' : 'text-graysage hover:text-charcoal'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )
          }
        />
        <AssetField
          title="Foto del templo"
          hint="Horizontal. Arrástrala en la vista previa para elegir qué parte se ve."
          preview={brand.coverUrl ? <img src={brand.coverUrl} alt="Foto actual" className="h-16 w-24 rounded-xl border border-clay-light object-cover" style={{ objectPosition: `${brand.coverFocus.x}% ${brand.coverFocus.y}%` }} /> : <span className="flex h-16 w-24 items-center justify-center rounded-xl border border-dashed border-clay-light text-xs text-faint">Sin foto</span>}
          busy={busy === 'cover'}
          has={!!brand.coverUrl}
          onFile={(f) => upload('cover', f)}
          onClear={() => clear('cover')}
        />
      </div>
      {msg && <p className="mt-3 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{msg}</p>}
    </section>
  )
}

// Vista previa del encabezado y la banda. Con foto propia, se arrastra para
// mover el encuadre (se guarda al soltar).
function Preview({ brand, onFocus }: { brand: Brand; onFocus: (f: Focus) => void }) {
  const drag = useRef<{ x: number; y: number; f: Focus; w: number; h: number } | null>(null)
  const [live, setLive] = useState<Focus | null>(null)
  const focus = live ?? brand.coverFocus
  const can = !!brand.coverUrl

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!can) return
    const r = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX, y: e.clientY, f: focus, w: r.width, h: r.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // Arrastrar a la derecha muestra más de la izquierda (como mover la foto con la mano).
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
    setLive({ x: clamp(d.f.x - ((e.clientX - d.x) / d.w) * 100), y: clamp(d.f.y - ((e.clientY - d.y) / d.h) * 160) })
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    if (live) {
      setBrand({ coverFocus: live })
      onFocus(live)
    }
    setLive(null)
  }

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-clay-light bg-paper">
      <div className="flex items-center gap-2.5 bg-sage-dark px-4 py-2.5" aria-hidden>
        {brand.logoUrl ? <ChurchLogo src={brand.logoUrl} style={brand.logoStyle} size={28} /> : <LogoMark size={24} badge={false} className="text-gold" />}
        <span className="truncate text-sm font-semibold text-paper">{brand.name ?? 'Tu iglesia'}</span>
      </div>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={`relative aspect-[3/1] touch-none select-none overflow-hidden sm:aspect-[5/1] ${can ? 'cursor-grab active:cursor-grabbing' : ''}`}
        role={can ? 'slider' : undefined}
        aria-label={can ? 'Encuadre de la foto: arrastra para mover' : undefined}
        aria-valuetext={can ? `${focus.x}% horizontal, ${focus.y}% vertical` : undefined}
      >
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: `url(${brand.coverUrl ?? '/hero-band.webp'})`, backgroundPosition: can ? `${focus.x}% ${focus.y}%` : 'center', filter: can ? 'none' : 'blur(3px)', transform: can ? undefined : 'scale(1.1)' }}
        />
        <div className={`absolute inset-0 ${can ? 'bg-sage-dark/35' : 'bg-sage-dark/60'}`} />
        {can && <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(20,30,26,0.7),transparent_70%)]" />}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 p-4">
          {brand.logoUrl && <ChurchLogo src={brand.logoUrl} style={brand.logoStyle} size={36} className="ring-2 ring-white/40" />}
          <p className="truncate font-serif text-xl text-paper">{brand.name ?? 'Tu iglesia'}</p>
        </div>
        {can && (
          <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>
            Arrastra para encuadrar
          </span>
        )}
      </div>
    </div>
  )
}

function AssetField({ title, hint, preview, busy, has, onFile, onClear, extra }: { title: string; hint: string; preview: ReactNode; busy: boolean; has: boolean; onFile: (f: File) => void; onClear: () => void; extra?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-start gap-4 rounded-xl bg-cream/60 p-4">
      {preview}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-charcoal">{title}</p>
        <p className="text-xs text-graysage">{hint} Hasta {ASSET_MAX_MB} MB.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-lg bg-sage-dark px-3 py-1.5 text-xs font-semibold text-paper transition hover:bg-sage-deep disabled:opacity-60">
            {busy ? 'Subiendo…' : has ? 'Cambiar' : 'Subir'}
          </button>
          {has && !busy && (
            <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-xs font-medium text-graysage transition hover:bg-white hover:text-danger">Quitar</button>
          )}
        </div>
        {extra}
        <input
          ref={input}
          type="file"
          accept={ASSET_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onFile(f)
          }}
        />
      </div>
    </div>
  )
}
