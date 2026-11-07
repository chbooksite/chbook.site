import { useRef, useState, type ReactNode } from 'react'
import { ASSET_MAX_MB, ASSET_TYPES, clearChurchAsset, uploadChurchAsset, type Brand } from '../lib/brand'
import { LogoMark } from './Logo'

// Ajustes → Identidad: logo y foto del templo de la iglesia, con vista previa
// de cómo se ven en el encabezado y en la banda de Inicio.
export default function BrandEditor({ churchId, brand }: { churchId: string; brand: Brand }) {
  const [busy, setBusy] = useState<'logo' | 'cover' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async (kind: 'logo' | 'cover', job: () => Promise<string | null>) => {
    setBusy(kind)
    setMsg(null)
    const err = await job()
    setBusy(null)
    setMsg(err)
  }

  return (
    <section className="tarjeta p-5 sm:p-6">
      <h2 className="font-serif text-lg font-bold text-charcoal">Identidad de la iglesia</h2>
      <p className="mt-0.5 mb-5 text-sm text-graysage">Tu logo y la foto de tu templo reemplazan a los de ChBook en el panel. Los ve todo tu equipo.</p>

      {/* Vista previa: encabezado + banda de Inicio */}
      <div className="mb-5 overflow-hidden rounded-2xl border border-clay-light bg-paper" aria-hidden>
        <div className="flex items-center gap-2.5 bg-sage-dark px-4 py-2.5">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="h-7 w-7 rounded-lg bg-white object-contain p-0.5" />
          ) : (
            <LogoMark size={24} badge={false} className="text-gold" />
          )}
          <span className="truncate text-sm font-semibold text-paper">{brand.name ?? 'Tu iglesia'}</span>
        </div>
        <div className="relative h-24 overflow-hidden">
          <div className="absolute inset-0 scale-110 bg-cover bg-center" style={{ backgroundImage: `url(${brand.coverUrl ?? '/hero-band.webp'})`, filter: 'blur(3px)' }} />
          <div className="absolute inset-0 bg-sage-dark/60" />
          <p className="relative px-4 pt-12 font-serif text-xl text-paper">{brand.name ?? 'Tu iglesia'}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AssetField
          title="Logo"
          hint="Cuadrado, idealmente con fondo transparente (PNG o SVG)."
          preview={brand.logoUrl ? <img src={brand.logoUrl} alt="Logo actual" className="h-16 w-16 rounded-xl border border-clay-light bg-white object-contain p-1" /> : <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-clay-light text-xs text-faint">Sin logo</span>}
          busy={busy === 'logo'}
          has={!!brand.logoUrl}
          onFile={(f) => run('logo', () => uploadChurchAsset(churchId, 'logo', f))}
          onClear={() => run('logo', () => clearChurchAsset(churchId, 'logo'))}
        />
        <AssetField
          title="Foto del templo"
          hint="Horizontal. Se usa de fondo en la banda de Inicio."
          preview={brand.coverUrl ? <img src={brand.coverUrl} alt="Foto actual" className="h-16 w-24 rounded-xl border border-clay-light object-cover" /> : <span className="flex h-16 w-24 items-center justify-center rounded-xl border border-dashed border-clay-light text-xs text-faint">Sin foto</span>}
          busy={busy === 'cover'}
          has={!!brand.coverUrl}
          onFile={(f) => run('cover', () => uploadChurchAsset(churchId, 'cover', f))}
          onClear={() => run('cover', () => clearChurchAsset(churchId, 'cover'))}
        />
      </div>
      {msg && <p className="mt-3 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{msg}</p>}
    </section>
  )
}

function AssetField({ title, hint, preview, busy, has, onFile, onClear }: { title: string; hint: string; preview: ReactNode; busy: boolean; has: boolean; onFile: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-4 rounded-xl bg-cream/60 p-4">
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
